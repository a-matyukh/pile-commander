import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env";
import {
	hub_hidden_email_copy,
	hub_hidden_moderator_email_copy,
	hub_made_private_email_copy,
	moderation_digest_email_copy,
	plunk_send,
	type FetchLike,
	type HubDigestPayload,
} from "./mail";

type MailRow = {
	id: string;
	kind: "listing_hidden" | "listing_made_private";
	owner_id: string;
	reason: string | null;
	username: string | null;
	slug: string | null;
	workspace_name: string | null;
	attempts: number;
};

const MAIL_BATCH = 20;

function board_url(env: Env, username: string | null, slug: string | null): string | null {
	if (!env.public_app_url || !username || !slug) return null;
	return `${env.public_app_url}/${username}/${slug}`;
}

function plunk_ready(env: Env): boolean {
	return Boolean(env.plunk_secret_key && env.plunk_from_email);
}

export function parse_digest_payload(raw: unknown): HubDigestPayload {
	const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	return {
		since: typeof obj.since === "string" ? obj.since : String(obj.since ?? ""),
		listings: Array.isArray(obj.listings) ? (obj.listings as HubDigestPayload["listings"]) : [],
		hidden: Array.isArray(obj.hidden) ? (obj.hidden as HubDigestPayload["hidden"]) : [],
	};
}

async function owner_email(db: SupabaseClient, owner_id: string): Promise<string | null> {
	const { data, error } = await db.auth.admin.getUserById(owner_id);
	if (error) {
		console.error("[moderation] getUserById:", error.message);
		return null;
	}
	return data.user?.email ?? null;
}

/**
 * The owner's mail queue (`moderation_mail`). Two copies of the backend run
 * side by side for a minute or two on every deploy, and each has its own
 * cron tick: a row read by both was sent by both. So a copy takes a row
 * before it sends (`claim`), and the copy that comes second gets nothing.
 */
export type OwnerMailQueue = {
	pending: (limit: number) => Promise<MailRow[]>;
	/**
	 * Counts one more attempt on the row, only if nobody has counted one
	 * since it was read and it is still unsent. False: another copy has it
	 */
	claim: (row: MailRow) => Promise<boolean>;
	email: (owner_id: string) => Promise<string | null>;
	sent: (id: string) => Promise<void>;
	failed: (id: string, message: string) => Promise<void>;
};

export function default_owner_mail(db: SupabaseClient): OwnerMailQueue {
	return {
		async pending(limit) {
			const { data, error } = await db
				.from("moderation_mail")
				.select("id, kind, owner_id, reason, username, slug, workspace_name, attempts")
				.is("sent_at", null)
				.order("created_at", { ascending: true })
				.limit(limit);
			if (error) throw new Error(error.message);
			return (data ?? []) as MailRow[];
		},
		async claim(row) {
			const { data, error } = await db
				.from("moderation_mail")
				.update({ attempts: row.attempts + 1 })
				.eq("id", row.id)
				.eq("attempts", row.attempts)
				.is("sent_at", null)
				.select("id");
			if (error) {
				console.error("[moderation] claim mail:", error.message);
				return false;
			}
			return (data ?? []).length === 1;
		},
		email: (owner_id) => owner_email(db, owner_id),
		async sent(id) {
			const { error } = await db
				.from("moderation_mail")
				.update({ sent_at: new Date().toISOString(), last_error: null })
				.eq("id", id);
			if (error) console.error("[moderation] mark sent:", error.message);
		},
		async failed(id, message) {
			const { error } = await db.from("moderation_mail").update({ last_error: message }).eq("id", id);
			if (error) console.error("[moderation] mark failed:", error.message);
		},
	};
}

/**
 * Sends what is queued for board owners. A row that fails stays unsent with
 * its error and is tried again on the next tick; `attempts` counts the tries.
 * Returns how many mails went
 */
export async function drain_moderation_mail(
	env: Env,
	queue: OwnerMailQueue,
	send: FetchLike = fetch,
): Promise<number> {
	if (!plunk_ready(env)) return 0;

	let rows: MailRow[];
	try {
		rows = await queue.pending(MAIL_BATCH);
	} catch (err) {
		console.error("[moderation] list mail:", err instanceof Error ? err.message : err);
		return 0;
	}

	let sent = 0;
	for (const row of rows) {
		if (!(await queue.claim(row))) continue;
		const email = await queue.email(row.owner_id);
		if (!email) {
			await queue.failed(row.id, "owner has no email");
			continue;
		}
		const board = {
			name: row.workspace_name || "Your board",
			username: row.username,
			slug: row.slug,
			url: board_url(env, row.username, row.slug),
			abuse_email: env.abuse_email,
		};
		const copy =
			row.kind === "listing_made_private"
				? hub_made_private_email_copy(board, row.reason || "unpublished by a moderator")
				: hub_hidden_email_copy(board);
		try {
			await plunk_send(env, email, copy.subject, copy.body, send);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error("[moderation] send failed:", message);
			await queue.failed(row.id, message);
			continue;
		}
		await queue.sent(row.id);
		sent += 1;
	}
	return sent;
}

type HiddenRow = {
	id: string;
	workspace_id: string;
	username: string | null;
	slug: string | null;
	workspace_name: string | null;
};

export type HiddenNotices = {
	/**
	 * Cards hidden by reports that the moderator has not been told about;
	 * null from a database without moderation_mail.moderator_notified_at
	 */
	pending: (limit: number) => Promise<HiddenRow[] | null>;
	/** how many reports each hidden card has, and what they say */
	reports: () => Promise<HubDigestPayload["hidden"]>;
	/**
	 * Marks the card as told, only if it is not marked yet. False: another
	 * copy of the backend is telling the moderator (see OwnerMailQueue)
	 */
	claim: (id: string) => Promise<boolean>;
	/** The notice did not go: unmark the card, the next tick tries again */
	release: (id: string) => Promise<void>;
};

function default_hidden_notices(db: SupabaseClient): HiddenNotices {
	return {
		async pending(limit) {
			const { data, error } = await db
				.from("moderation_mail")
				.select("id, workspace_id, username, slug, workspace_name")
				.eq("kind", "listing_hidden")
				.eq("reason", "reports")
				.is("moderator_notified_at", null)
				.order("created_at", { ascending: true })
				.limit(limit);
			if (error) {
				// 42703: the column comes with the П2 diff
				if ((error as { code?: string }).code === "42703") return null;
				throw new Error(error.message);
			}
			return (data ?? []) as HiddenRow[];
		},
		async reports() {
			const { data, error } = await db.rpc("moderation_digest_payload");
			if (error) throw new Error(error.message);
			return parse_digest_payload(data).hidden;
		},
		async claim(id) {
			const { data, error } = await db
				.from("moderation_mail")
				.update({ moderator_notified_at: new Date().toISOString() })
				.eq("id", id)
				.is("moderator_notified_at", null)
				.select("id");
			if (error) {
				console.error("[moderation] claim moderator notice:", error.message);
				return false;
			}
			return (data ?? []).length === 1;
		},
		async release(id) {
			const { error } = await db.from("moderation_mail").update({ moderator_notified_at: null }).eq("id", id);
			if (error) console.error("[moderation] release moderator notice:", error.message);
		},
	};
}

/**
 * Writes to the moderator about each card that reports have just hidden.
 * The owner's mail (drain_moderation_mail) is separate: either can fail and
 * be tried again without the other being sent twice. Returns how many
 * notices went
 */
export async function notify_moderator_of_hidden(
	env: Env,
	store: HiddenNotices,
	send: FetchLike = fetch,
): Promise<number> {
	if (!plunk_ready(env) || !env.moderation_digest_email) return 0;
	const rows = await store.pending(MAIL_BATCH);
	if (!rows || rows.length === 0) return 0;
	let reports: HubDigestPayload["hidden"] = [];
	try {
		reports = await store.reports();
	} catch (err) {
		// the notice is worth sending without the reasons
		console.error("[moderation] hidden reports:", err instanceof Error ? err.message : err);
	}
	let sent = 0;
	for (const row of rows) {
		const found = reports.find((item) => item.workspace_id === row.workspace_id);
		const copy = hub_hidden_moderator_email_copy({
			workspace_id: row.workspace_id,
			name: row.workspace_name || "A board",
			url: board_url(env, row.username, row.slug),
			report_count: found ? found.report_count : null,
			reasons: found ? found.reasons : [],
		});
		if (!(await store.claim(row.id))) continue;
		try {
			await plunk_send(env, env.moderation_digest_email, copy.subject, copy.body, send);
		} catch (err) {
			console.error("[moderation] moderator notice failed:", err instanceof Error ? err.message : err);
			await store.release(row.id);
			continue;
		}
		sent += 1;
	}
	return sent;
}

export async function send_moderation_digest(
	env: Env,
	db: SupabaseClient,
	send: FetchLike = fetch,
): Promise<boolean> {
	if (!plunk_ready(env) || !env.moderation_digest_email) return false;

	const { data, error } = await db.rpc("moderation_digest_payload");
	if (error) {
		console.error("[moderation] digest payload:", error.message);
		return false;
	}
	const payload = parse_digest_payload(data);
	const copy = moderation_digest_email_copy(payload, env.public_app_url);
	try {
		await plunk_send(env, env.moderation_digest_email, copy.subject, copy.body, send);
	} catch (err) {
		console.error("[moderation] digest send:", err instanceof Error ? err.message : err);
		return false;
	}
	const { error: mark_error } = await db.rpc("mark_moderation_digest_sent");
	if (mark_error) {
		console.error("[moderation] digest cursor:", mark_error.message);
		return false;
	}
	return true;
}

export function start_moderation_worker(
	env: Env,
	db: SupabaseClient,
): { stop(): Promise<void> } {
	const running = new Set<Promise<unknown>>();
	let stopped = false;
	const wrap = (job: () => Promise<unknown>) => async () => {
		if (stopped) return;
		const run = job();
		running.add(run);
		try {
			await run;
		} finally {
			running.delete(run);
		}
	};

	if (plunk_ready(env)) {
		Bun.cron(
			env.moderation_mail_cron,
			wrap(async () => {
				try {
					await drain_moderation_mail(env, default_owner_mail(db));
				} catch (err) {
					console.error("[moderation] mail tick failed:", err);
				}
				try {
					await notify_moderator_of_hidden(env, default_hidden_notices(db));
				} catch (err) {
					console.error("[moderation] moderator notice tick failed:", err);
				}
			}),
		);
		console.log(`[moderation] owner mail queued on "${env.moderation_mail_cron}"`);
	} else {
		console.warn("[moderation] Plunk is not configured — owner mail and digest stay queued");
	}

	if (plunk_ready(env) && env.moderation_digest_email) {
		Bun.cron(
			env.moderation_digest_cron,
			wrap(async () => {
				try {
					await send_moderation_digest(env, db);
				} catch (err) {
					console.error("[moderation] digest tick failed:", err);
				}
			}),
		);
		console.log(
			`[moderation] weekly digest to ${env.moderation_digest_email} on "${env.moderation_digest_cron}"`,
		);
	}

	return {
		stop: async () => {
			stopped = true;
			await Promise.allSettled([...running]);
		},
	};
}
