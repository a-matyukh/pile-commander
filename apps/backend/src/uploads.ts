import type { S3Client } from "bun";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { ApiError, internal_error } from "./auth";
import { limited_stream, StreamLimitError } from "./streams";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const STAGING_KEY_RE = new RegExp(`^uploads/(blob|hub_preview)/(${UUID})/(${UUID})(\\.[a-z0-9]{1,16})?$`);
export type UploadKind = "blob" | "hub_preview";

export function parse_staging_key(key: string, kind: UploadKind) {
	const match = STAGING_KEY_RE.exec(key);
	if (!match || match[1] !== kind) throw new ApiError(400, "invalid upload ticket");
	return { workspace_id: match[2]!, id: match[3]!, ext: match[4] ?? "" };
}

// Bound multipart buffers (2 uploads × one 5 MiB part) and queued requests.
let active = 0;
const waiting: (() => void)[] = [];
async function with_copy_slot<T>(task: () => Promise<T>): Promise<T> {
	if (active >= 2) {
		if (waiting.length >= 16) throw new ApiError(429, "upload processing busy", {}, { "Retry-After": "2" });
		await new Promise<void>((resolve) => waiting.push(resolve));
	} else active += 1;
	try { return await task(); }
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
	s3: S3Client,
	db: SupabaseClient,
	key: string,
	user: string,
	kind: UploadKind,
	request: Record<string, unknown>,
	map_error: MapError,
	hub_cap = 2097152,
): Promise<Record<string, unknown>> {
	const parsed = parse_staging_key(key, kind);
	const args = { p_key: key, p_user: user, p_kind: kind, p_request: request };
	const prepare = async () => {
		const { data, error } = await db.rpc("prepare_upload", args);
		if (error) throw map_error(error, "prepare upload");
		const state = data as UploadState | null;
		if (!state || state.workspace_id !== parsed.workspace_id || !Number.isSafeInteger(Number(state.max_bytes)) || Number(state.max_bytes) <= 0) {
			throw internal_error("prepare upload", "invalid ticket response");
		}
		return state;
	};
	const initial = await prepare();
	if (initial.result) return initial.result;
	return with_copy_slot(async () => {
		// Another request may have finished while this one waited for a slot.
		const state = await prepare();
		if (state.result) return state.result;
		const max_bytes = kind === "hub_preview" ? Math.min(hub_cap, Number(state.max_bytes)) : Number(state.max_bytes);
		const final_key = `${kind === "hub_preview" ? "hub/" : ""}${parsed.workspace_id}/${crypto.randomUUID()}${parsed.ext}`;
		let source_size: number;
		try { source_size = (await s3.stat(key)).size; }
		catch { throw new ApiError(409, "upload not found in storage — PUT the object first"); }
		const too_large = () => new ApiError(413, `file_too_large: exceeds ${max_bytes} bytes`, {
			kind: "file_size", max_file_bytes: max_bytes, file_bytes: source_size,
			...(typeof request.mime === "string" ? { file_mime: request.mime } : {}),
		});
		if (source_size > max_bytes) throw too_large();
		const limited = limited_stream(s3.file(key).stream(), max_bytes);
		try {
			await s3.write(final_key, new Response(limited.stream), {
				type: typeof request.mime === "string" ? request.mime : `image/${parsed.ext === ".png" ? "png" : parsed.ext === ".webp" ? "webp" : "jpeg"}`,
				partSize: 5 * 1024 * 1024, queueSize: 1,
			});
		} catch (error) {
			await limited.cancel(error).catch(() => {});
			if (limited.failure() instanceof StreamLimitError) throw too_large();
			throw error;
		}
		// The staging object can change between HEAD and GET. Only this private
		// final object's actual bytes are authoritative, never the initial HEAD.
		const { size } = await s3.stat(final_key);
		if (size > max_bytes) throw too_large();
		if (size !== limited.bytes()) throw internal_error("upload copy", "stored size differs from copied bytes");
		const { data, error } = await db.rpc("complete_upload", { ...args, p_final_key: final_key, p_size: size });
		// NEVER delete here: the transaction may have committed despite a lost
		// response. GC reclaims unused attempts and staging keys after the grace.
		if (error) throw map_error(error, "finalize");
		return data as Record<string, unknown>;
	});
}
