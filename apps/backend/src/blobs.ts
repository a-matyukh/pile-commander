import type { S3Client } from "bun";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { DerivMode, Env } from "./env";
import type { EgressInput, EgressMeter } from "./egress";
import { visitor_key } from "./ratelimit";
import { finalize_upload, parse_staging_key } from "./uploads";
import {
	ApiError,
	bearer_token,
	internal_error,
	require_user,
	require_workspace_owner,
	require_write_access,
	user_client,
} from "./auth";

// Storage keys: <workspace_id>/<uuid>[.ext]. The workspace prefix makes
// permission checks possible before the entries row exists and allows
// per-workspace lifecycle rules in B2 later
const WORKSPACE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_ONLY_RE = new RegExp(`^${UUID_RE}$`, "i");
export const HUB_PREVIEW_KEY_RE = new RegExp(`^hub/${UUID_RE}/${UUID_RE}\\.(jpe?g|png|webp)$`, "i");
const HUB_PREVIEW_EXT_RE = /(\.(jpe?g|png|webp))$/i;

// Plan-limit errors raised by the quota RPCs carry a JSON `detail` the client
// renders (kind/used/quota); everything else is logged and answered with a
// stable message so PostgREST internals never reach the client
export function rpc_error_to_api(
	error: PostgrestError,
	context: string,
	extra?: Record<string, unknown>,
): ApiError {
	if (/upload_conflict|upload_expired/.test(error.message)) return new ApiError(409, error.message);
	if (/quota_exceeded|file_too_large|hub_listing_limit|entries_limit_exceeded/.test(error.message)) {
		return new ApiError(413, error.message, {
			...extra_from_postgrest(error.details),
			...extra,
		});
	}
	if (error.code === "23505") return new ApiError(409, "an entry with this name already exists");
	if (error.code === "23514") return new ApiError(400, "invalid name or attributes");
	if (/access denied/.test(error.message)) return new ApiError(403, "no access to the workspace");
	if (/not found/.test(error.message)) return new ApiError(404, "entry not found");
	return internal_error(context, `${error.code} ${error.message} ${error.details ?? ""}`);
}

function extra_from_postgrest(details: string | undefined): Record<string, unknown> {
	if (!details) return {};
	try {
		const parsed = JSON.parse(details) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		return { details };
	}
	return { details };
}

async function assert_upload_quota(
	client: ReturnType<typeof user_client>,
	workspace_id: string,
	delta_bytes: number,
	file_bytes: number,
	file_mime: string | null,
): Promise<void> {
	const { error } = await client.rpc("assert_owner_quota", {
		p_workspace: workspace_id,
		p_delta_bytes: delta_bytes,
		p_file_bytes: file_bytes,
	});
	if (!error) return;
	throw rpc_error_to_api(error, "quota check", file_mime_extra(file_mime));
}

// Prefer the client-supplied Content-Type; otherwise guess from the name so a
// 413 still carries file_mime when the body omitted it. Unknown extensions
// stay null — mime_from_name's text/plain default would mislabel video/images.
function resolve_upload_file_mime(body: Record<string, unknown>): string | null {
	if (typeof body.mime === "string") {
		const mime = body.mime.trim();
		if (mime) return mime;
	}
	const name = typeof body.name === "string" ? body.name : "";
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	return (ext && MIME_FROM_UPLOAD_NAME[ext]) || null;
}

function file_mime_extra(mime: string | null): Record<string, unknown> {
	return mime ? { file_mime: mime } : {};
}

const MIME_FROM_UPLOAD_NAME: Record<string, string> = {
	md: "text/markdown",
	txt: "text/plain",
	json: "application/json",
	csv: "text/csv",
	svg: "image/svg+xml",
	html: "text/html",
	css: "text/css",
	js: "text/javascript",
	ts: "text/typescript",
	yaml: "text/yaml",
	yml: "text/yaml",
	xml: "text/xml",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
	heic: "image/heic",
	bmp: "image/bmp",
	mp4: "video/mp4",
	mov: "video/quicktime",
	webm: "video/webm",
	mkv: "video/x-matroska",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	m4a: "audio/mp4",
	pdf: "application/pdf",
	zip: "application/zip",
};

export async function read_json(req: Request): Promise<Record<string, unknown>> {
	const body = await req.json().catch(() => null);
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw new ApiError(400, "expected a JSON object body");
	}
	return body as Record<string, unknown>;
}

export type DownloadTarget = {
	owner_id: string;
	storage_key: string;
	size_bytes: number | string | null;
	is_member: boolean;
	/** the blob's ready preview (entry_derivatives), null while there is none */
	deriv_key: string | null;
	deriv_size_bytes: number | string | null;
	deriv_kind: "thumb" | "poster" | null;
	/** public, and its author allows forks and downloads as .pile */
	allow_download: boolean;
};

/** what GET /presign signed: the original, or the preview a non-member gets instead */
export type MediaVariant = "original" | "thumb" | "poster";

export type DownloadChoice = {
	key: string;
	size_bytes: number;
	/** the original's max_public_file_bytes gate; a preview is small by construction */
	gate_file_size: boolean;
	variant: MediaVariant;
};

// Owners and members always get the original. A non-member gets the ready
// preview when previews are served, charged at the preview's own size and
// without the size gate — like a Hub cover. Without one (not generated yet,
// skipped, or DERIV_ENABLE short of serve) the original goes through exactly
// as before, gate included: that gate is the stand-in until a preview exists.
// `want_original` is Download as .pile: the file itself, never a preview, and
// for a non-member only where the author allows forks and downloads
export function choose_download(
	target: DownloadTarget,
	deriv_mode: DerivMode,
	want_original = false,
): DownloadChoice {
	if (want_original && !target.is_member && !target.allow_download) {
		throw new ApiError(403, "download_not_allowed");
	}
	if (!want_original && !target.is_member && deriv_mode === "serve" && target.deriv_key && target.deriv_kind) {
		return {
			key: target.deriv_key,
			size_bytes: Number(target.deriv_size_bytes ?? 0),
			gate_file_size: false,
			variant: target.deriv_kind,
		};
	}
	return {
		key: target.storage_key,
		size_bytes: Number(target.size_bytes ?? 0),
		gate_file_size: true,
		variant: "original",
	};
}

/** whose meter pays for a download */
export type DownloadLedger = "none" | "owner" | "downloader";

// Members are never charged. A visitor viewing a board is charged to its
// owner (the public-link fair use); Download as .pile to the account that
// downloads, so a popular board never spends its owner's egress on copies
export function download_ledger(target: DownloadTarget, want_original: boolean): DownloadLedger {
	if (target.is_member) return "none";
	return want_original ? "downloader" : "owner";
}

type HubPreviewTarget = { owner_id: string; size_bytes: number | string };

// PostgREST answers an expired or forged JWT with PGRST301/PGRST303; a 500
// here would skip the client's refresh-and-retry (fetch_with_auth)
function lookup_error(error: PostgrestError, context: string): ApiError {
	if (error.code === "PGRST301" || error.code === "PGRST303") {
		return new ApiError(401, "invalid or expired token");
	}
	return internal_error(context, error);
}

// Non-members go through the egress meter (egress.ts). A refusal is the
// stable `media_unavailable` + reason, which the client renders as a
// placeholder instead of the media
async function meter_download(
	meter: EgressMeter,
	input: Omit<EgressInput, "visitor">,
	ip: string,
	// the downloads ledger has a budget only, and it is the downloader's own
	reason?: "download_budget",
): Promise<void> {
	const decision = await meter.admit({ ...input, visitor: visitor_key(ip) });
	if (decision.allowed) return;
	throw new ApiError(
		decision.status,
		"media_unavailable",
		{ reason: reason ?? decision.reason },
		decision.retry_after_s ? { "Retry-After": String(decision.retry_after_s) } : {},
	);
}

// GET /presign?entry=<entries.id>[&original=1] → { url, expires_in, variant }.
// Access goes through the caller's JWT (or anon): download_target returns the
// row only when its workspace is readable by this caller and the entry is
// live, so one 404 covers a missing blob, no access and the trash — existence
// is not leaked. The entry (not the key) picks the owner to charge: forks keep
// the source's key until re-keyed and copies share objects. Owners and members
// are never metered; anon, signed-in strangers and Hub visitors are — and get
// the blob's preview instead of the original once one is ready
// (choose_download). `variant` tells the client which it got: a poster is an
// image, not a playable video. `original=1` is Download as .pile: the file
// itself for a signed-in caller where the author allows it, charged to the
// caller's own download allowance rather than the owner's egress
export async function handle_download_presign(
	env: Env,
	s3: S3Client,
	req: Request,
	meter: EgressMeter | null,
	downloads: EgressMeter | null,
	ip: string,
): Promise<Response> {
	const params = new URL(req.url).searchParams;
	const entry = params.get("entry") ?? "";
	if (!UUID_ONLY_RE.test(entry)) throw new ApiError(400, "invalid entry id");
	const want_original = params.get("original") === "1";

	const token = bearer_token(req);
	const client = user_client(env, token);
	// the downloader pays for an original on request, so it takes an account
	const user = want_original ? await require_user(client, token) : null;
	const { data, error } = await client.rpc("download_target", { p_entry: entry });
	if (error) throw lookup_error(error, "entry lookup");
	const target = (data as DownloadTarget[] | null)?.[0];
	if (!target) throw new ApiError(404, "blob not found");

	const choice = choose_download(target, env.deriv.mode, want_original);
	const ledger = download_ledger(target, want_original);
	if (ledger === "owner" && meter) {
		await meter_download(
			meter,
			{ owner_id: target.owner_id, size_bytes: choice.size_bytes, gate_file_size: choice.gate_file_size },
			ip,
		);
	} else if (ledger === "downloader" && downloads && user) {
		await meter_download(
			downloads,
			{ owner_id: user.id, size_bytes: choice.size_bytes, gate_file_size: false },
			ip,
			"download_budget",
		);
	}

	const url = s3.presign(choice.key, { expiresIn: env.presign_get_ttl_seconds });
	return Response.json({ url, expires_in: env.presign_get_ttl_seconds, variant: choice.variant });
}

export type ReplaceEntryRow = {
	workspace_id: string;
	kind: string;
	deleted_at: string | null;
	size_bytes: number | string | null;
};

/**
 * Quota for a replacement is the difference from the live file. A missing,
 * trashed, foreign or non-file row is the same 404: the caller learns nothing
 * about a row RLS already hid.
 */
export function presign_replace_charge(
	replace: unknown,
	workspace_id: string,
	size_bytes: number,
	row: ReplaceEntryRow | null,
): { replace: string; delta_bytes: number } | null {
	if (replace == null || replace === "") return null;
	const id = String(replace).toLowerCase();
	if (!UUID_ONLY_RE.test(id)) throw new ApiError(400, "invalid replace");
	if (!row || row.deleted_at || row.kind !== "file" || row.workspace_id !== workspace_id) {
		throw new ApiError(404, "entry not found");
	}
	const old_size = row.size_bytes == null ? 0 : Number(row.size_bytes);
	if (!Number.isFinite(old_size) || old_size < 0) throw new ApiError(404, "entry not found");
	return { replace: id, delta_bytes: size_bytes - old_size };
}

export type FinalizeBlobRequest =
	| { replace: string; mime: string; client_id: string | null }
	| { id: string; parent_id: string; name: string; mime: string; client_id: string | null };

/** `replace` does not need a parent or a name: the row already has both. */
export function finalize_blob_request(body: Record<string, unknown>, staging_id: string): FinalizeBlobRequest {
	const mime = typeof body.mime === "string" && body.mime ? body.mime : "application/octet-stream";
	const client_id = typeof body.client_id === "string" ? body.client_id : null;
	if (mime.length > 255 || (client_id?.length ?? 0) > 255) throw new ApiError(400, "invalid upload metadata");
	if (body.replace != null && body.replace !== "") {
		const replace = String(body.replace).toLowerCase();
		if (!UUID_ONLY_RE.test(replace)) throw new ApiError(400, "invalid replace");
		return { replace, mime, client_id };
	}
	const parent_id = String(body.parent_id ?? "");
	if (!UUID_ONLY_RE.test(parent_id)) throw new ApiError(400, "invalid parent_id");
	const id = body.id == null ? staging_id : String(body.id);
	if (!UUID_ONLY_RE.test(id)) throw new ApiError(400, "invalid id");
	const name = typeof body.name === "string" ? body.name : "";
	if (!name || name.includes("/") || name === "." || name === ".." || /[\x00-\x1f\x7f]/.test(name) || [...name].length > 255) {
		throw new ApiError(400, "invalid name");
	}
	return { id, parent_id, name, mime, client_id };
}

export function upload_presign_body(storage_key: string, url: string, expires_in: number, replace: string | null) {
	return replace ? { storage_key, url, expires_in, replace } : { storage_key, url, expires_in };
}

// POST /presign/upload { workspace_id, name?, mime?, size_bytes?, replace? } →
// { storage_key, url, expires_in, replace? }. The client then PUTs the blob
// directly to B2 with the desired Content-Type and calls /finalize.
// `replace` is echoed so the client can tell this backend accepts it before the PUT.
export async function handle_upload_presign(
	env: Env,
	s3: S3Client,
	db: SupabaseClient | null,
	req: Request,
): Promise<Response> {
	if (!db) throw new ApiError(503, "service role is not configured on the backend");
	const token = bearer_token(req);
	const client = user_client(env, token);
	const user = await require_user(client, token);
	const body = await read_json(req);

	// lowercase: the key prefix is compared textually against workspace_id
	// by create_blob_entry and the re-key sweep
	const workspace_id = String(body.workspace_id ?? "").toLowerCase();
	if (!WORKSPACE_ID_RE.test(workspace_id)) throw new ApiError(400, "invalid workspace_id");

	const size_bytes = body.size_bytes == null ? null : Number(body.size_bytes);
	if (size_bytes === null || !Number.isFinite(size_bytes) || size_bytes < 0) {
		throw new ApiError(400, "size_bytes is required");
	}

	const name = typeof body.name === "string" ? body.name : "";
	const file_mime = resolve_upload_file_mime(body);

	await require_write_access(client, user, workspace_id);
	let row: ReplaceEntryRow | null = null;
	if (body.replace != null && body.replace !== "" && UUID_ONLY_RE.test(String(body.replace))) {
		const { data, error } = await client
			.from("entries")
			.select("workspace_id, kind, deleted_at, size_bytes")
			.eq("id", String(body.replace).toLowerCase())
			.maybeSingle();
		if (error) throw internal_error("replace lookup", error);
		row = data as ReplaceEntryRow | null;
	}
	const replacing = presign_replace_charge(body.replace, workspace_id, size_bytes, row);
	await assert_upload_quota(client, workspace_id, replacing?.delta_bytes ?? size_bytes, size_bytes, file_mime);

	const ext = /(\.[a-z0-9]{1,16})$/i.exec(name)?.[1].toLowerCase() ?? "";
	const { data: storage_key, error } = await db.rpc("register_upload", {
		p_workspace: workspace_id, p_user: user.id, p_kind: "blob", p_ext: ext, p_ttl: env.presign_put_ttl_seconds,
	});
	if (error) throw rpc_error_to_api(error, "register upload");

	const url = s3.presign(storage_key, { method: "PUT", expiresIn: env.presign_put_ttl_seconds });
	return Response.json(upload_presign_body(storage_key, url, env.presign_put_ttl_seconds, replacing?.replace ?? null));
}

// POST /finalize { storage_key, parent_id, name, mime, id?, client_id? } →
// { entry, size_bytes }. Called after the direct PUT to B2. The object is
// copied from staging to a new, server-only key. complete_upload records the
// entry and idempotency receipt atomically. Failed/uncertain attempts go to GC.
export async function handle_finalize(
	env: Env,
	s3: S3Client,
	db: SupabaseClient | null,
	req: Request,
): Promise<Response> {
	if (!db) throw new ApiError(503, "service role is not configured on the backend");
	const token = bearer_token(req);
	const client = user_client(env, token);
	const user = await require_user(client, token);
	const body = await read_json(req);

	const storage_key = String(body.storage_key ?? "");
	const staging = parse_staging_key(storage_key, "blob");
	const request = finalize_blob_request(body, staging.id);

	await require_write_access(client, user, staging.workspace_id);

	return Response.json(await finalize_upload(s3, db, storage_key, user.id, "blob", request, (error, context) =>
		rpc_error_to_api(error, context, file_mime_extra(request.mime)),
	));
}

// POST /presign/hub-preview-upload { workspace_id, name } →
// { storage_key, url, expires_in }. Owner only; jpeg/png/webp. The client
// PUTs to staging, then /hub-preview/finalize returns the immutable cover key.
export async function handle_hub_preview_upload(
	env: Env,
	s3: S3Client,
	db: SupabaseClient | null,
	req: Request,
): Promise<Response> {
	if (!db) throw new ApiError(503, "service role is not configured on the backend");
	const token = bearer_token(req);
	const client = user_client(env, token);
	const user = await require_user(client, token);
	const body = await read_json(req);

	const workspace_id = String(body.workspace_id ?? "").toLowerCase();
	if (!WORKSPACE_ID_RE.test(workspace_id)) throw new ApiError(400, "invalid workspace_id");
	await require_workspace_owner(client, user, workspace_id);

	const name = typeof body.name === "string" ? body.name : "";
	const ext = HUB_PREVIEW_EXT_RE.exec(name)?.[1]?.toLowerCase() ?? "";
	if (!ext) throw new ApiError(400, "hub preview must be jpeg, png, or webp");

	const { data: storage_key, error } = await db.rpc("register_upload", {
		p_workspace: workspace_id, p_user: user.id, p_kind: "hub_preview", p_ext: ext, p_ttl: env.presign_put_ttl_seconds,
	});
	if (error) throw rpc_error_to_api(error, "register preview upload");
	const url = s3.presign(storage_key, { method: "PUT", expiresIn: env.presign_put_ttl_seconds });
	return Response.json({ storage_key, url, expires_in: env.presign_put_ttl_seconds });
}

// POST /hub-preview/finalize { storage_key } → { storage_key, size_bytes }.
// Owner only. The returned key is an immutable server-made copy, not staging.
export async function handle_hub_preview_finalize(
	env: Env,
	s3: S3Client,
	db: SupabaseClient | null,
	req: Request,
): Promise<Response> {
	if (!db) throw new ApiError(503, "service role is not configured on the backend");
	const token = bearer_token(req);
	const client = user_client(env, token);
	const user = await require_user(client, token);
	const body = await read_json(req);

	const storage_key = String(body.storage_key ?? "");
	const { workspace_id } = parse_staging_key(storage_key, "hub_preview");
	await require_workspace_owner(client, user, workspace_id);
	return Response.json(await finalize_upload(s3, db, storage_key, user.id, "hub_preview", {}, rpc_error_to_api, env.hub_preview_max_bytes));
}

// GET /hub-preview?key=... — public gallery image. 302 to a short-lived B2
// GET if the key is currently listed; the same 404 covers a missing object
// and a key that is not a Hub preview. An <img> carries no token, so every
// hit is metered as a visitor — the owner's own card views included (≤2 MiB)
export async function handle_hub_preview_download(
	env: Env,
	s3: S3Client,
	req: Request,
	meter: EgressMeter | null,
	ip: string,
): Promise<Response> {
	const key = new URL(req.url).searchParams.get("key") ?? "";
	if (!HUB_PREVIEW_KEY_RE.test(key)) throw new ApiError(404, "blob not found");

	const client = user_client(env, bearer_token(req));
	const { data, error } = await client.rpc("hub_preview_target", { p_key: key });
	if (error) throw lookup_error(error, "hub preview lookup");
	const target = (data as HubPreviewTarget[] | null)?.[0];
	if (!target) throw new ApiError(404, "blob not found");

	if (meter) {
		await meter_download(
			meter,
			{ owner_id: target.owner_id, size_bytes: Number(target.size_bytes), gate_file_size: false },
			ip,
		);
	}

	const url = s3.presign(key, { expiresIn: env.presign_get_ttl_seconds });
	return Response.redirect(url, 302);
}
