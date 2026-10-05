import type { SupabaseClient } from "@supabase/supabase-js";
import type { EgressMode, Env } from "./env";
import { egress_alert_email_copy, plunk_send, type FetchLike } from "./mail";

// Public-link egress fair use. The storage quota counts bytes at rest; this
// counts bytes presigned for NON-members (anon, signed-in strangers, Hub
// visitors) of an owner's public boards, per UTC day and month, and — as far
// as EGRESS_ENFORCE allows — stops signing media above the plan's limits.
// The board itself stays live: notes and layout never pass through here.
// create_download_meter runs the same meter on a second ledger: originals
// taken with Download as .pile, charged to the account that downloads.
//
// Counting happens at sign time (the browser downloads straight from B2), so
// it is approximate: a video Range request is charged as the whole file and a
// 15-minute URL can be fetched again. Increments collect in memory and reach
// Postgres once a minute through egress_sync — a viral board would otherwise
// turn one owner/day row into a per-request hot spot. One Render instance
// serves the API (see ratelimit.ts); with several, each keeps its own pending
// bytes and the overshoot is bounded by instances × one flush of traffic.

export type EgressReason = "public_file_size" | "visitor_share" | "egress_budget";

const REASONS: readonly EgressReason[] = ["public_file_size", "visitor_share", "egress_budget"];

export type EgressInput = {
	/** the account charged: a board's owner, or the downloader on the downloads ledger */
	owner_id: string;
	size_bytes: number;
	/** visitor_key() of the client address */
	visitor: string;
	/** Hub covers are capped at upload, so only /presign gates the original's size */
	gate_file_size: boolean;
};

export type EgressDecision =
	| { allowed: true }
	| { allowed: false; reason: EgressReason; status: 403 | 429; retry_after_s?: number };

/** one row of egress_sync's answer */
export type EgressSyncRow = {
	owner_id: string;
	day_bytes: number;
	month_bytes: number;
	egress_bytes_month: number | null;
	max_public_file_bytes: number | null;
};

export type EgressPendingRow = { owner_id: string; day: string; bytes: number };

export type EgressAlertKind = "alert_day" | "alert_month";

export type EgressAlert = {
	kind: EgressAlertKind;
	owner_id: string;
	/** the UTC day (alert_day) or the first day of the UTC month (alert_month) */
	period: string;
	day_bytes: number;
	month_bytes: number;
	budget_bytes: number;
	mode: EgressMode;
};

export type EgressConfig = {
	mode: EgressMode;
	alert_day_fraction: number;
	/** one visitor's daily share of the budget; null = no share (the charged account is the visitor) */
	visitor_fraction: number | null;
	/** log prefix, "egress" by default */
	label?: string;
};

export type EgressDeps = {
	/** egress_sync: adds rows with bytes > 0, returns state for every owner mentioned */
	sync: (today: string, rows: EgressPendingRow[]) => Promise<EgressSyncRow[]>;
	/** records the notice; false when it already exists (sent before) */
	claim: (owner_id: string, period: string, kind: EgressAlertKind) => Promise<boolean>;
	/** delivers a freshly claimed alert */
	alert: (alert: EgressAlert) => Promise<void>;
	now?: () => number;
};

type OwnerState = {
	/** UTC day the totals belong to; a new day (or month) reloads */
	day: string;
	day_bytes: number;
	month_bytes: number;
	budget: number | null;
	max_public_file_bytes: number | null;
	loaded_at: number;
	alerted_day: string | null;
	alerted_month: string | null;
	/** UTC month ("YYYY-MM") in which a download was refused for the budget */
	budget_refused_month: string | null;
};

type Unflushed = { day: number; month: number };

type ReasonCounts = Record<EgressReason, number>;

// plan changes reach the meter within this long
const STATE_TTL_MS = 5 * 60_000;
// owners with no downloads for this long are dropped from memory
const STATE_IDLE_MS = 60 * 60_000;
// a flood of distinct visitors must not grow the map without bound; past the
// cap new visitors are not tracked (the share fails open)
const MAX_VISITOR_KEYS = 200_000;
const FAILURE_LOG_INTERVAL_MS = 60_000;

export class EgressMeter {
	private readonly states = new Map<string, OwnerState>();
	private readonly loading = new Map<string, Promise<OwnerState | null>>();
	/** bytes not yet flushed, keyed `${owner_id} ${day}` */
	private pending = new Map<string, number>();
	/** bytes per `${visitor} ${owner_id}` for visitors_day */
	private readonly visitors = new Map<string, number>();
	private visitors_day = "";
	private visitors_full_logged = false;
	private flush_chain: Promise<void> = Promise.resolve();
	private last_failure_log = Number.NEGATIVE_INFINITY;
	private refused = zero_counts();
	private would_refuse = zero_counts();
	private readonly now: () => number;

	constructor(
		readonly config: EgressConfig,
		private readonly deps: EgressDeps,
	) {
		this.now = deps.now ?? Date.now;
	}

	/** log prefix: "egress", or the ledger's own */
	get label(): string {
		return this.config.label ?? "egress";
	}

	/**
	 * One non-member download of `size_bytes` from `owner_id`'s board. A
	 * download that is served is charged; a refusal is not. Without a
	 * reachable database the download is served (fail open) and charged to
	 * pending, so the bytes still land once Postgres is back
	 */
	async admit(input: EgressInput): Promise<EgressDecision> {
		const state = await this.state_of(input.owner_id, utc_day(this.now()));
		// check and charge in one synchronous step: concurrent admits cannot
		// both pass on the same remaining budget
		return this.decide(input, state, utc_day(this.now()));
	}

	/**
	 * Pushes pending bytes to Postgres, refreshes those owners, raises alerts.
	 * Everything pending when this is called gets flushed: a call during a
	 * running flush queues another one after it (the shutdown flush relies
	 * on that while the cron one may be running)
	 */
	flush(): Promise<void> {
		const run = this.flush_chain.then(() => this.flush_once());
		this.flush_chain = run.catch(() => {});
		return run;
	}

	private decide(input: EgressInput, state: OwnerState | null, today: string): EgressDecision {
		const size = Math.max(0, input.size_bytes);
		if (input.gate_file_size && state?.max_public_file_bytes != null && size > state.max_public_file_bytes) {
			const refusal = this.check("public_file_size", 403);
			if (refusal) return refusal;
		}

		this.roll_visitors(today);
		const visitor = `${input.visitor} ${input.owner_id}`;
		const visitor_bytes = this.visitors.get(visitor) ?? 0;
		if (state && state.budget !== null) {
			// the budget first: when it is spent that is the true answer, and
			// unlike the share it does not come back at midnight
			if (state.month_bytes + size > state.budget) {
				const refusal = this.check("egress_budget", 403);
				if (refusal) {
					this.note_budget_refusal(input.owner_id, state, today);
					return refusal;
				}
			}
			// no share on a ledger where the charged account is the visitor itself
			const fraction = this.config.visitor_fraction;
			if (fraction !== null) {
				const share = Math.max(1, Math.floor(state.budget * fraction));
				if (visitor_bytes + size > share) {
					const refusal = this.check("visitor_share", 429, seconds_until_utc_midnight(this.now()));
					if (refusal) return refusal;
				}
			}
		}

		this.charge(input.owner_id, today, size, state);
		if (this.config.visitor_fraction !== null) this.track_visitor(visitor, visitor_bytes + size);
		return { allowed: true };
	}

	// A refusal when the mode enforces this reason; otherwise the download
	// goes through and the reason is only counted (calibration data)
	private check(reason: EgressReason, status: 403 | 429, retry_after_s?: number): EgressDecision | null {
		if (enforces(this.config.mode, reason)) {
			this.refused[reason] += 1;
			return retry_after_s
				? { allowed: false, reason, status, retry_after_s }
				: { allowed: false, reason, status };
		}
		this.would_refuse[reason] += 1;
		return null;
	}

	// A refusal is not charged, so the flushed total can stay just under the
	// budget while visitors already get placeholders. Remember the refusal
	// for alert_month and make sure the next flush reports this owner (a
	// zero-byte row only reads state)
	private note_budget_refusal(owner_id: string, state: OwnerState, today: string): void {
		const month = today.slice(0, 7);
		if (state.budget_refused_month === month) return;
		state.budget_refused_month = month;
		const key = `${owner_id} ${today}`;
		if (!this.pending.has(key)) this.pending.set(key, 0);
	}

	private charge(owner_id: string, day: string, size: number, state: OwnerState | null): void {
		if (size === 0) return;
		const key = `${owner_id} ${day}`;
		this.pending.set(key, (this.pending.get(key) ?? 0) + size);
		if (state) {
			state.day_bytes += size;
			state.month_bytes += size;
		}
	}

	private roll_visitors(today: string): void {
		if (this.visitors_day === today) return;
		this.visitors_day = today;
		this.visitors.clear();
		this.visitors_full_logged = false;
	}

	private track_visitor(key: string, bytes: number): void {
		if (!this.visitors.has(key) && this.visitors.size >= MAX_VISITOR_KEYS) {
			if (!this.visitors_full_logged) {
				this.visitors_full_logged = true;
				console.warn(`[egress] visitor map is full (${MAX_VISITOR_KEYS}); new visitors are not tracked until UTC midnight`);
			}
			return;
		}
		this.visitors.set(key, bytes);
	}

	private state_of(owner_id: string, today: string): Promise<OwnerState | null> {
		const current = this.states.get(owner_id);
		if (current && current.day === today && this.now() - current.loaded_at < STATE_TTL_MS) {
			return Promise.resolve(current);
		}
		let loading = this.loading.get(owner_id);
		if (!loading) {
			loading = this.load(owner_id, today).finally(() => this.loading.delete(owner_id));
			this.loading.set(owner_id, loading);
		}
		return loading;
	}

	private async load(owner_id: string, today: string): Promise<OwnerState | null> {
		try {
			const rows = await this.deps.sync(today, [{ owner_id, day: today, bytes: 0 }]);
			const row = rows.find((r) => r.owner_id === owner_id);
			// no row: the account is gone; its pending bytes are skipped by egress_sync
			if (!row) return null;
			// Only pending bytes are added — they cannot be in Postgres yet. A
			// batch in flight may or may not be in these totals: leaving it out
			// undercounts until that flush lands (it then corrects the state),
			// while adding it could count it twice and refuse visitors for nothing
			return this.apply(row, today, this.unflushed(owner_id, today));
		} catch (err) {
			this.log_failure("state load", err);
			return this.states.get(owner_id) ?? null;
		}
	}

	private apply(row: EgressSyncRow, today: string, extra: Unflushed): OwnerState {
		let state = this.states.get(row.owner_id);
		if (!state) {
			state = {
				day: today,
				day_bytes: 0,
				month_bytes: 0,
				budget: null,
				max_public_file_bytes: null,
				loaded_at: 0,
				alerted_day: null,
				alerted_month: null,
				budget_refused_month: null,
			};
			this.states.set(row.owner_id, state);
		}
		state.day = today;
		state.day_bytes = row.day_bytes + extra.day;
		state.month_bytes = row.month_bytes + extra.month;
		state.budget = row.egress_bytes_month;
		state.max_public_file_bytes = row.max_public_file_bytes;
		state.loaded_at = this.now();
		return state;
	}

	/** bytes charged to the owner that no flush has sent yet */
	private unflushed(owner_id: string, today: string): Unflushed {
		const totals = { day: 0, month: 0 };
		for (const [key, bytes] of this.pending) {
			const [owner, day] = split_key(key);
			if (owner !== owner_id) continue;
			if (day === today) totals.day += bytes;
			if (day.slice(0, 7) === today.slice(0, 7)) totals.month += bytes;
		}
		return totals;
	}

	private async flush_once(): Promise<void> {
		const today = utc_day(this.now());
		const batch = this.pending;
		this.pending = new Map();
		const rows: EgressPendingRow[] = [...batch].map(([key, bytes]) => {
			const [owner_id, day] = split_key(key);
			return { owner_id, day, bytes };
		});
		if (rows.length > 0) {
			let result: EgressSyncRow[];
			try {
				result = await this.deps.sync(today, rows);
			} catch (err) {
				for (const [key, bytes] of batch) {
					this.pending.set(key, (this.pending.get(key) ?? 0) + bytes);
				}
				this.log_failure("flush", err);
				return;
			}
			// downloads admitted while the RPC ran are not in its totals
			for (const row of result) {
				this.apply(row, today, this.unflushed(row.owner_id, today));
			}
			await this.raise_alerts(result, today);
		}
		this.log_summary(rows);
		this.evict_idle();
	}

	private async raise_alerts(rows: EgressSyncRow[], today: string): Promise<void> {
		const month = today.slice(0, 7);
		for (const row of rows) {
			const budget = row.egress_bytes_month;
			const state = this.states.get(row.owner_id);
			if (budget === null || !state) continue;
			if (state.alerted_day !== today && row.day_bytes >= budget * this.config.alert_day_fraction) {
				if (await this.raise("alert_day", today, row, budget)) state.alerted_day = today;
			}
			// in `all` a refused download is not charged, so the refusal itself
			// counts as reaching the budget
			const budget_reached = row.month_bytes >= budget || state.budget_refused_month === month;
			if (state.alerted_month !== month && budget_reached) {
				if (await this.raise("alert_month", `${month}-01`, row, budget)) state.alerted_month = month;
			}
		}
	}

	// true once the notice is settled (sent now or before); false retries on
	// the next flush
	private async raise(
		kind: EgressAlertKind,
		period: string,
		row: EgressSyncRow,
		budget: number,
	): Promise<boolean> {
		let claimed: boolean;
		try {
			claimed = await this.deps.claim(row.owner_id, period, kind);
		} catch (err) {
			console.error(`[egress] ${kind} claim failed for ${row.owner_id}:`, err instanceof Error ? err.message : err);
			return false;
		}
		if (!claimed) return true;
		try {
			await this.deps.alert({
				kind,
				owner_id: row.owner_id,
				period,
				day_bytes: row.day_bytes,
				month_bytes: row.month_bytes,
				budget_bytes: budget,
				mode: this.config.mode,
			});
		} catch (err) {
			console.error(`[egress] ${kind} delivery failed for ${row.owner_id}:`, err instanceof Error ? err.message : err);
		}
		return true;
	}

	private log_summary(rows: EgressPendingRow[]): void {
		const refused = this.refused;
		const would_refuse = this.would_refuse;
		this.refused = zero_counts();
		this.would_refuse = zero_counts();
		const refusals = REASONS.some((reason) => refused[reason] > 0 || would_refuse[reason] > 0);
		// zero-byte rows only asked for state (a budget refusal)
		const served = rows.filter((row) => row.bytes > 0);
		if (served.length === 0 && !refusals) return;

		const by_owner = new Map<string, number>();
		for (const row of served) by_owner.set(row.owner_id, (by_owner.get(row.owner_id) ?? 0) + row.bytes);
		let total = 0;
		for (const bytes of by_owner.values()) total += bytes;
		const top = [...by_owner]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3)
			.map(([owner, bytes]) => `${owner}=${format_bytes(bytes)}`)
			.join(" ");
		console.log(
			`[${this.label}] mode=${this.config.mode} served ${format_bytes(total)} for ${by_owner.size} account(s)` +
				(top ? ` top ${top}` : "") +
				` | refused ${format_counts(refused)} | would refuse ${format_counts(would_refuse)}`,
		);
	}

	private evict_idle(): void {
		const floor = this.now() - STATE_IDLE_MS;
		for (const [owner, state] of this.states) {
			if (state.loaded_at < floor) this.states.delete(owner);
		}
	}

	private log_failure(what: string, err: unknown): void {
		const now = this.now();
		if (now - this.last_failure_log < FAILURE_LOG_INTERVAL_MS) return;
		this.last_failure_log = now;
		console.error(
			`[${this.label}] ${what} failed — downloads stay open, bytes stay pending:`,
			err instanceof Error ? err.message : err,
		);
	}
}

export function enforces(mode: EgressMode, reason: EgressReason): boolean {
	return mode === "all" || (mode === "file_size" && reason === "public_file_size");
}

export function utc_day(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

function seconds_until_utc_midnight(ms: number): number {
	const next = new Date(ms);
	next.setUTCHours(24, 0, 0, 0);
	return Math.max(1, Math.ceil((next.getTime() - ms) / 1000));
}

function split_key(key: string): [string, string] {
	const space = key.indexOf(" ");
	return [key.slice(0, space), key.slice(space + 1)];
}

function zero_counts(): ReasonCounts {
	return { public_file_size: 0, visitor_share: 0, egress_budget: 0 };
}

function format_counts(counts: ReasonCounts): string {
	return `size=${counts.public_file_size} share=${counts.visitor_share} budget=${counts.egress_budget}`;
}

export function format_bytes(bytes: number): string {
	const gib = bytes / 1024 ** 3;
	if (gib >= 1) return `${gib.toFixed(2)} GiB`;
	return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

function nullable_number(value: unknown): number | null {
	return value === null || value === undefined ? null : Number(value);
}

function to_sync_row(raw: Record<string, unknown>): EgressSyncRow {
	return {
		owner_id: String(raw.owner_id),
		day_bytes: Number(raw.day_bytes ?? 0),
		month_bytes: Number(raw.month_bytes ?? 0),
		egress_bytes_month: nullable_number(raw.egress_bytes_month),
		max_public_file_bytes: nullable_number(raw.max_public_file_bytes),
	};
}

// download_sync speaks of the downloader and their download_bytes_month; the
// meter reads them as the charged account and its budget, with no size cap
function to_download_sync_row(raw: Record<string, unknown>): EgressSyncRow {
	return {
		owner_id: String(raw.user_id),
		day_bytes: Number(raw.day_bytes ?? 0),
		month_bytes: Number(raw.month_bytes ?? 0),
		egress_bytes_month: nullable_number(raw.download_bytes_month),
		max_public_file_bytes: null,
	};
}

async function deliver_alert(env: Env, alert: EgressAlert, send: FetchLike): Promise<void> {
	console.error(
		`[egress-alert] ${alert.kind} owner=${alert.owner_id} period=${alert.period}` +
			` today=${format_bytes(alert.day_bytes)} month=${format_bytes(alert.month_bytes)}` +
			` budget=${format_bytes(alert.budget_bytes)} mode=${alert.mode}`,
	);
	const to = env.egress.alert_email;
	if (!to || !env.plunk_secret_key || !env.plunk_from_email) return;
	const copy = egress_alert_email_copy(alert);
	await plunk_send(env, to, copy.subject, copy.body, send);
}

export function create_egress_meter(env: Env, db: SupabaseClient, send: FetchLike = fetch): EgressMeter {
	return new EgressMeter(
		{
			mode: env.egress.mode,
			alert_day_fraction: env.egress.alert_day_fraction,
			visitor_fraction: env.egress.visitor_fraction,
		},
		{
			sync: async (today, rows) => {
				const { data, error } = await db.rpc("egress_sync", { p_today: today, p_rows: rows });
				if (error) throw new Error(`egress_sync: ${error.code} ${error.message}`);
				return ((data ?? []) as Record<string, unknown>[]).map(to_sync_row);
			},
			claim: async (owner_id, period, kind) => {
				const { error } = await db.from("egress_notices").insert({ owner_id, period, kind });
				if (!error) return true;
				if (error.code === "23505") return false;
				throw new Error(`egress_notices: ${error.code} ${error.message}`);
			},
			alert: (alert) => deliver_alert(env, alert, send),
		},
	);
}

/**
 * The Download as .pile ledger (download_daily): the same meter, charged to
 * the account that downloads instead of the board's owner, against its
 * download_bytes_month. Signed-in only, so there is no per-visitor share, and
 * no size cap: the downloader spends their own allowance. No owner mail
 * either; the log summary is the ops view for now
 */
export function create_download_meter(env: Env, db: SupabaseClient): EgressMeter {
	return new EgressMeter(
		{
			mode: env.egress.mode,
			alert_day_fraction: env.egress.alert_day_fraction,
			visitor_fraction: null,
			label: "downloads",
		},
		{
			sync: async (today, rows) => {
				const p_rows = rows.map((row) => ({ user_id: row.owner_id, day: row.day, bytes: row.bytes }));
				const { data, error } = await db.rpc("download_sync", { p_today: today, p_rows });
				if (error) throw new Error(`download_sync: ${error.code} ${error.message}`);
				return ((data ?? []) as Record<string, unknown>[]).map(to_download_sync_row);
			},
			// nothing to claim or mail: a downloader's allowance is their own
			claim: async () => false,
			alert: async () => {},
		},
	);
}

export function start_egress_worker(...meters: EgressMeter[]): void {
	// Bun.cron never overlaps runs; errors stay inside (see index.ts). The
	// last flush on SIGTERM belongs to index.ts, after the HTTP drain
	Bun.cron("* * * * *", async () => {
		for (const meter of meters) {
			try {
				await meter.flush();
			} catch (err) {
				console.error(`[${meter.label}] flush failed:`, err);
			}
		}
	});
	for (const meter of meters) {
		console.log(`[${meter.label}] meter on: mode ${meter.config.mode}, flush every minute`);
	}
}
