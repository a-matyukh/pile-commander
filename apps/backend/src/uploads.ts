import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { ApiError, internal_error } from "./auth";
import type { Storage } from "./s3";
import { CopySourceChanged, CopySourceMissing } from "./s3_copy";
import { server_timing, type ServerTiming } from "./timing";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const STAGING_KEY_RE = new RegExp(`^uploads/(blob|hub_preview)/(${UUID})/(${UUID})(\\.[a-z0-9]{1,16})?$`);
export type UploadKind = "blob" | "hub_preview";

export function parse_staging_key(key: string, kind: UploadKind) {
	const match = STAGING_KEY_RE.exec(key);
	if (!match || match[1] !== kind) throw new ApiError(400, "invalid upload ticket");
	return { workspace_id: match[2]!, id: match[3]!, ext: match[4] ?? "" };
}

// The copy runs inside the storage (CopyObject), so no bytes pass through
// here; the slots only bound how many copies this process asks for at once
// (a gigabyte takes the storage a few seconds) and how many requests wait.
const COPY_SLOTS = 8;
const COPY_QUEUE = 32;
let active = 0;
const waiting: (() => void)[] = [];
/** `task` learns whether it waited for its slot: another request may have finished the same upload meanwhile */
async function with_copy_slot<T>(task: (waited: boolean) => Promise<T>): Promise<T> {
	let waited = false;
	if (active >= COPY_SLOTS) {
		if (waiting.length >= COPY_QUEUE) throw new ApiError(429, "upload processing busy", {}, { "Retry-After": "2" });
		await new Promise<void>((resolve) => waiting.push(resolve));
		waited = true;
	} else active += 1;
	try { return await task(waited); }
	finally {
		const next = waiting.shift();
		if (next) next();
		else active -= 1;
	}
}

type UploadState = { workspace_id: string; max_bytes: number; result: Record<string, unknown> | null };
type MapError = (error: PostgrestError, context: string) => Error;

/** Every attempt writes a NEW key. No retry can overwrite a finalized blob. */
export async function finalize_upload(
	s3: Storage,
	db: SupabaseClient,
	key: string,
	user: string,
	kind: UploadKind,
	request: Record<string, unknown>,
	map_error: MapError,
	hub_cap = 2097152,
	timing: ServerTiming = server_timing(),
): Promise<Record<string, unknown>> {
	const parsed = parse_staging_key(key, kind);
	const args = { p_key: key, p_user: user, p_kind: kind, p_request: request };
	const prepare = () => timing.step("prepare", async () => {
		const { data, error } = await db.rpc("prepare_upload", args);
		if (error) throw map_error(error, "prepare upload");
		const state = data as UploadState | null;
		if (!state || state.workspace_id !== parsed.workspace_id || !Number.isSafeInteger(Number(state.max_bytes)) || Number(state.max_bytes) <= 0) {
			throw internal_error("prepare upload", "invalid ticket response");
		}
		return state;
	});
	const initial = await prepare();
	if (initial.result) return initial.result;
	const queued = performance.now();
	return with_copy_slot(async (waited) => {
		timing.add("slot", performance.now() - queued);
		// Another request may have finished while this one waited for a slot;
		// a slot taken at once follows the first prepare directly
		const state = waited ? await prepare() : initial;
		if (state.result) return state.result;
		const max_bytes = kind === "hub_preview" ? Math.min(hub_cap, Number(state.max_bytes)) : Number(state.max_bytes);
		const final_key = `${kind === "hub_preview" ? "hub/" : ""}${parsed.workspace_id}/${crypto.randomUUID()}${parsed.ext}`;
		let source: { size: number; etag: string };
		try { source = await timing.step("stat", () => s3.stat(key)); }
		catch { throw new ApiError(409, "upload not found in storage — PUT the object first"); }
		const too_large = (file_bytes: number) => new ApiError(413, `file_too_large: exceeds ${max_bytes} bytes`, {
			kind: "file_size", max_file_bytes: max_bytes, file_bytes,
			...(typeof request.mime === "string" ? { file_mime: request.mime } : {}),
		});
		const changed = () => new ApiError(409, "upload changed while it was being saved — finalize again");
		if (source.size > max_bytes) throw too_large(source.size);
		try {
			// Inside the storage, only while staging still has the ETag just
			// measured (a replayed PUT in between fails it), and with metadata
			// this server sets: the uploader's own headers do not carry over
			await timing.step("copy", () => s3.copy(key, final_key, {
				if_match: source.etag,
				content_type: typeof request.mime === "string" ? request.mime : `image/${parsed.ext === ".png" ? "png" : parsed.ext === ".webp" ? "webp" : "jpeg"}`,
			}));
		} catch (error) {
			if (error instanceof CopySourceChanged) throw changed();
			if (error instanceof CopySourceMissing) throw new ApiError(409, "upload not found in storage — PUT the object first");
			throw error;
		}
		// Only this private final object's actual size is authoritative, never
		// the staging stat: it is checked against the limit again, and must be
		// the size the copy was made on (a store ignoring the ETag condition
		// would otherwise let a replayed PUT through)
		const { size } = await timing.step("stat_final", () => s3.stat(final_key));
		if (size > max_bytes) throw too_large(size);
		if (size !== source.size) throw changed();
		const { data, error } = await timing.step("complete", async () =>
			await db.rpc("complete_upload", { ...args, p_final_key: final_key, p_size: size }));
		// NEVER delete here: the transaction may have committed despite a lost
		// response. GC reclaims unused attempts and staging keys after the grace.
		if (error) throw map_error(error, "finalize");
		return data as Record<string, unknown>;
	});
}
