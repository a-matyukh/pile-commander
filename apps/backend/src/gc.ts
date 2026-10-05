import type { S3Client } from "bun";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env";
import { copy_foreign_blobs, type ForeignBlobRow } from "./copy";
import { DERIV_KEY_RE } from "./derivatives";
import { STAGING_KEY_RE } from "./uploads";

type DeletionRow = { id: number; storage_key: string; attempts: number };
const REKEY_BATCH = 100;

const STORAGE_KEY_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}(\.[a-z0-9]{1,16})?$/i;
const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const HUB_PREVIEW_KEY_RE = new RegExp(`^hub/${UUID_RE}/${UUID_RE}\\.(jpe?g|png|webp)$`, "i");
const KNOWN_KEYS_PAGE = 1000;
const PRUNE_BATCH = 1000;
const PRUNE_MAX_ROUNDS = 50;

// Reconcile only ever considers keys of these shapes. Anything else in the
// bucket is skipped, never enqueued — so a new key family must be added here,
// or its objects leak forever. A family whose keys a row can point at must
// ALSO join KEY_SOURCES below; `uploads/` deliberately does not, because no
// row ever references staging — finalize copies it to a fresh, private key
// and the client's writable object is left to expire as an orphan
export function is_managed_key(key: string): boolean {
	return STORAGE_KEY_RE.test(key) || HUB_PREVIEW_KEY_RE.test(key) || DERIV_KEY_RE.test(key) || STAGING_KEY_RE.test(key);
}
const ORPHAN_CHUNK = 200;

// Where live object keys are referenced: originals, Hub covers, previews.
// cursor is a unique column to page by (see collect_keys)
type KeySource = {
	table: "entries" | "hub_publications" | "entry_derivatives";
	column: "storage_key" | "preview_key" | "deriv_key";
	cursor: "id" | "source_workspace_id" | "deriv_key";
};

const KEY_SOURCES: readonly KeySource[] = [
	{ table: "entries", column: "storage_key", cursor: "id" },
	{ table: "hub_publications", column: "preview_key", cursor: "source_workspace_id" },
	{ table: "entry_derivatives", column: "deriv_key", cursor: "deriv_key" },
];

// Drains the blob_deletions queue (schema.sql): hard-deleted entries leave
// their B2 keys here. Each successful S3 delete removes the queue row; a
// failure bumps attempts/last_error and the row is retried on the next tick.
// S3 delete is idempotent, so a crash between the S3 delete and the queue-row
// delete only costs one harmless retry.
// Rows younger than GC_MIN_AGE_HOURS are left alone: a workspace or account
// delete is instant and irreversible at the row level, and this grace period
// is the only window in which the objects can still be recovered by hand
export async function drain(env: Env, s3: S3Client, db: SupabaseClient): Promise<void> {
	const eligible_before = new Date(Date.now() - env.gc_min_age_hours * 3_600_000).toISOString();
	const { data: batch, error } = await db
		.from("blob_deletions")
		.select("id, storage_key, attempts")
		.lt("attempts", env.gc_max_attempts)
		.lt("queued_at", eligible_before)
		.order("id", { ascending: true })
		.limit(env.gc_batch_size);
	if (error) {
		console.error("[gc] failed to read blob_deletions:", error.message);
		return;
	}

	const rows = (batch ?? []) as DeletionRow[];

	// A queued key can still be referenced: publish/fork clones share the
	// original's storage_keys until the client's /blobs/copy-clones rewrites
	// them, and that hand-off races this drain. Never delete a referenced
	// blob — the queue row is junk, drop it without touching S3 (once the
	// clone's rows are rewritten the old key is a true orphan and the daily
	// reconcile re-enqueues it)
	const in_use = await list_referenced_keys(db, rows.map((row) => row.storage_key));
	if (!in_use) return; // references unverifiable — deleting blind risks live blobs

	let skipped = 0;
	for (const row of rows) {
		if (in_use.has(row.storage_key)) {
			skipped += 1;
			const { error: drop_error } = await db.from("blob_deletions").delete().eq("id", row.id);
			if (drop_error) {
				console.error(`[gc] referenced blob ${row.storage_key} kept, but queue row ${row.id} was not dropped:`, drop_error.message);
			}
			continue;
		}
		try {
			await s3.delete(row.storage_key);
			const { error: delete_error } = await db.from("blob_deletions").delete().eq("id", row.id);
			if (delete_error) {
				console.error(`[gc] blob deleted but queue row ${row.id} was not:`, delete_error.message);
			}
		} catch (err) {
			console.error(`[gc] failed to delete ${row.storage_key}:`, err);
			const { error: update_error } = await db
				.from("blob_deletions")
				.update({ attempts: row.attempts + 1, last_error: String(err).slice(0, 500) })
				.eq("id", row.id);
			if (update_error) {
				console.error(`[gc] failed to bump attempts for row ${row.id}:`, update_error.message);
			}
		}
	}
	if (rows.length > 0) {
		console.log(`[gc] processed ${rows.length} queued blob deletion(s) (${skipped} still referenced, kept)`);
	}

	// Dead letters are skipped by the drain query above — surface them loudly,
	// otherwise stuck blobs are only visible by querying the table by hand
	const { count, error: dead_error } = await db
		.from("blob_deletions")
		.select("id", { count: "exact", head: true })
		.gte("attempts", env.gc_max_attempts);
	if (dead_error) {
		console.error("[gc] failed to count dead-letter blobs:", dead_error.message);
	} else if (count && count > 0) {
		console.error(
			`[gc] DEAD LETTER: ${count} blob(s) gave up after ${env.gc_max_attempts} attempts — manual cleanup needed`,
		);
	}
}

// Re-key sweep: rows whose blob still sits under another workspace's prefix
// (fresh forks) get their own objects. The client's /blobs/copy-clones call
// right after fork_workspace is only an accelerator — this is the guarantee.
// Until a row is re-keyed the fork shares the source's object, and the drain
// above keeps such an object alive (it is still referenced), so the source
// owner cannot really free it. One batch per tick; the rest waits for the next
async function rekey_foreign_blobs(s3: S3Client, db: SupabaseClient): Promise<void> {
	const { data, error } = await db.rpc("list_foreign_blob_entries", { p_limit: REKEY_BATCH });
	if (error) {
		console.error("[rekey] failed to list foreign-prefixed rows:", error.message);
		return;
	}
	const rows = (data ?? []) as ForeignBlobRow[];
	if (rows.length === 0) return;
	const { copied, failed } = await copy_foreign_blobs(s3, db, rows, "[rekey]");
	console.log(`[rekey] re-keyed ${copied} forked blob(s)${failed.length ? `, ${failed.length} failed` : ""}`);
}

async function tick(env: Env, s3: S3Client, db: SupabaseClient): Promise<void> {
	// re-key first: a row that gets its own object stops pinning the source's
	// key, which the drain below may then release
	try {
		await rekey_foreign_blobs(s3, db);
	} catch (err) {
		console.error("[rekey] run failed:", err);
	}
	await drain(env, s3, db);
}

export type BackgroundJobs = {
	/** wraps a cron handler so stop() can wait for its runs */
	wrap(job: () => Promise<void>): () => Promise<void>;
	/** no new runs start; resolves once the running ones settle */
	stop(): Promise<void>;
};

// Runs of the in-process crons, so the SIGTERM drain can let a GC or
// reconcile tick finish instead of cutting it (index.ts)
export function background_jobs(): BackgroundJobs {
	const running = new Set<Promise<void>>();
	let stopped = false;
	return {
		wrap: (job) => async () => {
			if (stopped) return;
			const run = job();
			running.add(run);
			try {
				await run;
			} finally {
				running.delete(run);
			}
		},
		stop: async () => {
			stopped = true;
			await Promise.allSettled([...running]);
		},
	};
}

export function start_gc_worker(env: Env, s3: S3Client, db: SupabaseClient): { stop(): Promise<void> } {
	const jobs = background_jobs();
	// Bun.cron never overlaps runs: the next fire is scheduled only after the
	// handler settles. Errors are handled inside tick — an escaping rejection
	// would crash the process (see the unhandledRejection listener in index.ts)
	Bun.cron(env.gc_cron, jobs.wrap(() => tick(env, s3, db)));
	console.log(
		`[gc] worker scheduled: "${env.gc_cron}" (batch ${env.gc_batch_size}, min age ${env.gc_min_age_hours}h)`,
	);

	Bun.cron(
		env.reconcile_cron,
		jobs.wrap(async () => {
			try {
				await reconcile(env, s3, db);
			} catch (err) {
				console.error("[reconcile] run failed:", err);
			}
		}),
	);
	console.log(
		`[reconcile] worker scheduled: "${env.reconcile_cron}" (grace ${orphan_grace_hours(env)}h)`,
	);
	return { stop: jobs.stop };
}

// Which of the given keys an entry, a Hub listing or a preview still
// references. Trashed rows count (trash is restorable, and reconcile's
// known-keys list treats them the same). Null on query failure — callers
// must not delete then. Previews matter here, not only in reconcile: the
// worker writes an object before its row, so an object whose row insert
// failed can be enqueued as an orphan and then regenerated under the same
// derived key — this check is what keeps the live one
async function list_referenced_keys(db: SupabaseClient, keys: string[]): Promise<Set<string> | null> {
	if (keys.length === 0) return new Set<string>();
	// A SELECT of entries is capped by PostgREST's max_rows. Copies can fill
	// that entire response with ONE key, hiding references to the other keys.
	// The RPC returns one JSON object, with an explicit boolean for every key.
	const { data, error } = await db.rpc("blob_references", { p_keys: [...new Set(keys)] });
	if (error || !data || typeof data !== "object" || Array.isArray(data)) {
		console.error("[gc] failed to verify blob references:", error?.message ?? "invalid response");
		return null;
	}
	const found = new Set<string>();
	for (const key of keys) {
		const referenced = (data as Record<string, unknown>)[key];
		if (typeof referenced !== "boolean") {
			console.error("[gc] incomplete blob reference response; keeping the whole batch");
			return null;
		}
		if (referenced) found.add(key);
	}
	return found;
}

// Keyset pagination: PostgREST caps a response at 1000 rows by default, and
// offsets would skip rows — every page is its own snapshot, so a row deleted
// ahead of the offset pulls the next page's first key into the page already
// read, and a live key missing from `known` looks like an orphan
async function collect_keys(db: SupabaseClient, source: KeySource, into: Set<string>): Promise<boolean> {
	const columns = source.cursor === source.column ? source.column : `${source.column}, ${source.cursor}`;
	let after: string | null = null;
	for (;;) {
		let query = db
			.from(source.table)
			.select(columns)
			.not(source.column, "is", null)
			.order(source.cursor, { ascending: true })
			.limit(KNOWN_KEYS_PAGE);
		if (after !== null) query = query.gt(source.cursor, after);
		const { data, error } = await query;
		if (error) {
			console.error(`[reconcile] failed to read ${source.table}.${source.column}:`, error.message);
			return false;
		}
		const rows = (data ?? []) as unknown as Record<string, string | null>[];
		for (const row of rows) {
			const key = row[source.column];
			if (key) into.add(key);
		}
		if (rows.length < KNOWN_KEYS_PAGE) return true;
		after = rows[rows.length - 1]![source.cursor]!;
	}
}

// Every object key referenced by entries, Hub listings or previews
async function list_known_keys(db: SupabaseClient): Promise<Set<string> | null> {
	const known = new Set<string>();
	for (const source of KEY_SOURCES) {
		if (!(await collect_keys(db, source, known))) return null;
	}
	return known;
}

// Previews of blobs no entry references any more (after a hard delete, or a
// fork's re-key — an UPDATE no trigger on entries can tell apart from a live
// copy) are dropped here, and the row delete queues their objects. A failure
// is only logged: the rows stay, so their objects stay known and nothing is
// deleted by mistake
async function prune_derivatives(db: SupabaseClient): Promise<void> {
	let total = 0;
	for (let round = 0; round < PRUNE_MAX_ROUNDS; round += 1) {
		const { data, error } = await db.rpc("prune_entry_derivatives", { p_limit: PRUNE_BATCH });
		if (error) {
			console.error("[reconcile] failed to prune previews:", error.message);
			break;
		}
		const dropped = Number(data ?? 0);
		total += dropped;
		if (dropped < PRUNE_BATCH) break;
	}
	if (total > 0) console.log(`[reconcile] pruned ${total} preview row(s) of unreferenced blobs`);
}

// How long an object must be untouched before it counts as an orphan. The
// floor is RECONCILE_GRACE_HOURS, but never less than a PUT URL's lifetime
// plus half an hour: within that window a client can still legitimately be
// writing an object whose /finalize has not landed, and reaping it would
// delete a live upload. Past it, a managed key with no row is abandoned —
// which is the only bound on a presigned PUT, since its size cannot be signed
export function orphan_grace_hours(env: Pick<Env, "reconcile_grace_hours" | "presign_put_ttl_seconds">): number {
	return Math.max(env.reconcile_grace_hours, env.presign_put_ttl_seconds / 3_600 + 0.5);
}

// Orphan reconciliation: diffs the B2 bucket against every referenced key
// (KEY_SOURCES), then enqueues unreferenced objects into blob_deletions.
// Safeguards against deleting in-flight writes (an upload's PUT done and its
// row still pending, a preview written before its row): only managed key
// shapes are considered, and only those older than the grace period
async function reconcile(env: Env, s3: S3Client, db: SupabaseClient): Promise<void> {
	await prune_derivatives(db);
	const known = await list_known_keys(db);
	if (!known) return;

	const cutoff = Date.now() - orphan_grace_hours(env) * 3_600_000;
	const orphans: string[] = [];

	let continuation_token: string | undefined;
	do {
		const page = await s3.list({ maxKeys: 1000, continuationToken: continuation_token });
		for (const object of page.contents ?? []) {
			if (!is_managed_key(object.key) || known.has(object.key)) continue;
			const modified = object.lastModified ? Date.parse(object.lastModified) : Number.NaN;
			if (!Number.isFinite(modified) || modified > cutoff) continue;
			orphans.push(object.key);
		}
		continuation_token = page.isTruncated ? page.nextContinuationToken : undefined;
	} while (continuation_token);

	if (orphans.length === 0) {
		console.log("[reconcile] no orphan blobs found");
		return;
	}

	// keys already queued are left to the drain — re-enqueueing on the next
	// daily run would only duplicate rows
	let enqueued = 0;
	for (let i = 0; i < orphans.length; i += ORPHAN_CHUNK) {
		const chunk = orphans.slice(i, i + ORPHAN_CHUNK);
		const { data: queued, error: queued_error } = await db
			.from("blob_deletions")
			.select("storage_key")
			.in("storage_key", chunk);
		if (queued_error) {
			console.error("[reconcile] failed to read blob_deletions:", queued_error.message);
			return;
		}
		const already_queued = new Set(
			(queued ?? []).map((row) => (row as { storage_key: string }).storage_key),
		);
		const fresh = chunk.filter((key) => !already_queued.has(key));
		if (fresh.length === 0) continue;

		const { error: insert_error } = await db
			.from("blob_deletions")
			.insert(fresh.map((storage_key) => ({ storage_key })));
		if (insert_error) {
			console.error("[reconcile] failed to enqueue orphans:", insert_error.message);
			return;
		}
		enqueued += fresh.length;
	}
	if (enqueued > 0) {
		console.log(`[reconcile] enqueued ${enqueued} orphan blob(s) for deletion`);
	}
}
