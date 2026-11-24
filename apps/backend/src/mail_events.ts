import type { SupabaseClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { ApiError } from "./auth";
import type { Env } from "./env";
import { plunk_send, type FetchLike } from "./mail";

export type MailEventKind = "bounce" | "complaint";

/**
 * Which event a Plunk webhook carries. The default payload has no event
 * name, so it is read from the fields: a complaint has `complainedAt` /
 * `complaintFeedbackType`, a bounce a `bounceType`. Only a permanent bounce
 * counts (a transient one is a full inbox), and a send the provider
 * suppressed (`suppressedByProvider`) reached no inbox at all
 */
export function mail_event_kind(event: Record<string, unknown>): MailEventKind | null {
	if (event.suppressedByProvider === true) return null;
	if ("complainedAt" in event || "complaintFeedbackType" in event) return "complaint";
	if (event.bounceType === "Permanent") return "bounce";
	return null;
}

function secret_matches(header: string | null, secret: string): boolean {
	const expected = Buffer.from(`Bearer ${secret}`);
	const given = Buffer.from(header ?? "");
	return given.length === expected.length && timingSafeEqual(given, expected);
}

export type RecordMailEvent = (
	mail_id: string | null,
	kind: MailEventKind,
	email: string | null,
) => Promise<{ actor: string | null; suspended: boolean }>;

function default_record(db: SupabaseClient | null): RecordMailEvent {
	return async (mail_id, kind, email) => {
		if (!db) throw new ApiError(503, "service role is not configured on the backend");
		const { data, error } = await db.rpc("record_mail_event", {
			p_mail_id: mail_id,
			p_kind: kind,
			p_email: email,
		});
		if (error) throw new ApiError(500, `record mail event failed: ${error.message}`);
		const row = (Array.isArray(data) ? data[0] : data) as { actor?: unknown; suspended?: unknown } | null;
		return {
			actor: typeof row?.actor === "string" ? row.actor : null,
			suspended: row?.suspended === true,
		};
	};
}

// POST /mail/plunk-events — a Plunk workflow (trigger email.bounce or
// email.complaint → Webhook step) forwards the event here with
// `Authorization: Bearer <PLUNK_WEBHOOK_SECRET>`. An invite mail is traced
// to the account that sent it by Plunk's email id (recorded at send time,
// rate_events.mail_id); record_mail_event stores the event, and once the
// account crosses the line (a complaint, or 3 permanent bounces a day) its
// invites stop (add_workspace_member). Plunk does not retry, so the answer
// is 200 unless the request is not Plunk's
export async function handle_plunk_events(
	env: Env,
	req: Request,
	db: SupabaseClient | null,
	record: RecordMailEvent = default_record(db),
	send: FetchLike = fetch,
): Promise<Response> {
	if (!env.plunk_webhook_secret) throw new ApiError(503, "mail events are not configured");
	if (!secret_matches(req.headers.get("authorization"), env.plunk_webhook_secret)) {
		throw new ApiError(401, "invalid webhook secret");
	}
	let body: { event?: unknown; contact?: { email?: unknown } };
	try {
		body = (await req.json()) as typeof body;
	} catch {
		throw new ApiError(400, "expected a JSON body");
	}
	const event = body.event && typeof body.event === "object" && !Array.isArray(body.event)
		? (body.event as Record<string, unknown>)
		: {};
	const kind = mail_event_kind(event);
	if (!kind) return Response.json({ ok: true, ignored: true });
	const mail_id = typeof event.emailId === "string" ? event.emailId : null;
	const email = typeof body.contact?.email === "string" ? body.contact.email.toLowerCase() : null;
	const { actor, suspended } = await record(mail_id, kind, email);
	console.warn(`[mail] ${kind}${actor ? ` on an invite from ${actor}` : ""}${suspended ? " — invites suspended" : ""}`);
	if (suspended && actor && env.moderation_digest_email && env.plunk_secret_key && env.plunk_from_email) {
		try {
			await plunk_send(
				env,
				env.moderation_digest_email,
				"Invites suspended for an account",
				`<p>Account <code>${actor}</code> got a ${kind} on an invite mail and can no longer send invites.</p>`
					+ "<p>Its rows are in <code>private.mail_events</code>; deleting them lifts the stop.</p>",
				send,
			);
		} catch (err) {
			console.error("mail events notice:", err);
		}
	}
	return Response.json({ ok: true });
}
