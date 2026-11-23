import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { finalize_upload, parse_staging_key, type UploadKind } from "./uploads";
import { rpc_error_to_api } from "./blobs";
import type { Storage } from "./s3";
import { CopySourceChanged, CopySourceMissing, type CopyOptions } from "./s3_copy";

const WS = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const request = { id: ID, parent_id: WS, name: "test.png", mime: "image/png", client_id: null };

function etag_of(bytes: Uint8Array): string {
	return `"${Bun.hash(bytes).toString(16)}"`;
}

type FixtureOptions = {
	/** what the staging stat reports, whatever is stored */
	head_size?: number;
	lost_response?: boolean;
	refuse?: boolean;
	/** a replayed PUT lands right after the staging stat */
	replay_after_stat?: Uint8Array;
	/** a store that ignores x-amz-copy-source-if-match */
	ignore_if_match?: boolean;
};

function fixture(kind: UploadKind = "blob", options: FixtureOptions = {}) {
	const key = `uploads/${kind}/${WS}/${ID}.png`;
	const objects = new Map<string, Uint8Array>([[key, new Uint8Array([1, 2, 3, 4])]]);
	const types = new Map<string, string>();
	/** keys the copies created */
	const writes: string[] = [];
	const deletions: string[] = [];
	let result: Record<string, unknown> | null = null;
	let bound: string | null = null;
	let completed = 0;
	let replayed = false;
	const s3 = {
		async stat(k: string) {
			const bytes = objects.get(k);
			if (!bytes) throw new Error("not found");
			const stat = { size: k === key ? options.head_size ?? bytes.length : bytes.length, etag: etag_of(bytes) };
			if (k === key && options.replay_after_stat && !replayed) {
				replayed = true;
				objects.set(key, options.replay_after_stat);
			}
			return stat;
		},
		async copy(source: string, dest: string, copy: CopyOptions = {}) {
			const bytes = objects.get(source);
			if (!bytes) throw new CopySourceMissing(source);
			if (copy.if_match && !options.ignore_if_match && copy.if_match !== etag_of(bytes)) throw new CopySourceChanged(source);
			writes.push(dest);
			objects.set(dest, bytes.slice());
			if (copy.content_type) types.set(dest, copy.content_type);
		},
		async delete(k: string) { deletions.push(k); objects.delete(k); },
	} as unknown as Storage;
	const db = { async rpc(name: string, args: Record<string, unknown>) {
		const fingerprint = JSON.stringify(args.p_request);
		if (args.p_user !== USER || args.p_key !== key) return { data: null, error: { code: "P0001", message: "upload: ticket not found" } };
		if (bound !== null && bound !== fingerprint) return { data: null, error: { code: "P0001", message: "upload_conflict: bound" } };
		bound = fingerprint;
		if (name === "prepare_upload") return { data: { workspace_id: WS, max_bytes: 16, result }, error: null };
		expect(name).toBe("complete_upload");
		if (options.refuse) return { data: null, error: { code: "23505", message: "duplicate key" } };
		if (!result) {
			completed += 1;
			result = kind === "blob"
				? { entry: { ...args.p_request as object, storage_key: args.p_final_key }, size_bytes: args.p_size }
				: { storage_key: args.p_final_key, size_bytes: args.p_size };
			if (options.lost_response) return { data: null, error: { code: "", message: "lost response after commit" } };
		}
		return { data: result, error: null };
	} } as unknown as SupabaseClient;
	const finalize = (body: Record<string, unknown> = kind === "blob" ? request : {}, user = USER) =>
		finalize_upload(s3, db, key, user, kind, body, rpc_error_to_api);
	return { key, objects, types, writes, deletions, finalize, completed: () => completed };
}

describe("immutable upload finalization", () => {
	test("a retry returns the original receipt without deleting or copying again", async () => {
		const f = fixture();
		const first = await f.finalize();
		expect(await f.finalize()).toEqual(first);
		expect(f.completed()).toBe(1);
		expect(f.writes).toHaveLength(1);
		expect(f.objects.has(f.writes[0]!)).toBe(true);
		expect(f.deletions).toEqual([]);
	});

	test("replaying PUT changes staging only, for both files and Hub covers", async () => {
		for (const kind of ["blob", "hub_preview"] as const) {
			const f = fixture(kind);
			const first = await f.finalize();
			f.objects.set(f.key, new Uint8Array(100));
			expect(await f.finalize()).toEqual(first);
			expect(f.objects.get(f.writes[0]!)).toEqual(new Uint8Array([1, 2, 3, 4]));
			expect(f.writes[0]).not.toStartWith("uploads/");
		}
	});

	test("concurrent attempts use distinct keys and return one committed result", async () => {
		const f = fixture();
		const results = await Promise.all([f.finalize(), f.finalize()]);
		expect(results[0]).toEqual(results[1]);
		expect(f.completed()).toBe(1);
		expect(new Set(f.writes).size).toBe(f.writes.length);
		expect(f.deletions).toEqual([]);
	});

	test("an uncertain commit is recovered by retry; a rejected insert also never deletes", async () => {
		const uncertain = fixture("blob", { lost_response: true });
		await expect(uncertain.finalize()).rejects.toThrow();
		await uncertain.finalize();
		expect(uncertain.completed()).toBe(1);
		expect(uncertain.writes).toHaveLength(1);
		expect(uncertain.deletions).toEqual([]);
		const refused = fixture("blob", { refuse: true });
		await expect(refused.finalize()).rejects.toThrow();
		expect(refused.deletions).toEqual([]);
	});

	test("rejects another user, mismatched retries and final keys as tickets", async () => {
		const f = fixture();
		await expect(f.finalize(request, WS)).rejects.toThrow();
		expect(f.writes).toEqual([]);
		await f.finalize();
		await expect(f.finalize({ ...request, name: "other.png" })).rejects.toThrow("upload_conflict");
		expect(() => parse_staging_key(`${WS}/${ID}.png`, "blob")).toThrow();
		expect(() => parse_staging_key(f.key, "hub_preview")).toThrow();
	});

	test("an upload over the limit is refused before any copy", async () => {
		const f = fixture("blob", { head_size: 100 });
		await expect(f.finalize()).rejects.toMatchObject({ status: 413 });
		expect(f.writes).toEqual([]);
		expect(f.completed()).toBe(0);
	});

	test("staging replaced after its stat is not copied: the ETag condition refuses it", async () => {
		const f = fixture("blob", { replay_after_stat: new Uint8Array(100) });
		await expect(f.finalize()).rejects.toMatchObject({ status: 409 });
		expect(f.writes).toEqual([]);
		expect(f.completed()).toBe(0);
		expect(f.objects.size).toBe(1);
	});

	test("a store ignoring the condition is still held to the final object's size", async () => {
		// grown past the limit: refused on the final stat, the copy left to GC
		const grown = fixture("blob", { replay_after_stat: new Uint8Array(100), ignore_if_match: true });
		await expect(grown.finalize()).rejects.toMatchObject({ status: 413 });
		expect(grown.completed()).toBe(0);
		expect(grown.deletions).toEqual([]);
		// within the limit but not what was measured: refused, the client finalizes again
		const swapped = fixture("blob", { replay_after_stat: new Uint8Array(8), ignore_if_match: true });
		await expect(swapped.finalize()).rejects.toMatchObject({ status: 409 });
		expect(swapped.completed()).toBe(0);
	});

	test("the copy is made inside the storage with the type this server sets", async () => {
		const blob = fixture("blob");
		await blob.finalize();
		expect(blob.types.get(blob.writes[0]!)).toBe("image/png");
		const cover = fixture("hub_preview");
		await cover.finalize();
		expect(cover.writes[0]).toStartWith(`hub/${WS}/`);
		expect(cover.types.get(cover.writes[0]!)).toBe("image/png");
	});

	test("staging that was never PUT is a 409, not a server error", async () => {
		const f = fixture();
		f.objects.delete(f.key);
		await expect(f.finalize()).rejects.toMatchObject({ status: 409 });
	});
});
