import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env";
import {
	hub_hidden_email_copy,
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
