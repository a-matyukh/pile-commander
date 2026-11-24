import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env";
import type { Storage } from "./s3";
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

// Blobs re-keyed per request. Each is a copy inside the storage (CopyObject),
// one at a time, so a fork of a large board still holds the request for one
// round trip per file. The GC sweep (list_foreign_blob_entries in gc.ts) is
// the guarantee for the remainder, and the endpoint is idempotent — the
// client may simply call it again
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
// Rows being copied right now, by any caller: the GC re-key sweep and
// /blobs/copy-clones run in this one process (one Render instance) and may
// pick the same row from lists read a moment apart. A row taken here is
// skipped by everyone else until its copy is recorded or has failed
const in_flight = new Set<string>();

export async function copy_foreign_blobs(
	s3: Storage,
	db: SupabaseClient,
	rows: ForeignBlobRow[],
	log_prefix: string,
): Promise<CopyResult> {
	const failed: { id: string; error: string }[] = [];
	let copied = 0;
	for (const file of rows) {
		if (in_flight.has(file.id)) continue;
		in_flight.add(file.id);
		try {
			copied += await copy_one(s3, db, file, log_prefix, failed);
		} finally {
			in_flight.delete(file.id);
		}
	}
	return { copied, failed };
}

/** 1 when the row got its own object, 0 when it needed none or failed */
async function copy_one(
	s3: Storage,
	db: SupabaseClient,
	file: ForeignBlobRow,
	log_prefix: string,
	failed: { id: string; error: string }[],
): Promise<number> {
	{
		const ext = /(\.[a-z0-9]{1,16})$/i.exec(file.storage_key)?.[1].toLowerCase() ?? "";
		const new_key = `${file.workspace_id.toLowerCase()}/${crypto.randomUUID()}${ext}`;
		try {
			// The list may be stale: another run (the GC sweep, a second call)
			// may have re-keyed the row since. Copying it again would leave an
			// orphan copy in storage until the reconcile
			// Trashed meanwhile: the sweep would no longer list it, so it waits too
			const { data: current, error: read_error } = await db
				.from("entries")
				.select("storage_key, workspace_id, deleted_at")
				.eq("id", file.id)
				.maybeSingle();
			if (read_error) throw new Error(read_error.message);
			const row = current as { storage_key: string | null; workspace_id: string; deleted_at: string | null } | null;
			if (!row || row.storage_key !== file.storage_key || row.workspace_id !== file.workspace_id || row.deleted_at) return 0;
			// Inside the storage; the source is a finalized object, so its own
			// metadata (the type finalize set) carries over unchanged
			await s3.copy(file.storage_key, new_key);
			// the storage_key guard keeps a concurrent run from re-pointing a
			// row that was already moved to its own blob; a blob copied but
			// never recorded is reclaimed by the reconcile job
			const { data: updated, error: update_error } = await db
				.from("entries")
				.update({ storage_key: new_key })
				.eq("id", file.id)
				.eq("storage_key", file.storage_key)
				.eq("workspace_id", file.workspace_id)
				.is("deleted_at", null)
				.select("id");
			if (update_error) throw new Error(update_error.message);
			// the row changed between the read and the write: the copy is an
			// orphan the reconcile reclaims, not a re-key
			return (updated ?? []).length === 1 ? 1 : 0;
		} catch (err) {
			console.error(`${log_prefix} failed to copy blob for entry ${file.id}:`, err);
			failed.push({ id: file.id, error: String(err).slice(0, 300) });
			return 0;
		}
	}
}

// POST /blobs/copy-clones { root_entry_id } | { workspace_id } →
// { copied, failed }. fork_workspace clones rows pointing at the SOURCE's
// storage_key (SQL cannot reach B2); the client calls this right after the
// RPC so the fork gets its own objects without waiting for the GC sweep
// (gc.ts), which is the guarantee if this call never arrives. Same-workspace
// copies are not re-keyed at all — see list_subtree_files in rpc.sql
// One call per account at a time: parallel calls get the same list and
// would copy the same files, the late copy of each left as an orphan. The
// fork → copy → delete loop is bounded in SQL (fork_workspace, 20 an hour)
const copying = new Set<string>();

export async function handle_copy_clones(
	env: Env,
	s3: Storage,
	db: SupabaseClient | null,
	req: Request,
): Promise<Response> {
	if (!db) throw new ApiError(503, "service role is not configured on the backend");
	const token = bearer_token(req);
	const client = user_client(env, token);
	const user = await require_user(client, token);
	if (copying.has(user.id)) {
		throw new ApiError(429, "a copy is already running for this account", {}, { "Retry-After": "5" });
	}
	copying.add(user.id);
	try {
		return await copy_clones_for(db, s3, client, user, req);
	} finally {
		copying.delete(user.id);
	}
}

async function copy_clones_for(
	db: SupabaseClient,
	s3: Storage,
	client: ReturnType<typeof user_client>,
	user: Awaited<ReturnType<typeof require_user>>,
	req: Request,
): Promise<Response> {
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
