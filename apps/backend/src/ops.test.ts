import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { OpsErrorLog, create_health, ops_alerts, ops_tick, type OpsAlert, type OpsLimits, type OpsSnapshot } from "./ops";

const GIB = 1024 ** 3;
const LIMITS: OpsLimits = {
	errors_per_window: 5,
	database_alert_bytes: 6 * GIB,
	storage_alert_bytes: 1024 * GIB,
	gc_min_age_hours: 24,
	bounces_per_day: 5,
};
const QUIET: OpsSnapshot = {
	database_bytes: 1 * GIB,
	stored_bytes: 10 * GIB,
	gc_queue: 3,
	gc_dead: 0,
	gc_oldest_hours: 20,
	mail_complaints_day: 0,
	mail_bounces_day: 1,
};
const NO_ERRORS = { count: 0, samples: [] };
const keys = (alerts: OpsAlert[]) => alerts.map((alert) => alert.key);

let muted: { mockRestore(): void }[] = [];
beforeEach(() => {
	muted = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {})];
});
afterEach(() => {
	for (const spy of muted) spy.mockRestore();
});

describe("ops_alerts", () => {
	test("a quiet system mails nothing", () => {
		expect(ops_alerts(QUIET, NO_ERRORS, LIMITS)).toEqual([]);
		expect(ops_alerts(QUIET, { count: 4, samples: ["POST /finalize: boom"] }, LIMITS)).toEqual([]);
	});

	test("a run of failed requests is told with the first of them", () => {
		const [alert] = ops_alerts(QUIET, { count: 7, samples: ["POST /finalize: storage copy failed"] }, LIMITS);
		expect(alert?.key).toBe("backend_errors");
		expect(alert?.subject).toContain("7 requests");
		expect(alert?.lines).toContain("POST /finalize: storage copy failed");
	});

	test("deletions the GC gave up on, and a GC that is not getting to its queue", () => {
		expect(keys(ops_alerts({ ...QUIET, gc_dead: 2 }, NO_ERRORS, LIMITS))).toEqual(["gc_dead"]);
		// a row may wait GC_MIN_AGE_HOURS, and a day more before it is a sign
		expect(keys(ops_alerts({ ...QUIET, gc_oldest_hours: 47 }, NO_ERRORS, LIMITS))).toEqual([]);
		expect(keys(ops_alerts({ ...QUIET, gc_oldest_hours: 49 }, NO_ERRORS, LIMITS))).toEqual(["gc_stuck"]);
		expect(keys(ops_alerts({ ...QUIET, gc_queue: 0, gc_oldest_hours: null }, NO_ERRORS, LIMITS))).toEqual([]);
	});

	test("the database and the storage past their marks", () => {
		expect(keys(ops_alerts({ ...QUIET, database_bytes: 6 * GIB }, NO_ERRORS, LIMITS))).toEqual(["database_size"]);
		expect(keys(ops_alerts({ ...QUIET, stored_bytes: 1024 * GIB }, NO_ERRORS, LIMITS))).toEqual(["storage_size"]);
	});

	test("one complaint is worth a mail; bounces from the fifth", () => {
		expect(keys(ops_alerts({ ...QUIET, mail_complaints_day: 1 }, NO_ERRORS, LIMITS))).toEqual(["mail"]);
		expect(keys(ops_alerts({ ...QUIET, mail_bounces_day: 4 }, NO_ERRORS, LIMITS))).toEqual([]);
		expect(keys(ops_alerts({ ...QUIET, mail_bounces_day: 5 }, NO_ERRORS, LIMITS))).toEqual(["mail"]);
	});

	test("without the database's answer the failed requests are still told", () => {
		expect(keys(ops_alerts(null, { count: 9, samples: [] }, LIMITS))).toEqual(["backend_errors"]);
		expect(ops_alerts(null, NO_ERRORS, LIMITS)).toEqual([]);
	});
});

describe("OpsErrorLog", () => {
	test("counts every failure, keeps the first five, and starts over after a look", () => {
		const log = new OpsErrorLog();
		for (let i = 1; i <= 8; i++) log.note("POST /finalize", new Error(`boom ${i}`));
		const taken = log.take();
		expect(taken.count).toBe(8);
		expect(taken.samples).toEqual([1, 2, 3, 4, 5].map((i) => `POST /finalize: boom ${i}`));
		expect(log.take()).toEqual({ count: 0, samples: [] });
	});

	test("a long message is cut", () => {
		const log = new OpsErrorLog();
		log.note("GET /presign", "x".repeat(5000));
		expect(log.take().samples[0]!.length).toBe(300);
	});
});

describe("ops_tick", () => {
	const HOUR = 60 * 60 * 1000;

	function watch(snapshot: () => Promise<OpsSnapshot | null>) {
		const mailed: string[] = [];
		const clock = { now: Date.UTC(2026, 10, 24) };
		const errors = new OpsErrorLog();
		const sent = new Map<string, number>();
		const tick = () => ops_tick(errors, LIMITS, sent, {
			snapshot,
			mail: async (alert) => { mailed.push(alert.key); },
			now: () => clock.now,
		});
		return { tick, mailed, clock, errors };
	}

	test("one mail per cause in 24 hours, however long it lasts", async () => {
		const h = watch(async () => ({ ...QUIET, gc_dead: 1 }));
		expect(await h.tick()).toEqual(["gc_dead"]);
		h.clock.now += 10 * 60 * 1000;
		expect(await h.tick()).toEqual([]);
		h.clock.now += 23 * HOUR;
		expect(await h.tick()).toEqual([]);
		h.clock.now += HOUR;
		expect(await h.tick()).toEqual(["gc_dead"]);
		expect(h.mailed).toEqual(["gc_dead", "gc_dead"]);
	});

	test("a database that does not answer counts as a failure and does not stop the look", async () => {
		const h = watch(async () => { throw new Error("connection refused"); });
		for (let i = 0; i < 4; i++) h.errors.note("POST /finalize", "boom");
		expect(await h.tick()).toEqual(["backend_errors"]);
	});

	test("a mail that could not be sent is tried again at the next look", async () => {
		let fail = true;
		const errors = new OpsErrorLog();
		const sent = new Map<string, number>();
		const deps = {
			snapshot: async () => ({ ...QUIET, mail_complaints_day: 2 }),
			mail: async () => { if (fail) throw new Error("plunk down"); },
		};
		expect(await ops_tick(errors, LIMITS, sent, deps)).toEqual([]);
		fail = false;
		expect(await ops_tick(errors, LIMITS, sent, deps)).toEqual(["mail"]);
	});
});

describe("GET /health", () => {
	test("200 while the database answers, 503 when it does not", async () => {
		let up = true;
		const clock = { now: 0 };
		const health = create_health(async () => up, () => clock.now);
		const first = await health();
		expect(first.status).toBe(200);
		expect(await first.json()).toEqual({ ok: true, database: true });
		up = false;
		clock.now += 16_000;
		const second = await health();
		expect(second.status).toBe(503);
		expect(await second.json()).toEqual({ ok: false, database: false });
	});

	test("asked often, it asks the database once in 15 seconds", async () => {
		let probes = 0;
		const clock = { now: 0 };
		const health = create_health(async () => { probes += 1; return true; }, () => clock.now);
		await Promise.all([health(), health(), health()]);
		clock.now += 14_000;
		await health();
		expect(probes).toBe(1);
		clock.now += 2_000;
		await health();
		expect(probes).toBe(2);
	});

	test("a probe that throws is a database that does not answer", async () => {
		const health = create_health(async () => { throw new Error("no route"); }, () => 0);
		expect((await health()).status).toBe(503);
	});
});
