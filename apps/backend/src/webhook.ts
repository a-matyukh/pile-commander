import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError, internal_error, service_client } from "./auth";
import type { Env } from "./env";

function hex_hmac_sha256(secret: string, payload: string): string {
	return createHmac("sha256", secret).update(payload).digest("hex");
}

function signatures_match(expected_hex: string, provided: string): boolean {
	const a = Buffer.from(expected_hex, "utf8");
	const b = Buffer.from(provided.trim().toLowerCase(), "utf8");
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

function event_id_of(payload: Record<string, unknown>): string | null {
	if (typeof payload.id === "string" && payload.id) return payload.id;
	if (typeof payload.event_id === "string" && payload.event_id) return payload.event_id;
	const data = payload.data;
	if (data && typeof data === "object" && !Array.isArray(data)) {
		const inner = (data as Record<string, unknown>).id;
		if (typeof inner === "string" && inner) return inner;
	}
	return null;
}

// POST /billing/webhook — HMAC of the raw body, insert billing_events by
// provider event id. Duplicate delivery returns 200. Does not change plans
// during beta (the live MoR adapter lands with paid launch).
export async function handle_billing_webhook(env: Env, req: Request): Promise<Response> {
	if (!env.billing_webhook_secret) {
		throw new ApiError(503, "billing webhook is not configured");
	}
	if (!env.supabase_service_role_key) {
		throw new ApiError(503, "service role is not configured on the backend");
	}

	const raw = await req.text();
	const signature =
		req.headers.get("x-webhook-signature") ?? req.headers.get("webhook-signature") ?? "";
	if (!signature) throw new ApiError(401, "missing webhook signature");

	const expected = hex_hmac_sha256(env.billing_webhook_secret, raw);
	if (!signatures_match(expected, signature)) {
		throw new ApiError(401, "invalid webhook signature");
	}

	let payload: Record<string, unknown>;
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("not an object");
		}
		payload = parsed as Record<string, unknown>;
	} catch {
		throw new ApiError(400, "expected a JSON object body");
	}

	const event_id = event_id_of(payload);
	if (!event_id) throw new ApiError(400, "missing event id");

	const db = service_client(env);
	const { error } = await db.from("billing_events").insert({ event_id, payload });
	if (error) {
		if (error.code === "23505") {
			return Response.json({ ok: true, duplicate: true });
		}
		throw internal_error("billing event insert", error);
	}
	return Response.json({ ok: true });
}
