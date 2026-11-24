import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env";
import { plunk_send, type FetchLike } from "./mail";

// Operations watch. Nobody reads the Render log until something is already
// wrong, so the few signals that mean "look now" are mailed to the operator:
// the backend answering 500, deletions the GC gave up on or is not getting
// to, the database or the storage growing past a mark, and mail that
// bounces or draws complaints. Whether the backend is up at all is the one
// thing it cannot report itself: an outside monitor asks GET /health.

export type OpsSnapshot = {
	database_bytes: number;
	/** bytes of every file the entries point at; staging, previews and the queue are not in it */
	stored_bytes: number;
	gc_queue: number;
	gc_dead: number;
	/** age of the oldest row the GC should already have taken, in hours; null when none waits */
	gc_oldest_hours: number | null;
	mail_complaints_day: number;
	mail_bounces_day: number;
};

export type OpsLimits = {
	errors_per_window: number;
	database_alert_bytes: number;
	storage_alert_bytes: number;
	/** the GC takes a row after this long (GC_MIN_AGE_HOURS) */
	gc_min_age_hours: number;
	bounces_per_day: number;
};

export type OpsAlert = {
	/** one mail per key in 24 hours */
	key: string;
	subject: string;
	lines: string[];
};

export type OpsErrors = { count: number; samples: string[] };

const SAMPLES = 5;
const SAMPLE_LENGTH = 300;

/** 500s and unhandled rejections since the last look */
export class OpsErrorLog {
	private count = 0;
	private samples: string[] = [];

	note(where: string, error: unknown): void {
		this.count += 1;
		if (this.samples.length >= SAMPLES) return;
		const text = error instanceof Error ? error.message : String(error);
		this.samples.push(`${where}: ${text}`.slice(0, SAMPLE_LENGTH));
	}

	/** what was noted since the last call, and a clean slate */
	take(): OpsErrors {
		const taken = { count: this.count, samples: this.samples };
		this.count = 0;
		this.samples = [];
		return taken;
	}
}

function gib(bytes: number): string {
	return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

/** What is worth a mail right now. `snapshot` is null when the database could not be asked. */
export function ops_alerts(snapshot: OpsSnapshot | null, errors: OpsErrors, limits: OpsLimits): OpsAlert[] {
	const alerts: OpsAlert[] = [];
	if (errors.count >= limits.errors_per_window) {
		alerts.push({
			key: "backend_errors",
			subject: `[ops] The backend failed ${errors.count} requests in the last 10 minutes`,
			lines: ["The first of them:", ...errors.samples, "The Render log has the rest."],
		});
	}
	if (!snapshot) return alerts;

	if (snapshot.gc_dead > 0) {
		alerts.push({
			key: "gc_dead",
			subject: `[ops] The GC gave up on ${snapshot.gc_dead} file(s)`,
			lines: [
				"These objects stay in the storage until someone removes them by hand.",
				"public.blob_deletions, rows with attempts at GC_MAX_ATTEMPTS, has the keys and the last error.",
			],
		});
	}
	// a day of slack past the moment the GC should have taken the oldest row
	if (snapshot.gc_oldest_hours !== null && snapshot.gc_oldest_hours > limits.gc_min_age_hours + 24) {
		alerts.push({
			key: "gc_stuck",
			subject: `[ops] The GC is not keeping up: ${snapshot.gc_queue} deletion(s) wait`,
			lines: [
				`The oldest has waited ${Math.round(snapshot.gc_oldest_hours)} hours; the GC takes a row after ${limits.gc_min_age_hours}.`,
				"Deleted files are still paid for until it runs. Check that the worker is on and can reach the storage.",
			],
		});
	}
	if (snapshot.database_bytes >= limits.database_alert_bytes) {
		alerts.push({
			key: "database_size",
			subject: `[ops] The database is at ${gib(snapshot.database_bytes)}`,
			lines: [
				`The mark is ${gib(limits.database_alert_bytes)} (OPS_DATABASE_ALERT_BYTES).`,
				"Look at the disk in the Supabase dashboard before it fills: a full disk stops writes.",
			],
		});
	}
	if (snapshot.stored_bytes >= limits.storage_alert_bytes) {
		alerts.push({
			key: "storage_size",
			subject: `[ops] Files in the storage add up to ${gib(snapshot.stored_bytes)}`,
			lines: [
				`The mark is ${gib(limits.storage_alert_bytes)} (OPS_STORAGE_ALERT_BYTES).`,
				"Compare with the B2 caps: when a cap is reached, uploads stop for everyone.",
			],
		});
	}
	if (snapshot.mail_complaints_day > 0 || snapshot.mail_bounces_day >= limits.bounces_per_day) {
		alerts.push({
			key: "mail",
			subject: `[ops] Mail in the last day: ${snapshot.mail_complaints_day} complaint(s), ${snapshot.mail_bounces_day} bounce(s)`,
			lines: [
				"Complaints and bounces count against the sending domain.",
				"private.mail_events has the addresses and the accounts whose invites drew them.",
			],
		});
	}
	return alerts;
}

function to_snapshot(raw: unknown): OpsSnapshot | null {
	if (!raw || typeof raw !== "object") return null;
	const row = raw as Record<string, unknown>;
	const number = (name: string) => Number(row[name] ?? 0);
	return {
		database_bytes: number("database_bytes"),
		stored_bytes: number("stored_bytes"),
		gc_queue: number("gc_queue"),
		gc_dead: number("gc_dead"),
		gc_oldest_hours: row.gc_oldest_hours === null || row.gc_oldest_hours === undefined ? null : number("gc_oldest_hours"),
		mail_complaints_day: number("mail_complaints_day"),
		mail_bounces_day: number("mail_bounces_day"),
	};
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type OpsDeps = {
	/** null when the database cannot tell (unreachable, or from before ops_snapshot) */
	snapshot: () => Promise<OpsSnapshot | null>;
	mail: (alert: OpsAlert) => Promise<void>;
	now?: () => number;
};

/** One look: alerts that were not mailed in the last 24 hours go out. Returns their keys. */
export async function ops_tick(
	errors: OpsErrorLog,
	limits: OpsLimits,
	sent: Map<string, number>,
	deps: OpsDeps,
): Promise<string[]> {
	const now = (deps.now ?? Date.now)();
	let snapshot: OpsSnapshot | null = null;
	try {
		snapshot = await deps.snapshot();
	} catch (err) {
		// the database not answering is itself a failure worth counting
		errors.note("ops snapshot", err);
	}
	const mailed: string[] = [];
	for (const alert of ops_alerts(snapshot, errors.take(), limits)) {
		const last = sent.get(alert.key);
		if (last !== undefined && now - last < DAY_MS) continue;
		try {
			await deps.mail(alert);
			sent.set(alert.key, now);
			mailed.push(alert.key);
		} catch (err) {
			console.error(`[ops] could not mail ${alert.key}:`, err instanceof Error ? err.message : err);
		}
	}
	return mailed;
}

function escape_html(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function start_ops_worker(env: Env, db: SupabaseClient, errors: OpsErrorLog, send: FetchLike = fetch): void {
	const to = env.ops.alert_email;
	if (!to || !env.plunk_secret_key || !env.plunk_from_email) {
		console.warn("[ops] no OPS_ALERT_EMAIL (or no Plunk): alerts go to the log only");
	}
	const sent = new Map<string, number>();
	let snapshot_missing_logged = false;
	const limits: OpsLimits = {
		errors_per_window: env.ops.errors_per_window,
		database_alert_bytes: env.ops.database_alert_bytes,
		storage_alert_bytes: env.ops.storage_alert_bytes,
		gc_min_age_hours: env.gc_min_age_hours,
		bounces_per_day: env.ops.bounces_per_day,
	};
	Bun.cron("*/10 * * * *", async () => {
		try {
			await ops_tick(errors, limits, sent, {
				snapshot: async () => {
					const { data, error } = await db.rpc("ops_snapshot", { p_gc_max_attempts: env.gc_max_attempts });
					if (error?.code === "PGRST202") {
						// a database from before the diff: only the error count works
						if (!snapshot_missing_logged) {
							snapshot_missing_logged = true;
							console.warn("[ops] ops_snapshot is not in the database yet: sizes, GC and mail are not watched");
						}
						return null;
					}
					if (error) throw new Error(`ops_snapshot: ${error.code} ${error.message}`);
					return to_snapshot(data);
				},
				mail: async (alert) => {
					console.error(`[ops-alert] ${alert.subject}`);
					if (!to || !env.plunk_secret_key || !env.plunk_from_email) return;
					const body = alert.lines.map((line) => `<p>${escape_html(line)}</p>`).join("");
					await plunk_send(env, to, alert.subject, body, send);
				},
			});
		} catch (err) {
			console.error("[ops] tick failed:", err);
		}
	});
	console.log("[ops] watching errors, GC, sizes and mail every 10 minutes");
}

// GET /health: for a monitor outside. "ok" means this process answers and
// the database answers it. The answer is remembered for a few seconds, so a
// monitor (or anyone else) asking often costs the database nothing
const HEALTH_TTL_MS = 15_000;

export function create_health(probe: () => Promise<boolean>, now: () => number = Date.now) {
	let checked_at = Number.NEGATIVE_INFINITY;
	let database = false;
	let running: Promise<boolean> | null = null;
	return async (): Promise<Response> => {
		if (now() - checked_at >= HEALTH_TTL_MS) {
			running ??= probe()
				.catch(() => false)
				.then((ok) => {
					database = ok;
					checked_at = now();
					running = null;
					return ok;
				});
			await running;
		}
		return Response.json({ ok: database, database }, { status: database ? 200 : 503 });
	};
}

/** The cheapest question the database can answer: is anybody there */
export function database_probe(db: SupabaseClient | null): () => Promise<boolean> {
	return async () => {
		if (!db) return false;
		const { error } = await db.from("billing_accounts").select("owner_id", { head: true, count: "estimated" }).limit(1);
		return !error;
	};
}
