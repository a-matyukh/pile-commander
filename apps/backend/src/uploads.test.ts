import { describe, expect, test } from "bun:test";
import type { S3Client } from "bun";
import type { SupabaseClient } from "@supabase/supabase-js";
import { finalize_upload, parse_staging_key, type UploadKind } from "./uploads";
import { rpc_error_to_api } from "./blobs";

const WS = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const request = { id: ID, parent_id: WS, name: "test.png", mime: "image/png", client_id: null };

function fixture(kind: UploadKind = "blob", options: { head_size?: number; lost_response?: boolean; refuse?: boolean } = {}) {
	const key = `uploads/${kind}/${WS}/${ID}.png`;
	const objects = new Map<string, Uint8Array>([[key, new Uint8Array([1, 2, 3, 4])]]);
	const writes: string[] = [];
	const deletions: string[] = [];
	let result: Record<string, unknown> | null = null;
	let bound: string | null = null;
	let completed = 0;
	let cancelled = false;
	const s3 = {
		async stat(k: string) {
			const bytes = objects.get(k);
			if (!bytes) throw new Error("not found");
			return { size: k === key ? options.head_size ?? bytes.length : bytes.length };
		},
		file(k: string) {
			return { stream() {
				const source = objects.get(k)!;
				let offset = 0;
				return new ReadableStream<Uint8Array>({
					pull(controller) {
						if (offset === source.length) { controller.close(); return; }
						controller.enqueue(source.slice(offset, offset + 2));
						offset = Math.min(offset + 2, source.length);
					},
					cancel() { cancelled = true; },
				}, { highWaterMark: 0 });
			} };
		},
		async write(k: string, body: Response) {
			writes.push(k);
			const bytes = await body.bytes();
			objects.set(k, bytes);
			return bytes.length;
		},
		async delete(k: string) { deletions.push(k); objects.delete(k); },
	} as unknown as S3Client;
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
	return { key, objects, writes, deletions, finalize, completed: () => completed, cancelled: () => cancelled };
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

	test("limits actual bytes even if staging grows after HEAD, and cancels the read", async () => {
		const f = fixture("blob", { head_size: 4 });
		f.objects.set(f.key, new Uint8Array(100));
		await expect(f.finalize()).rejects.toMatchObject({ status: 413 });
		expect(f.completed()).toBe(0);
		expect(f.cancelled()).toBe(true);
		expect(f.objects.size).toBe(1);
	});
});
