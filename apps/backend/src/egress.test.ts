import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
	EgressMeter,
	create_download_meter,
	enforces,
	type EgressAlert,
	type EgressConfig,
	type EgressPendingRow,
	type EgressSyncRow,
} from "./egress";
import type { Env } from "./env";
import { visitor_key } from "./ratelimit";

const OWNER = "11111111-1111-4111-8111-111111111111";
const KIB = 1024;
const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
const T0 = Date.UTC(2026, 8, 11, 12, 0, 0); // 2026-09-11 12:00 UTC

type Limits = { budget: number | null; max_public: number | null };

// In-memory stand-in for egress_sync / egress_notices with the same contract:
// rows with bytes > 0 are added per owner/day, unknown owners are skipped,
// every known owner mentioned gets today's and this month's totals back
function harness(config: Partial<EgressConfig> = {}, limits: Limits = { budget: 20 * GIB, max_public: 10 * MIB }) {
	const db = new Map<string, number>();
	const owners = new Map<string, Limits>([[OWNER, limits]]);
	const syncs: EgressPendingRow[][] = [];
	const claims = new Set<string>();
	const alerts: EgressAlert[] = [];
	const clock = { now: T0 };
	const control = { fail: false, hold: null as Promise<void> | null };

	const meter = new EgressMeter(
		{ mode: "off", alert_day_fraction: 0.25, visitor_fraction: 0.05, ...config },
		{
			now: () => clock.now,
			sync: async (today, rows) => {
				syncs.push(rows.map((r) => ({ ...r })));
				if (control.hold) await control.hold;
				if (control.fail) throw new Error("db down");
				for (const r of rows) {
					if (r.bytes <= 0 || !owners.has(r.owner_id)) continue;
					const key = `${r.owner_id} ${r.day}`;
					db.set(key, (db.get(key) ?? 0) + r.bytes);
				}
				const month = today.slice(0, 7);
				const answer: EgressSyncRow[] = [];
				for (const owner_id of new Set(rows.map((r) => r.owner_id))) {
					const owner = owners.get(owner_id);
					if (!owner) continue;
					let day_bytes = 0;
					let month_bytes = 0;
					for (const [key, bytes] of db) {
						const [o, d] = key.split(" ") as [string, string];
						if (o !== owner_id) continue;
						if (d === today) day_bytes += bytes;
						if (d.startsWith(month) && d <= today) month_bytes += bytes;
					}
					answer.push({
						owner_id,
						day_bytes,
						month_bytes,
						egress_bytes_month: owner.budget,
						max_public_file_bytes: owner.max_public,
					});
				}
				return answer;
			},
			claim: async (owner_id, period, kind) => {
				const key = `${owner_id} ${period} ${kind}`;
				if (claims.has(key)) return false;
				claims.add(key);
				return true;
			},
			alert: async (alert) => {
				alerts.push(alert);
			},
		},
	);
	return { meter, db, syncs, claims, alerts, clock, control };
}

type Harness = ReturnType<typeof harness>;

function visit(h: Harness, size: number, opts: { visitor?: string; gate?: boolean } = {}) {
	return h.meter.admit({
		owner_id: OWNER,
		size_bytes: size,
		visitor: opts.visitor ?? "203.0.113.7",
		gate_file_size: opts.gate ?? true,
	});
}

let muted: { mockRestore(): void }[] = [];
beforeEach(() => {
	muted = [
		spyOn(console, "log").mockImplementation(() => {}),
		spyOn(console, "warn").mockImplementation(() => {}),
		spyOn(console, "error").mockImplementation(() => {}),
	];
});
afterEach(() => {
	for (const spy of muted) spy.mockRestore();
});

describe("EgressMeter", () => {
	test("a served download is charged and flushed as one row per owner/day", async () => {
		const h = harness();
		expect(await visit(h, 3 * MIB)).toEqual({ allowed: true });
		expect(await visit(h, 2 * MIB)).toEqual({ allowed: true });
		await h.meter.flush();
		expect(h.db.get(`${OWNER} 2026-09-11`)).toBe(5 * MIB);
		expect(h.syncs.at(-1)).toEqual([{ owner_id: OWNER, day: "2026-09-11", bytes: 5 * MIB }]);
	});

	test("concurrent first downloads share one state load", async () => {
		const h = harness();
		await Promise.all(Array.from({ length: 100 }, () => visit(h, 1)));
		expect(h.syncs).toEqual([[{ owner_id: OWNER, day: "2026-09-11", bytes: 0 }]]);
		await h.meter.flush();
		expect(h.db.get(`${OWNER} 2026-09-11`)).toBe(100);
	});

	test("off: nothing is refused and everything served is charged", async () => {
		const h = harness({ mode: "off" }, { budget: 10 * MIB, max_public: 1 * MIB });
		expect(await visit(h, 5 * MIB)).toEqual({ allowed: true });
		expect(await visit(h, 20 * MIB)).toEqual({ allowed: true });
		await h.meter.flush();
		expect(h.db.get(`${OWNER} 2026-09-11`)).toBe(25 * MIB);
	});

	test("file_size: only the original cap refuses, and a refusal is not charged", async () => {
		const h = harness({ mode: "file_size" }, { budget: 10 * MIB, max_public: 1 * MIB });
		expect(await visit(h, 2 * MIB)).toEqual({ allowed: false, reason: "public_file_size", status: 403 });
		// Hub covers skip the size gate; the share and the budget only count here
		expect(await visit(h, 2 * MIB, { gate: false })).toEqual({ allowed: true });
		expect(await visit(h, 1 * MIB)).toEqual({ allowed: true });
		await h.meter.flush();
		expect(h.db.get(`${OWNER} 2026-09-11`)).toBe(3 * MIB);
	});

	test("all: the visitor share stops one visitor until UTC midnight, not the next one", async () => {
		const h = harness({ mode: "all" }, { budget: 20 * MIB, max_public: 10 * MIB });
		// share = 5% of 20 MiB = 1 MiB
		expect(await visit(h, 600 * KIB, { visitor: "a" })).toEqual({ allowed: true });
		expect(await visit(h, 600 * KIB, { visitor: "a" })).toEqual({
			allowed: false,
			reason: "visitor_share",
			status: 429,
			retry_after_s: 12 * 3600,
		});
		expect(await visit(h, 600 * KIB, { visitor: "b" })).toEqual({ allowed: true });
		h.clock.now = Date.UTC(2026, 8, 12, 0, 0, 0);
		expect(await visit(h, 600 * KIB, { visitor: "a" })).toEqual({ allowed: true });
	});

	test("all: the monthly budget counts bytes before they are flushed", async () => {
		const h = harness({ mode: "all", visitor_fraction: 1 }, { budget: 10 * MIB, max_public: 10 * MIB });
		expect(await visit(h, 6 * MIB)).toEqual({ allowed: true });
		expect(await visit(h, 5 * MIB)).toEqual({ allowed: false, reason: "egress_budget", status: 403 });
		expect(await visit(h, 4 * MIB)).toEqual({ allowed: true });
		expect(await visit(h, 1)).toEqual({ allowed: false, reason: "egress_budget", status: 403 });
		await h.meter.flush();
		expect(h.db.get(`${OWNER} 2026-09-11`)).toBe(10 * MIB);
	});

	test("bytes flushed earlier (another process) count toward the month", async () => {
		const h = harness({ mode: "all", visitor_fraction: 1 }, { budget: 10 * MIB, max_public: 10 * MIB });
		h.db.set(`${OWNER} 2026-09-01`, 9 * MIB);
		expect(await visit(h, 2 * MIB)).toEqual({ allowed: false, reason: "egress_budget", status: 403 });
		expect(await visit(h, 1 * MIB)).toEqual({ allowed: true });
	});

	test("a new UTC month starts from zero", async () => {
		const h = harness({ mode: "all", visitor_fraction: 1 }, { budget: 10 * MIB, max_public: 10 * MIB });
		h.db.set(`${OWNER} 2026-09-30`, 10 * MIB);
		h.clock.now = Date.UTC(2026, 8, 30, 23, 0, 0);
		expect(await visit(h, 1 * MIB)).toEqual({ allowed: false, reason: "egress_budget", status: 403 });
		h.clock.now = Date.UTC(2026, 9, 1, 0, 5, 0);
		expect(await visit(h, 1 * MIB)).toEqual({ allowed: true });
	});

	test("downloads admitted during a flush still count after it", async () => {
		const h = harness({ mode: "all", visitor_fraction: 1 }, { budget: 10 * MIB, max_public: 10 * MIB });
		await visit(h, 4 * MIB);
		let release!: () => void;
		h.control.hold = new Promise<void>((resolve) => {
			release = resolve;
		});
		const flushing = h.meter.flush();
		expect(await visit(h, 4 * MIB)).toEqual({ allowed: true });
		release();
		await flushing;
		h.control.hold = null;
		expect(await visit(h, 3 * MIB)).toEqual({ allowed: false, reason: "egress_budget", status: 403 });
		await h.meter.flush();
		expect(h.db.get(`${OWNER} 2026-09-11`)).toBe(8 * MIB);
	});

	test("a state reload during a flush does not count the in-flight batch twice", async () => {
		const h = harness({ mode: "all", visitor_fraction: 1 }, { budget: 10 * MIB, max_public: 10 * MIB });
		await visit(h, 4 * MIB);
		let release!: () => void;
		h.control.hold = new Promise<void>((resolve) => {
			release = resolve;
		});
		const flushing = h.meter.flush();
		await Bun.sleep(0); // the flush has taken its batch and waits on the RPC
		h.clock.now += 5 * 60_000 + 1; // the cached state is stale: the next download reloads it
		const reloading = visit(h, 1 * MIB);
		release();
		await flushing;
		expect(await reloading).toEqual({ allowed: true });
		h.control.hold = null;
		// 5 MiB really served; counting the batch twice would make this 13 MiB
		expect(await visit(h, 4 * MIB)).toEqual({ allowed: true });
	});

	test("a flush called during a running one also sends the bytes admitted meanwhile", async () => {
		const h = harness();
		await visit(h, 1 * MIB);
		let release!: () => void;
		h.control.hold = new Promise<void>((resolve) => {
			release = resolve;
		});
		const cron_flush = h.meter.flush();
		await Bun.sleep(0);
		await visit(h, 2 * MIB);
		const shutdown_flush = h.meter.flush();
		h.control.hold = null;
		release();
		await Promise.all([cron_flush, shutdown_flush]);
		expect(h.db.get(`${OWNER} 2026-09-11`)).toBe(3 * MIB);
	});

	test("all: a budget refusal raises alert_month though the flushed total stays under it", async () => {
		const h = harness(
			{ mode: "all", visitor_fraction: 1, alert_day_fraction: 1 },
			{ budget: 10 * MIB, max_public: 10 * MIB },
		);
		await visit(h, 9 * MIB);
		await h.meter.flush();
		expect(h.alerts).toEqual([]);
		expect(await visit(h, 2 * MIB)).toEqual({ allowed: false, reason: "egress_budget", status: 403 });
		await h.meter.flush();
		expect(h.alerts.map((a) => a.kind)).toEqual(["alert_month"]);
		expect(h.alerts[0]).toMatchObject({ month_bytes: 9 * MIB, budget_bytes: 10 * MIB, mode: "all" });
		expect(h.db.get(`${OWNER} 2026-09-11`)).toBe(9 * MIB);
		await visit(h, 2 * MIB);
		await h.meter.flush();
		expect(h.alerts).toHaveLength(1);
	});

	test("a database outage fails open and keeps the bytes for the next flush", async () => {
		const h = harness({ mode: "all", visitor_fraction: 1 }, { budget: 1 * MIB, max_public: 10 * MIB });
		h.control.fail = true;
		expect(await visit(h, 5 * MIB)).toEqual({ allowed: true });
		await h.meter.flush();
		expect(h.db.size).toBe(0);
		h.control.fail = false;
		await h.meter.flush();
		expect(h.db.get(`${OWNER} 2026-09-11`)).toBe(5 * MIB);
	});

	test("alerts: a spike once a day, the budget once a month, in any mode", async () => {
		const h = harness({ mode: "off", visitor_fraction: 1 }, { budget: 20 * MIB, max_public: 100 * MIB });
		await visit(h, 4 * MIB);
		await h.meter.flush();
		expect(h.alerts).toEqual([]);
		await visit(h, 1 * MIB); // 5 MiB today = a quarter of the budget
		await h.meter.flush();
		expect(h.alerts.map((a) => [a.kind, a.period])).toEqual([["alert_day", "2026-09-11"]]);
		await visit(h, 1 * MIB);
		await h.meter.flush();
		expect(h.alerts).toHaveLength(1);
		await visit(h, 14 * MIB); // 20 MiB this month
		await h.meter.flush();
		expect(h.alerts.map((a) => a.kind)).toEqual(["alert_day", "alert_month"]);
		expect(h.alerts[1]).toMatchObject({
			owner_id: OWNER,
			period: "2026-09-01",
			month_bytes: 20 * MIB,
			budget_bytes: 20 * MIB,
			mode: "off",
		});
	});

	test("an alert recorded before a restart is not sent again", async () => {
		const h = harness({ visitor_fraction: 1 }, { budget: 20 * MIB, max_public: 100 * MIB });
		h.claims.add(`${OWNER} 2026-09-11 alert_day`);
		await visit(h, 6 * MIB);
		await h.meter.flush();
		expect(h.alerts).toEqual([]);
	});

	test("an unlimited budget has no share, no refusals and no alerts", async () => {
		const h = harness({ mode: "all" }, { budget: null, max_public: null });
		expect(await visit(h, 50 * GIB)).toEqual({ allowed: true });
		await h.meter.flush();
		expect(h.alerts).toEqual([]);
	});

	test("all: without a visitor share the budget is the only limit", async () => {
		const h = harness({ mode: "all", visitor_fraction: null }, { budget: 10 * MIB, max_public: null });
		// one visitor takes the whole budget: a 5% share would stop it at 512 KiB
		expect(await visit(h, 6 * MIB, { gate: false })).toEqual({ allowed: true });
		expect(await visit(h, 4 * MIB, { gate: false })).toEqual({ allowed: true });
		expect(await visit(h, 1, { gate: false })).toEqual({ allowed: false, reason: "egress_budget", status: 403 });
		await h.meter.flush();
		expect(h.db.get(`${OWNER} 2026-09-11`)).toBe(10 * MIB);
	});
});

describe("create_download_meter", () => {
	test("charges the downloader through download_sync against download_bytes_month", async () => {
		const calls: { name: string; args: Record<string, unknown> }[] = [];
		const db = {
			rpc: async (name: string, args: Record<string, unknown>) => {
				calls.push({ name, args });
				return {
					data: [{ user_id: OWNER, day_bytes: 0, month_bytes: 0, download_bytes_month: 1 * MIB }],
					error: null,
				};
			},
		} as unknown as SupabaseClient;
		const env = { egress: { mode: "all", alert_day_fraction: 0.25 } } as unknown as Env;
		const meter = create_download_meter(env, db);
		const download = { owner_id: OWNER, size_bytes: 600 * KIB, visitor: "203.0.113.7", gate_file_size: false };
		expect(await meter.admit(download)).toEqual({ allowed: true });
		expect(await meter.admit(download)).toEqual({ allowed: false, reason: "egress_budget", status: 403 });
		await meter.flush();
		expect(calls.map((call) => call.name)).toEqual(["download_sync", "download_sync"]);
		expect(calls[1]?.args.p_rows).toEqual([{ user_id: OWNER, day: expect.any(String), bytes: 600 * KIB }]);
	});
});

describe("enforces", () => {
	test("each mode turns on its refusals", () => {
		expect(enforces("off", "public_file_size")).toBe(false);
		expect(enforces("file_size", "public_file_size")).toBe(true);
		expect(enforces("file_size", "visitor_share")).toBe(false);
		expect(enforces("file_size", "egress_budget")).toBe(false);
		expect(enforces("all", "visitor_share")).toBe(true);
		expect(enforces("all", "egress_budget")).toBe(true);
	});
});

describe("visitor_key", () => {
	test("IPv4 is kept; IPv4-mapped IPv6 is its v4 address", () => {
		expect(visitor_key("203.0.113.7")).toBe("203.0.113.7");
		expect(visitor_key("::ffff:203.0.113.7")).toBe("203.0.113.7");
	});

	test("IPv6 is bucketed by /64", () => {
		expect(visitor_key("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
		expect(visitor_key("2001:0DB8:0001:0002:ffff:ffff:ffff:ffff")).toBe("2001:db8:1:2::/64");
		expect(visitor_key("2001:db8::1")).toBe("2001:db8:0:0::/64");
		expect(visitor_key("::1")).toBe("0:0:0:0::/64");
	});

	test("unparsable input is used as is", () => {
		expect(visitor_key("unknown")).toBe("unknown");
		expect(visitor_key("1:2:3")).toBe("1:2:3");
	});
});
