import { describe, expect, test } from "bun:test";
import { background_jobs, drain, is_managed_key, rekey_batch, type RekeySweep } from "./gc";
import type { S3Client } from "bun";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env";

describe("GC reference checks", () => {
	async function run(references: Record<string, unknown> | null, error: unknown = null) {
		const removed: string[] = [];
		const dropped: number[] = [];
		const queue = ["shared", "live", "orphan"].map((storage_key, id) => ({ id, storage_key, attempts: 0 }));
		const db = {
			async rpc(name: string, args: { p_keys: string[] }) {
				expect(name).toBe("blob_references");
				expect(args.p_keys).toEqual(["shared", "live", "orphan"]);
				return { data: references, error };
			},
			from(table: string) {
				expect(table).toBe("blob_deletions");
				const query = {
					select() { return query; },
					lt() { return query; },
					order() { return query; },
					async limit() { return { data: queue, error: null }; },
					async gte() { return { count: 0, error: null }; },
					delete() { return query; },
					async eq(_column: string, id: number) { dropped.push(id); return { error: null }; },
				};
				return query;
			},
		} as unknown as SupabaseClient;
		await drain(
			{ gc_min_age_hours: 24, gc_max_attempts: 25, gc_batch_size: 100 } as Env,
			{ delete: async (key: string) => { removed.push(key); } } as unknown as S3Client,
			db,
		);
		return { removed, dropped };
	}

	test("uses per-key answers, not a capped list of referencing entries", async () => {
		// The SQL regression suite supplies >1000 rows for 'shared'; that count
		// must never hide the single reference to 'live' from this drain.
		expect(await run({ shared: true, live: true, orphan: false })).toEqual({
			removed: ["orphan"], dropped: [0, 1, 2],
		});
	});

	test("an incomplete or failed response keeps the whole batch", async () => {
		for (const response of [null, { shared: true, orphan: false }, { shared: true, live: "false", orphan: false }]) {
			expect(await run(response)).toEqual({ removed: [], dropped: [] });
		}
		expect(await run(null, { message: "database unavailable" })).toEqual({ removed: [], dropped: [] });
	});
});

describe("is_managed_key", () => {
	const WS = "11111111-1111-4111-8111-111111111111";
	const ID = "abababab-abab-4bab-8bab-abababababab";

	test("originals, Hub covers and previews are managed", () => {
		expect(is_managed_key(`${WS}/${ID}.png`)).toBe(true);
		expect(is_managed_key(`${WS}/${ID}`)).toBe(true);
		expect(is_managed_key(`hub/${WS}/${ID}.webp`)).toBe(true);
		expect(is_managed_key(`deriv/${WS}/${ID}/thumb.webp`)).toBe(true);
		expect(is_managed_key(`deriv/${WS}/${ID}/poster.jpg`)).toBe(true);
	});

	// Staging is the only key family nothing ever references: every object a
	// client PUT stays behind once finalize has copied it, so reconcile must
	// own the prefix or the bucket grows a second copy of every upload
	test("staging uploads are managed and never referenced", () => {
		expect(is_managed_key(`uploads/blob/${WS}/${ID}.png`)).toBe(true);
		expect(is_managed_key(`uploads/blob/${WS}/${ID}`)).toBe(true);
		expect(is_managed_key(`uploads/hub_preview/${WS}/${ID}.webp`)).toBe(true);
		expect(is_managed_key(`uploads/other/${WS}/${ID}.png`)).toBe(false);
		expect(is_managed_key(`uploads/${WS}/${ID}.png`)).toBe(false);
	});

	test("anything else in the bucket is left alone", () => {
		expect(is_managed_key(`deriv/${WS}/${ID}/other.webp`)).toBe(false);
		expect(is_managed_key(`deriv/${WS}/${ID}.webp`)).toBe(false);
		expect(is_managed_key(`backups/${WS}/${ID}.png`)).toBe(false);
		expect(is_managed_key("README.txt")).toBe(false);
	});
});

describe("background_jobs", () => {
	test("stop() waits for a running job, then no new run starts", async () => {
		const jobs = background_jobs();
		let release!: () => void;
		let finished = false;
		const running = jobs.wrap(async () => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			finished = true;
		})();

		let stopped = false;
		const stopping = jobs.stop().then(() => {
			stopped = true;
		});
		await Bun.sleep(0);
		expect(stopped).toBe(false);
		release();
		await stopping;
		expect(finished).toBe(true);
		await running;

		let ran = false;
		await jobs.wrap(async () => {
			ran = true;
		})();
		expect(ran).toBe(false);
	});

	test("a failed run does not hold up stop()", async () => {
		const jobs = background_jobs();
		await jobs
			.wrap(async () => {
				throw new Error("boom");
			})()
			.catch(() => {});
		await jobs.stop();
	});
});

describe("the re-key sweep reaches every forked blob", () => {
	type Row = { id: string; workspace_id: string; storage_key: string; created_at: string };
	const row = (n: number): Row => ({
		id: `id-${String(n).padStart(3, "0")}`,
		workspace_id: "ws",
		storage_key: `src/${n}`,
		created_at: `2026-11-26T10:00:${String(n).padStart(2, "0")}Z`,
	});

	/** A queue whose rows leave it once copied; `broken` ones never copy. */
	function queue(rows: Row[], broken: Set<string> = new Set()) {
		const asked: (string | null)[] = [];
		const sweep: RekeySweep = {
			list: async (limit, after) => {
				asked.push(after ? after.id : null);
				return rows
					.filter((item) => !after || item.created_at > after.created_at || (item.created_at === after.created_at && item.id > after.id))
					.slice(0, limit);
			},
			copy: async (batch) => {
				const failed = batch.filter((item) => broken.has(item.id));
				for (const item of batch) {
					if (!broken.has(item.id)) rows.splice(rows.findIndex((other) => other.id === item.id), 1);
				}
				return { copied: batch.length - failed.length, failed };
			},
		};
		return { sweep, rows, asked };
	}

	test("rows that never copy do not hold back the ones behind them", async () => {
		// the three oldest rows have lost their source object
		const q = queue([1, 2, 3, 4, 5, 6, 7].map(row), new Set(["id-001", "id-002", "id-003"]));
		let cursor = await rekey_batch(q.sweep, null, 3);
		expect(cursor).toEqual({ created_at: row(3).created_at, id: "id-003" });
		expect(q.rows.map((item) => item.id)).toEqual(["id-001", "id-002", "id-003", "id-004", "id-005", "id-006", "id-007"]);
		cursor = await rekey_batch(q.sweep, cursor, 3);
		cursor = await rekey_batch(q.sweep, cursor, 3);
		// everything that can be copied has been; the pass is over
		expect(q.rows.map((item) => item.id)).toEqual(["id-001", "id-002", "id-003"]);
		expect(cursor).toBeNull();
	});

	test("at the end the pass starts over, so a row that failed is tried again", async () => {
		const q = queue([1, 2, 3].map(row), new Set(["id-001"]));
		const cursor = await rekey_batch(q.sweep, { created_at: row(3).created_at, id: "id-003" }, 2);
		expect(q.asked).toEqual(["id-003", null]);
		expect(q.rows.map((item) => item.id)).toEqual(["id-001", "id-003"]);
		expect(cursor).toEqual({ created_at: row(2).created_at, id: "id-002" });
	});

	test("a list that could not be read leaves the place where it is", async () => {
		const at = { created_at: row(2).created_at, id: "id-002" };
		expect(await rekey_batch({ list: async () => null, copy: async () => ({ copied: 0, failed: [] }) }, at)).toEqual(at);
	});

	test("a database from before the cursor is read from the oldest row every time, as it was", async () => {
		const old_rows = [1, 2, 3].map((n) => ({ id: `id-${n}`, workspace_id: "ws", storage_key: `src/${n}` }));
		const cursor = await rekey_batch({ list: async () => old_rows, copy: async () => ({ copied: 3, failed: [] }) }, null, 3);
		expect(cursor).toBeNull();
	});
});
