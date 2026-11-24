import { ApiError, internal_error } from "./auth";
import type { Env } from "./env";
import { hook_secret_bytes, verify_standard_webhook, type FetchLike } from "./mail";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** The key a sign-up form puts its Turnstile token under (user metadata) */
export const CAPTCHA_METADATA_KEY = "captcha_token";

type HookUser = { email?: unknown; user_metadata?: unknown; app_metadata?: unknown };

function reject(message: string): Response {
	// Status 200 with an `error` object: Auth reads the body only on a 2xx and
	// then answers the client with http_code and message. A 4xx itself is
	// taken as a broken hook ("Invalid payload sent to hook", a 500 to the
	// client, whatever the body says)
	return Response.json({ error: { http_code: 400, message } }, { status: 200 });
}

/** Cloudflare's answer for one token; any failure to ask is a refusal */
export async function verify_turnstile(
	secret: string,
	token: string,
	ip: string | null,
	send: FetchLike = fetch,
): Promise<boolean> {
	try {
		const res = await send(SITEVERIFY_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
		});
		if (!res.ok) return false;
		const body = (await res.json()) as { success?: unknown };
		return body.success === true;
	} catch (err) {
		console.error("turnstile siteverify:", err);
		return false;
	}
}

// POST /auth/before-user-created — Supabase Auth's "Before User Created"
// hook. Only a NEW account passes through it: sign-in, password reset and a
// repeat sign-up of an unconfirmed address never do, so the CAPTCHA guards
// account creation alone and every client keeps signing in as before. The
// sign-up form sends its Turnstile token in the user metadata; Cloudflare
// checks it here (single use, a few minutes). Without TURNSTILE_SECRET_KEY
// every sign-up passes, so this can ship before the keys exist. A trigger
// on auth.users drops the token before the row is written (schema.sql)
export async function handle_before_user_created(
	env: Env,
	req: Request,
	send: FetchLike = fetch,
): Promise<Response> {
	if (!env.signup_hook_secret) throw new ApiError(503, "sign-up hook is not configured");
	const raw = await req.text();
	verify_standard_webhook(
		raw,
		{
			id: req.headers.get("webhook-id") ?? "",
			timestamp: req.headers.get("webhook-timestamp") ?? "",
			signature: req.headers.get("webhook-signature") ?? "",
		},
		hook_secret_bytes(env.signup_hook_secret, "sign-up hook"),
	);
	let payload: { user?: HookUser; metadata?: { ip_address?: unknown } };
	try {
		payload = JSON.parse(raw) as typeof payload;
	} catch {
		throw internal_error("sign-up hook", "payload is not JSON");
	}
	if (!env.turnstile_secret_key) return Response.json({});

	const metadata = payload.user?.user_metadata;
	const token = metadata && typeof metadata === "object" && !Array.isArray(metadata)
		? (metadata as Record<string, unknown>)[CAPTCHA_METADATA_KEY]
		: undefined;
	if (typeof token !== "string" || token.length === 0 || token.length > 4096) {
		return reject("captcha_required");
	}
	const ip = typeof payload.metadata?.ip_address === "string" ? payload.metadata.ip_address : null;
	if (!(await verify_turnstile(env.turnstile_secret_key, token, ip, send))) {
		return reject("captcha_failed");
	}
	return Response.json({});
}
