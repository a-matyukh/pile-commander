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

export async function drain_moderation_mail(
	env: Env,
	db: SupabaseClient,
	send: FetchLike = fetch,
): Promise<number> {
	if (!plunk_ready(env)) return 0;

	const { data, error } = await db
		.from("moderation_mail")
		.select("id, kind, owner_id, reason, username, slug, workspace_name, attempts")
		.is("sent_at", null)
		.order("created_at", { ascending: true })
		.limit(MAIL_BATCH);
	if (error) {
		console.error("[moderation] list mail:", error.message);
		return 0;
	}

	let sent = 0;
	for (const row of (data ?? []) as MailRow[]) {
		const email = await owner_email(db, row.owner_id);
		if (!email) {
			await db
				.from("moderation_mail")
				.update({
					attempts: row.attempts + 1,
					last_error: "owner has no email",
				})
				.eq("id", row.id);
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
			const { error: mark_error } = await db
				.from("moderation_mail")
				.update({ sent_at: new Date().toISOString(), last_error: null })
				.eq("id", row.id);
			if (mark_error) console.error("[moderation] mark sent:", mark_error.message);
			else sent += 1;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error("[moderation] send failed:", message);
			await db
				.from("moderation_mail")
				.update({ last_error: message, attempts: row.attempts + 1 })
				.eq("id", row.id);
		}
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
	mark: (id: string) => Promise<{ error: { message?: string } | null }>;
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
		async mark(id) {
			const { error } = await db
				.from("moderation_mail")
				.update({ moderator_notified_at: new Date().toISOString() })
				.eq("id", id);
			return { error };
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
		try {
			await plunk_send(env, env.moderation_digest_email, copy.subject, copy.body, send);
		} catch (err) {
			console.error("[moderation] moderator notice failed:", err instanceof Error ? err.message : err);
			continue;
		}
		const marked = await store.mark(row.id);
		if (marked.error) console.error("[moderation] mark moderator notice:", marked.error.message);
		else sent += 1;
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
					await drain_moderation_mail(env, db);
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
