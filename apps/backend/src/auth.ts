import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { Env } from "./env";

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
		public extra: Record<string, unknown> = {},
		public headers: Record<string, string> = {},
	) {
		super(message);
		this.name = "ApiError";
	}
}

// PostgREST / Auth error texts describe our schema and queries; they belong
// in the server log, not in the response. Clients get a stable phrase
export function internal_error(context: string, detail: unknown): ApiError {
	console.error(`${context}:`, detail instanceof Error ? detail.message : detail);
	return new ApiError(500, `${context} failed`);
}

// Per-request client that queries Postgres AS the caller: the JWT is
// forwarded and RLS decides what is visible. Without a token it is an anon
// client — enough to read published (is_public) workspaces
export function user_client(env: Env, token: string | null): SupabaseClient {
	return createClient(env.supabase_url, env.supabase_publishable_key, {
		auth: { persistSession: false, autoRefreshToken: false },
		global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
	});
}

// Service role bypasses RLS — used ONLY by system jobs (the GC worker, the
// blob copy/reconcile paths). User requests are always authorized first
// through a per-request user client (RLS) before any privileged write
export function service_client(env: Env): SupabaseClient {
	if (!env.supabase_service_role_key) {
		throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
	}
	return createClient(env.supabase_url, env.supabase_service_role_key, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
}

export function bearer_token(req: Request): string | null {
	const header = req.headers.get("Authorization");
	if (!header?.startsWith("Bearer ")) return null;
	return header.slice("Bearer ".length).trim() || null;
}

// Verify the access token the same way PostgREST does: signature + exp via
// JWKS (`getClaims`). `getUser` hits GET /auth/v1/user and looks up the
// session row — after sign-out elsewhere, refresh-token rotation, or a
// time-box, that row is gone (`session_not_found`) while the JWT is still
// valid, so listing files works and /presign/upload returns 401.
export async function require_user(client: SupabaseClient, token: string | null): Promise<User> {
	if (!token) throw new ApiError(401, "missing bearer token");
	try {
		const { data, error } = await client.auth.getClaims(token);
		const sub = data?.claims?.sub;
		if (error || !sub) {
			console.error("require_user:", error?.message ?? "missing sub claim");
			throw new ApiError(401, "invalid or expired token");
		}
		return { id: sub } as User;
	} catch (err) {
		if (err instanceof ApiError) throw err;
		console.error("require_user:", err instanceof Error ? err.message : err);
		throw new ApiError(401, "invalid or expired token");
	}
}

// Mirrors private.can_write_workspace in schema.sql: the caller is the
// owner or a member with role='editor'. Public is a visibility flag, not
// a freeze — uploads still go through here. Queries run under the
// caller's JWT, so RLS additionally hides workspaces the caller does not
// belong to at all
export async function require_write_access(
	client: SupabaseClient,
	user: User,
	workspace_id: string,
): Promise<void> {
	const { data: workspace, error } = await client
		.from("workspaces")
		.select("owner_id")
		.eq("id", workspace_id)
		.maybeSingle();
	if (error) throw internal_error("workspace lookup", error);
	if (!workspace) throw new ApiError(403, "no access to the workspace");
	if (workspace.owner_id === user.id) return;

	const { data: member, error: member_error } = await client
		.from("workspace_members")
		.select("role")
		.eq("workspace_id", workspace_id)
		.eq("user_id", user.id)
		.maybeSingle();
	if (member_error) throw internal_error("membership lookup", member_error);
	if (member?.role !== "editor") throw new ApiError(403, "editor role required");
}

// Same check as require_write_access today; kept as a named alias because
// /blobs/copy-clones historically allowed clone owners after publish.
// Fork still uses it after copying into the caller's new private workspace.
export const require_owner_or_editor = require_write_access;

export async function require_workspace_owner(
	client: SupabaseClient,
	user: User,
	workspace_id: string,
): Promise<void> {
	const { data: workspace, error } = await client
		.from("workspaces")
		.select("owner_id")
		.eq("id", workspace_id)
		.maybeSingle();
	if (error) throw internal_error("workspace lookup", error);
	if (!workspace) throw new ApiError(403, "no access to the workspace");
	if (workspace.owner_id !== user.id) {
		throw new ApiError(403, "only the owner can do this");
	}
}
