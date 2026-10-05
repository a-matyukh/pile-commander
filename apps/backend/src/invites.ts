import { ApiError, bearer_token, internal_error, require_user, require_workspace_owner, user_client } from "./auth";
import type { Env } from "./env";
import {
	plunk_send,
	workspace_invite_email_copy,
	workspace_invite_url,
	type FetchLike,
} from "./mail";
import { normalize_waitlist_email } from "./waitlist";

export type AddMemberKind = "member" | "pending";

export type AddMemberResult =
	| { kind: "member" }
	| { kind: "pending"; token: string; workspace_name: string; inviter: string };

export type AddMemberFn = (
	workspace_id: string,
	email: string,
	role: "editor" | "viewer",
) => Promise<AddMemberResult>;

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function map_add_member_error(message: string): ApiError {
	const text = message.toLowerCase();
	if (text.includes("already a member")) return new ApiError(409, "already a member");
	if (text.includes("too many pending")) return new ApiError(429, "too many pending invites");
	if (text.includes("cannot be shared") || text.includes("system workspace")) {
		return new ApiError(400, "cannot share this workspace");
	}
	if (text.includes("only the owner")) return new ApiError(403, "only the owner can share");
	if (text.includes("needs no membership")) return new ApiError(400, "cannot invite yourself");
	if (text.includes("invalid role") || text.includes("invalid email")) {
		return new ApiError(400, "invalid invite");
	}
	if (text.includes("not authenticated")) return new ApiError(401, "invalid or expired token");
	return internal_error("add workspace member", message);
}

export function parse_add_member_result(data: unknown): AddMemberResult {
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		throw internal_error("add workspace member", "unexpected rpc payload");
	}
	const row = data as Record<string, unknown>;
	if (row.kind === "member") return { kind: "member" };
	if (row.kind === "pending") {
		const token = typeof row.token === "string" ? row.token : "";
		const workspace_name = typeof row.workspace_name === "string" ? row.workspace_name : "";
		const inviter = typeof row.inviter === "string" ? row.inviter : "";
		if (!token) throw internal_error("add workspace member", "pending invite missing token");
		return { kind: "pending", token, workspace_name, inviter };
	}
	throw internal_error("add workspace member", "unexpected rpc payload");
}

function default_add_member(env: Env, req: Request): AddMemberFn {
	return async (workspace_id, email, role) => {
		const token = bearer_token(req);
		const client = user_client(env, token);
		const user = await require_user(client, token);
		await require_workspace_owner(client, user, workspace_id);
		const { data, error } = await client.rpc("add_workspace_member", {
			p_workspace: workspace_id,
			p_email: email,
			p_role: role,
		});
		if (error) throw map_add_member_error(error.message);
		return parse_add_member_result(data);
	};
}

// POST /workspace/invite — owner JWT. Registered email becomes a member with
// no mail; otherwise pending + Plunk. Resend is the same path (RPC upserts).
export async function handle_workspace_invite(
	env: Env,
	req: Request,
	add_member: AddMemberFn = default_add_member(env, req),
	send: FetchLike = fetch,
): Promise<Response> {
	let body: Record<string, unknown>;
	try {
		const parsed = (await req.json()) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("not an object");
		}
		body = parsed as Record<string, unknown>;
	} catch {
		throw new ApiError(400, "expected a JSON object body");
	}

	const workspace_id = typeof body.workspace_id === "string" ? body.workspace_id.trim() : "";
	if (!UUID_RE.test(workspace_id)) throw new ApiError(400, "invalid workspace");

	const email = normalize_waitlist_email(body.email);
	if (!email) throw new ApiError(400, "invalid email");

	const role = body.role === "viewer" ? "viewer" : body.role === "editor" ? "editor" : null;
	if (!role) throw new ApiError(400, "invalid invite");

	const result = await add_member(workspace_id, email, role);
	if (result.kind === "member") {
		return Response.json({ ok: true, status: "member" satisfies AddMemberKind });
	}

	if (!env.public_app_url || !env.plunk_secret_key || !env.plunk_from_email) {
		throw new ApiError(503, "invite email is not configured on this server");
	}

	const url = workspace_invite_url(env.public_app_url, result.token);
	const copy = workspace_invite_email_copy({
		inviter: result.inviter,
		workspace_name: result.workspace_name,
		role,
		url,
	});
	await plunk_send(env, email, copy.subject, copy.body, send);
	return Response.json({ ok: true, status: "pending" satisfies AddMemberKind });
}
