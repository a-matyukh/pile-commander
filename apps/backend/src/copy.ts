import type { S3Client } from "bun";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env";
import {
	ApiError,
	bearer_token,
	internal_error,
	require_owner_or_editor,
	require_user,
	user_client,
} from "./auth";
import { read_json } from "./blobs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Blobs re-keyed per request. Bun's S3 client has no server-side copy, so each
// one streams the whole object through this instance; a fork of a large board
// would otherwise hold one request open for the entire transfer. The GC sweep
// (list_foreign_blob_entries in gc.ts) is the guarantee for the remainder, and
// the endpoint is idempotent — the client may simply call it again
const COPY_BATCH = 200;

export type ForeignBlobRow = { id: string; workspace_id: string; storage_key: string };

export type CopyResult = {
	copied: number;
	failed: { id: string; error: string }[];
	/** rows left for a follow-up call or the GC sweep */
	remaining?: number;
};

// Gives each row its own object: copies the blob under a key of the row's
// workspace and rewrites storage_key. Rows arrive from list_subtree_files /
// list_foreign_blob_entries, both of which return only rows whose key
// carries another workspace's prefix (fresh forks), so calling this
// repeatedly is idempotent — nothing is copied twice. Previews are not copied
// and need no enqueue here: the new key has no entry_derivatives row, so the
// preview sweep (list_pending_derivatives) picks it up if the fork is public,
// and the old key's row is pruned once nothing references it
export async function copy_foreign_blobs(
	s3: S3Client,
	db: SupabaseClient,
	rows: ForeignBlobRow[],
	log_prefix: string,
): Promise<CopyResult> {
	const failed: { id: string; error: string }[] = [];
	let copied = 0;
	for (const file of rows) {
		const ext = /(\.[a-z0-9]{1,16})$/i.exec(file.storage_key)?.[1].toLowerCase() ?? "";
		const new_key = `${file.workspace_id.toLowerCase()}/${crypto.randomUUID()}${ext}`;
		try {
			// Bun's S3Client has no server-side CopyObject; write() streams the
			// source object through the gateway. Revisit once Bun exposes copy
			await s3.write(new_key, s3.file(file.storage_key));
			// the storage_key guard keeps a concurrent run from re-pointing a
			// row that was already moved to its own blob; a blob copied but
			// never recorded is reclaimed by the reconcile job
			const { error: update_error } = await db
				.from("entries")
				.update({ storage_key: new_key })
				.eq("id", file.id)
				.eq("storage_key", file.storage_key);
			if (update_error) throw new Error(update_error.message);
			copied += 1;
		} catch (err) {
			console.error(`${log_prefix} failed to copy blob for entry ${file.id}:`, err);
			failed.push({ id: file.id, error: String(err).slice(0, 300) });
		}
	}
	return { copied, failed };
}

// POST /blobs/copy-clones { root_entry_id } | { workspace_id } →
// { copied, failed }. fork_workspace clones rows pointing at the SOURCE's
// storage_key (SQL cannot reach B2); the client calls this right after the
// RPC so the fork gets its own objects without waiting for the GC sweep
// (gc.ts), which is the guarantee if this call never arrives. Same-workspace
// copies are not re-keyed at all — see list_subtree_files in rpc.sql
export async function handle_copy_clones(
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

	let root_entry_id = typeof body.root_entry_id === "string" ? body.root_entry_id : "";
	if (!root_entry_id && typeof body.workspace_id === "string" && UUID_RE.test(body.workspace_id)) {
		const { data: root, error } = await db
			.from("entries")
			.select("id")
			.eq("workspace_id", body.workspace_id)
			.is("parent_id", null)
			.is("deleted_at", null)
			.maybeSingle();
		if (error) throw internal_error("root entry lookup", error);
		root_entry_id = (root as { id: string } | null)?.id ?? "";
	}
	if (!UUID_RE.test(root_entry_id)) throw new ApiError(400, "invalid root_entry_id");

	const { data: root_row, error: root_error } = await db
		.from("entries")
		.select("workspace_id")
		.eq("id", root_entry_id)
		.maybeSingle();
	if (root_error) throw internal_error("entry lookup", root_error);
	if (!root_row) throw new ApiError(404, "entry not found");
	await require_owner_or_editor(client, user, (root_row as { workspace_id: string }).workspace_id);

	const { data: files, error: list_error } = await db.rpc("list_subtree_files", {
		p_root: root_entry_id,
	});
	if (list_error) throw internal_error("subtree listing", list_error);

	const rows = (files ?? []) as ForeignBlobRow[];
	const batch = rows.slice(0, COPY_BATCH);
	const result = await copy_foreign_blobs(s3, db, batch, "[copy]");
	return Response.json({ ...result, remaining: rows.length - batch.length });
}
