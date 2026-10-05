import type { Env } from "./env";
import { ApiError, bearer_token, internal_error, require_user, service_client, user_client } from "./auth";

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
// the token alone is not enough: the client re-enters the password first
export async function handle_delete_account(env: Env, req: Request): Promise<Response> {
	if (!env.supabase_service_role_key) {
		throw new ApiError(503, "account deletion is not configured on this server");
	}
	const token = bearer_token(req);
	const client = user_client(env, token);
	const user = await require_user(client, token);
	// require_user validated the token; the claims below belong to that same string
	assert_recent_authentication(token!, env.account_delete_max_auth_age_seconds);

	const admin = service_client(env);
	const { error } = await admin.auth.admin.deleteUser(user.id);
	if (error) throw internal_error("account deletion", error);

	return Response.json({ ok: true });
}
