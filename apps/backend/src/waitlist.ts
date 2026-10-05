import { ApiError, internal_error, service_client } from "./auth";
import type { Env } from "./env";

export type WaitlistInsert = (row: {
	email: string;
	subscribed: boolean;
	source: string;
}) => Promise<{ error: { code?: string } | null }>;

// Same shape as the table CHECK: local-part @ domain with a dot. The
// handler also lowercases and trims so the unique PK is case-insensitive.
const EMAIL_RE = /^[^@]+@[^@]+\.[^@]+$/;

export function normalize_waitlist_email(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const email = raw.trim().toLowerCase();
	if (!email || email.length > 254) return null;
	if (!EMAIL_RE.test(email)) return null;
	return email;
}

export function honeypot_filled(website: unknown): boolean {
	return typeof website === "string" && website.trim().length > 0;
}

function default_insert(env: Env): WaitlistInsert {
	return async (row) => {
		const db = service_client(env);
		const { error } = await db.from("plan_launch_subscribers").insert(row);
		return { error };
	};
}

// POST /pricing/notify — public landing form. Writes under service_role;
// clients never see the table. Duplicate emails and the honeypot look like
// a successful subscribe so we do not leak who is already on the list.
export async function handle_pricing_notify(
	env: Env,
	req: Request,
	insert: WaitlistInsert = default_insert(env),
): Promise<Response> {
	if (!env.supabase_service_role_key) {
		throw new ApiError(503, "waitlist is not configured on this server");
	}

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

	if (honeypot_filled(body.website)) {
		return Response.json({ ok: true });
	}

	const email = normalize_waitlist_email(body.email);
	if (!email) throw new ApiError(400, "invalid email");

	const { error } = await insert({ email, subscribed: true, source: "pricing" });
	if (error) {
		if (error.code === "23505") return Response.json({ ok: true });
		throw internal_error("waitlist insert", error);
	}
	return Response.json({ ok: true });
}
