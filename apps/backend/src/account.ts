import type { Env } from "./env";
import { ApiError, bearer_token, internal_error, require_live_user, service_client, user_client } from "./auth";
import { PolarApi } from "./billing/polar";
import { default_erase, erase_feedback_of } from "./feedback";

// Supabase access tokens carry `amr`: one entry per authentication method used
// by the session, with the unix time it happened. A refreshed token keeps the
// original timestamps, so the newest one says how long ago the user actually
// proved who they are — not merely how long ago the token was minted
export function newest_auth_timestamp(token: string): number | null {
	const payload = token.split(".")[1];
	if (!payload) return null;
	try {
		const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
			amr?: unknown;
		};
		if (!Array.isArray(claims.amr)) return null;
		let newest: number | null = null;
		for (const entry of claims.amr) {
			const ts = (entry as { timestamp?: unknown })?.timestamp;
			if (typeof ts === "number" && Number.isFinite(ts) && (newest === null || ts > newest)) newest = ts;
		}
		return newest;
	} catch {
		return null;
	}
}

// Step-up: the session must have authenticated recently. A stolen access
// token (XSS, leaked log) is enough to read as the user for an hour; it must
// not be enough to wipe the account and enqueue every blob for deletion
export function assert_recent_authentication(
	token: string,
	max_age_seconds: number,
	now_seconds = Math.floor(Date.now() / 1000),
): void {
	const newest = newest_auth_timestamp(token);
	if (newest === null || now_seconds - newest > max_age_seconds) {
		throw new ApiError(401, "reauth_required", { max_auth_age_seconds: max_age_seconds });
	}
}

// POST /account/delete — deletes the caller's auth user. Cascades do the
// rest (schema.sql): auth.users → workspaces → entries, and the
// entries_queue_blob_deletion trigger enqueues every blob for the GC worker
// to remove from B2 (after GC_MIN_AGE_HOURS). Irreversible by definition, so
// the token alone is not enough: the client re-enters the password first.
// A paid subscription is canceled first (Polar deletes the customer, which
// ends its subscriptions at once); if Polar cannot be reached the account
// stays, so nobody keeps paying for an account that is gone
// Feedback notes are not tied to an account (anyone may send one), so no
// cascade reaches them: those sent from the account's address are erased
// here, after the account. A failure is logged and left to the notes' own
// retention (FEEDBACK_NOTE_DAYS)
export async function handle_delete_account(
	env: Env,
	req: Request,
	polar: Pick<PolarApi, "delete_customer"> | null = env.polar.access_token ? new PolarApi(env.polar) : null,
): Promise<Response> {
	if (!env.supabase_service_role_key) {
		throw new ApiError(503, "account deletion is not configured on this server");
	}
	const token = bearer_token(req);
	const client = user_client(env, token);
	// The session must still exist: a token carried off before "sign out
	// everywhere" is fresh by its own claims for the minutes that follow a
	// password entry, and this is the one request it must not win
	const user = await require_live_user(client, token);
	// the token is validated; the claims below belong to that same string
	assert_recent_authentication(token!, env.account_delete_max_auth_age_seconds);

	if (polar) await polar.delete_customer(user.id);

	const admin = service_client(env);
	const { error } = await admin.auth.admin.deleteUser(user.id);
	if (error) throw internal_error("account deletion", error);

	if (user.email) {
		try {
			const erased = await erase_feedback_of(user.email, default_erase(admin));
			if (erased > 0) console.log(`[account] erased ${erased} feedback note(s) of a deleted account`);
		} catch (err) {
			console.error("[account] erasing feedback notes failed:", err instanceof Error ? err.message : err);
		}
	}

	return Response.json({ ok: true });
}
