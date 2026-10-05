import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "./auth";
import type { EgressAlert } from "./egress";
import type { Env } from "./env";

// Cloud Plunk; the legacy api.useplunk.com host rejects new-account keys
export const PLUNK_SEND_URL = "https://next-api.useplunk.com/v1/send";
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

type EmailData = {
	token: string;
	token_hash: string;
	redirect_to: string;
	email_action_type: string;
	token_new: string;
	token_hash_new: string;
};

type HookUser = {
	email: string;
	new_email: string;
};

// Supabase stores the hook secret as `v1,whsec_<base64>`; the library and
// the dashboard also accept the bare `whsec_…` form
export function hook_secret_bytes(raw: string): Buffer {
	let value = raw.trim();
	if (value.startsWith("v1,")) value = value.slice(3);
	if (value.startsWith("whsec_")) value = value.slice(6);
	const key = Buffer.from(value, "base64");
	if (key.length === 0) throw new ApiError(503, "send-email hook is not configured");
	return key;
}

export function verify_standard_webhook(
	payload: string,
	headers: { id: string; timestamp: string; signature: string },
	secret: Buffer,
	now_seconds = Math.floor(Date.now() / 1000),
): void {
	if (!headers.id || !headers.timestamp || !headers.signature) {
		throw new ApiError(401, "invalid webhook signature");
	}
	const timestamp = Number(headers.timestamp);
	if (!Number.isFinite(timestamp) || Math.abs(now_seconds - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
		throw new ApiError(401, "invalid webhook signature");
	}

	const expected = createHmac("sha256", secret)
		.update(`${headers.id}.${headers.timestamp}.${payload}`)
		.digest();

	for (const part of headers.signature.trim().split(/\s+/)) {
		const comma = part.indexOf(",");
		if (comma === -1) continue;
		if (part.slice(0, comma) !== "v1") continue;
		let provided: Buffer;
		try {
			provided = Buffer.from(part.slice(comma + 1), "base64");
		} catch {
			continue;
		}
		if (provided.length === expected.length && timingSafeEqual(provided, expected)) return;
	}
	throw new ApiError(401, "invalid webhook signature");
}

export function confirmation_url(
	supabase_url: string,
	token_hash: string,
	type: string,
	redirect_to: string,
): string {
	const params = new URLSearchParams({
		token: token_hash,
		type,
		redirect_to,
	});
	return `${supabase_url.replace(/\/$/, "")}/auth/v1/verify?${params.toString()}`;
}

/**
 * User text on its way into a mail SUBJECT. Subjects are not HTML, so
 * escape_html does not apply, but they are a header: a newline in a board
 * name or a display name is a header boundary, and nothing in the schema
 * stops one (workspaces.name and profiles.display_name are length-capped
 * only, unlike entries.name). Strip the control characters, collapse the
 * whitespace and clamp the length so one field cannot dominate the line
 */
export function subject_text(value: string, max_length = 120): string {
	const flat = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
	return flat.length > max_length ? `${flat.slice(0, max_length - 1)}\u2026` : flat;
}

function escape_html(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function link_body(lead: string, href: string, label: string): string {
	return `<p>${lead}</p><p><a href="${escape_html(href)}">${label}</a></p>`;
}

export function auth_email_copy(
	action: string,
	opts: { url: string; token: string; extra?: string },
): { subject: string; body: string } {
	const { url, token, extra } = opts;
	switch (action) {
		case "signup":
		case "email":
			return {
				subject: "Confirm your email address",
				body: link_body("Follow the link to confirm this address and finish signing up.", url, "Confirm email address"),
			};
		case "invite":
			return {
				subject: "You've been invited",
				body: link_body("You've been invited to create an account. Follow the link to accept.", url, "Accept invitation"),
			};
		case "magiclink":
			return {
				subject: "Your sign-in link",
				body: link_body("Follow the link to sign in. It expires shortly and can only be used once.", url, "Sign in"),
			};
		case "recovery":
			return {
				subject: "Reset your password",
				body: link_body(
					"We received a request to reset your password. Follow the link to choose a new one.",
					url,
					"Reset password",
				),
			};
		case "email_change":
			return {
				subject: extra === "current" ? "Confirm an email change" : "Confirm your new email address",
				body: link_body("Follow the link to confirm this email change.", url, "Confirm email address"),
			};
		case "reauthentication":
			return {
				subject: `${token} is your verification code`,
				body: `<p>Use this code to verify your identity. It expires shortly.</p><p>${escape_html(token)}</p>`,
			};
		case "password_changed_notification":
			return {
				subject: "Your password was changed",
				body: "<p>The password for your account was recently changed. If you didn't do this, reset your password.</p>",
			};
		case "email_changed_notification":
			return {
				subject: "Your email address was changed",
				body: "<p>The email address for your account was changed. If you didn't do this, contact support.</p>",
			};
		case "phone_changed_notification":
			return {
				subject: "Your phone number was changed",
				body: "<p>The phone number for your account was changed. If you didn't do this, contact support.</p>",
			};
		case "identity_linked_notification":
			return {
				subject: "A sign-in method was linked",
				body: "<p>A new sign-in method was linked to your account. If you didn't do this, contact support.</p>",
			};
		case "identity_unlinked_notification":
			return {
				subject: "A sign-in method was removed",
				body: "<p>A sign-in method was removed from your account. If you didn't do this, contact support.</p>",
			};
		case "mfa_factor_enrolled_notification":
			return {
				subject: "A verification method was added",
				body: "<p>A sign-in verification method was added to your account. If you didn't do this, contact support.</p>",
			};
		case "mfa_factor_unenrolled_notification":
			return {
				subject: "A verification method was removed",
				body: "<p>A sign-in verification method was removed from your account. If you didn't do this, contact support.</p>",
			};
		default:
			return url
				? {
						subject: "Confirm this action",
						body: link_body("Follow the link to continue.", url, "Continue"),
					}
				: {
						subject: "Account notification",
						body: "<p>There was an update to your account.</p>",
					};
	}
}

export function workspace_invite_url(app_url: string, token: string): string {
	return `${app_url.replace(/\/$/, "")}/invite/${token}`;
}

export function workspace_invite_email_copy(opts: {
	inviter: string;
	workspace_name: string;
	role: "editor" | "viewer";
	url: string;
}): { subject: string; body: string } {
	const inviter = subject_text(opts.inviter) || "Someone";
	const board = subject_text(opts.workspace_name) || "a workspace";
	const role = opts.role === "viewer" ? "a viewer" : "an editor";
	return {
		subject: `${inviter} invited you to ${board}`,
		body: link_body(
			`${escape_html(inviter)} invited you to ${escape_html(board)} as ${role}. Create an account to open it.`,
			opts.url,
			"Open the workspace",
		),
	};
}

function format_gib(bytes: number): string {
	return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

// Ops alert from the egress meter (egress.ts). Goes to EGRESS_ALERT_EMAIL,
// never to the board's owner
export function egress_alert_email_copy(alert: EgressAlert): { subject: string; body: string } {
	const what =
		alert.kind === "alert_day"
			? `served ${format_gib(alert.day_bytes)} to public-link visitors on ${alert.period}`
			: `reached its public-link budget for ${alert.period.slice(0, 7)}`;
	return {
		subject: `[egress] ${alert.kind === "alert_day" ? "Spike" : "Budget reached"}: owner ${alert.owner_id}`,
		body:
			`<p>Owner ${escape_html(alert.owner_id)} ${escape_html(what)}.</p>` +
			`<p>Today: ${format_gib(alert.day_bytes)}. This month: ${format_gib(alert.month_bytes)}. ` +
			`Budget: ${format_gib(alert.budget_bytes)}. Mode: ${escape_html(alert.mode)}.</p>`,
	};
}

export type HubMailBoard = {
	name: string;
	username: string | null;
	slug: string | null;
	url: string | null;
	abuse_email: string | null;
};

export function hub_hidden_email_copy(board: HubMailBoard): { subject: string; body: string } {
	const title = subject_text(board.name) || "Your board";
	const link = board.url
		? `<p>The public link still works: <a href="${escape_html(board.url)}">${escape_html(board.url)}</a></p>`
		: "";
	const appeal = board.abuse_email
		? `<p>To appeal, write to <a href="mailto:${escape_html(board.abuse_email)}">${escape_html(board.abuse_email)}</a>.</p>`
		: "";
	return {
		subject: `${title} is hidden from the Hub until review`,
		body:
			`<p>${escape_html(title)} was hidden from the Hub after several reports. ` +
			`It stays off the gallery until a moderator looks at it.</p>` +
			link +
			appeal,
	};
}

export function hub_made_private_email_copy(
	board: HubMailBoard,
	reason: string,
): { subject: string; body: string } {
	const title = subject_text(board.name) || "Your board";
	const appeal = board.abuse_email
		? `<p>Questions: <a href="mailto:${escape_html(board.abuse_email)}">${escape_html(board.abuse_email)}</a>.</p>`
		: "";
	return {
		subject: `${title} was unpublished`,
		body:
			`<p>${escape_html(title)} was taken private. The public link no longer works.</p>` +
			`<p>Reason: ${escape_html(reason)}</p>` +
			appeal,
	};
}

export type HubDigestPayload = {
	since: string;
	listings: Array<{
		workspace_id: string;
		listed_at: string;
		name: string;
		slug: string | null;
		username: string | null;
		hidden_at: string | null;
		hidden_reason: string | null;
	}>;
	hidden: Array<{
		workspace_id: string;
		hidden_at: string | null;
		name: string;
		slug: string | null;
		username: string | null;
		report_count: number;
		reasons: string[];
	}>;
};

export function moderation_digest_email_copy(
	payload: HubDigestPayload,
	app_url: string | null,
): { subject: string; body: string } {
	const listings = payload.listings
		.map((row) => {
			const addr = row.username && row.slug ? `/${row.username}/${row.slug}` : row.workspace_id;
			const href = app_url && row.username && row.slug ? `${app_url}/${row.username}/${row.slug}` : addr;
			const hidden = row.hidden_at ? " (already hidden)" : "";
			return `<li><a href="${escape_html(href)}">${escape_html(row.name)}</a>${hidden}</li>`;
		})
		.join("");
	const hidden = payload.hidden
		.map((row) => {
			const addr = row.username && row.slug ? `/${row.username}/${row.slug}` : row.workspace_id;
			const href = app_url && row.username && row.slug ? `${app_url}/${row.username}/${row.slug}` : addr;
			const reasons = row.reasons.length ? escape_html(row.reasons.join("; ")) : "—";
			return `<li><a href="${escape_html(href)}">${escape_html(row.name)}</a> — ${row.report_count} reports: ${reasons}</li>`;
		})
		.join("");
	return {
		subject: `Hub digest: ${payload.listings.length} new, ${payload.hidden.length} hidden by reports`,
		body:
			`<p>New listings since ${escape_html(payload.since)}.</p>` +
			`<p><strong>New</strong></p><ul>${listings || "<li>None</li>"}</ul>` +
			`<p><strong>Hidden by reports</strong></p><ul>${hidden || "<li>None</li>"}</ul>`,
	};
}

function str_field(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function parse_hook_payload(raw: string): { user: HookUser; email_data: EmailData } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new ApiError(400, "expected a JSON object body");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new ApiError(400, "expected a JSON object body");
	}
	const body = parsed as Record<string, unknown>;
	const user_raw = body.user;
	const data_raw = body.email_data;
	if (!user_raw || typeof user_raw !== "object" || Array.isArray(user_raw)) {
		throw new ApiError(400, "expected a JSON object body");
	}
	if (!data_raw || typeof data_raw !== "object" || Array.isArray(data_raw)) {
		throw new ApiError(400, "expected a JSON object body");
	}
	const user_obj = user_raw as Record<string, unknown>;
	const data_obj = data_raw as Record<string, unknown>;
	const email = str_field(user_obj.email);
	const action = str_field(data_obj.email_action_type);
	if (!email || !action) throw new ApiError(400, "expected a JSON object body");
	return {
		user: { email, new_email: str_field(user_obj.new_email) },
		email_data: {
			token: str_field(data_obj.token),
			token_hash: str_field(data_obj.token_hash),
			redirect_to: str_field(data_obj.redirect_to),
			email_action_type: action,
			token_new: str_field(data_obj.token_new),
			token_hash_new: str_field(data_obj.token_hash_new),
		},
	};
}

export async function plunk_send(
	env: Env,
	to: string,
	subject: string,
	body: string,
	send: FetchLike,
): Promise<void> {
	const from = env.plunk_from_name
		? { email: env.plunk_from_email!, name: env.plunk_from_name }
		: env.plunk_from_email!;
	const res = await send(PLUNK_SEND_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.plunk_secret_key}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ to, subject, body, from, subscribed: false }),
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		console.error("plunk send:", res.status, detail);
		throw new ApiError(502, "email delivery failed");
	}
}

function message_for(
	env: Env,
	action: string,
	token_hash: string,
	token: string,
	redirect_to: string,
	extra?: string,
): { subject: string; body: string } {
	const url = token_hash
		? confirmation_url(env.supabase_url, token_hash, action, redirect_to)
		: "";
	return auth_email_copy(action, { url, token, extra });
}

// POST /auth/send-email — Supabase Auth Send Email hook. Auth mints the
// token; this handler only delivers. Enabling the hook disables Auth SMTP,
// so every email_action_type must be handled here.
export async function handle_send_email(
	env: Env,
	req: Request,
	send: FetchLike = fetch,
): Promise<Response> {
	if (!env.send_email_hook_secret || !env.plunk_secret_key || !env.plunk_from_email) {
		throw new ApiError(503, "send-email hook is not configured");
	}

	const raw = await req.text();
	verify_standard_webhook(
		raw,
		{
			id: req.headers.get("webhook-id") ?? "",
			timestamp: req.headers.get("webhook-timestamp") ?? "",
			signature: req.headers.get("webhook-signature") ?? "",
		},
		hook_secret_bytes(env.send_email_hook_secret),
	);

	const { user, email_data } = parse_hook_payload(raw);
	const action = email_data.email_action_type;

	if (action === "email_change" && email_data.token_hash_new && email_data.token_hash) {
		// Secure Email Change: token_hash_new + token → current address;
		// token_hash + token_new → new address (field names are reversed)
		const current = message_for(
			env,
			action,
			email_data.token_hash_new,
			email_data.token,
			email_data.redirect_to,
			"current",
		);
		const next = message_for(
			env,
			action,
			email_data.token_hash,
			email_data.token_new,
			email_data.redirect_to,
			"new",
		);
		await plunk_send(env, user.email, current.subject, current.body, send);
		await plunk_send(env, user.new_email || user.email, next.subject, next.body, send);
	} else {
		const to =
			action === "email_change" ? user.new_email || user.email : user.email;
		const copy = message_for(
			env,
			action,
			email_data.token_hash,
			email_data.token,
			email_data.redirect_to,
		);
		await plunk_send(env, to, copy.subject, copy.body, send);
	}

	return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
}
