import { ApiError, internal_error, service_client } from "../auth";
import type { Env } from "../env";
import { hook_secret_bytes, verify_standard_webhook } from "../mail";
import { PolarApi } from "./polar";
import { effective_state, type BillingState } from "./state";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a webhook may change for a customer; every other type is acknowledged and left alone */
export function handled_event(type: string): boolean {
	return type.startsWith("subscription.") || type === "order.refunded" || type === "customer.deleted";
}

/** Our user id, which checkout sets as Polar's external customer id */
export function customer_external_id(type: string, data: Record<string, unknown>): string | null {
	if (type === "customer.deleted") return typeof data.external_id === "string" ? data.external_id : null;
	const customer = data.customer;
	if (customer && typeof customer === "object") {
		const id = (customer as Record<string, unknown>).external_id;
		if (typeof id === "string") return id;
	}
	return null;
}

/** The trail row keeps only what explains the change: no email, address or card */
export function event_summary(type: string, data: Record<string, unknown>): Record<string, unknown> {
	const text = (value: unknown) => (typeof value === "string" ? value : null);
	return {
		type,
		subscription_id: type.startsWith("subscription.") ? text(data.id) : text(data.subscription_id),
		status: text(data.status),
		product_id: text(data.product_id),
	};
}

export type ApplyArgs = {
	owner: string;
	state: BillingState;
	synced_at: string;
	event_id: string;
	event: Record<string, unknown>;
};

/** The two database calls of the webhook, so the tests can stand in for them */
export type BillingStore = {
	seen(event_id: string): Promise<boolean>;
	apply(args: ApplyArgs): Promise<string>;
};

export function supabase_billing_store(env: Env): BillingStore {
	const db = service_client(env);
	return {
		async seen(event_id) {
			const { data, error } = await db
				.from("billing_events")
				.select("event_id")
				.eq("event_id", event_id)
				.maybeSingle();
			if (error) throw internal_error("billing event lookup", error);
			return data !== null;
		},
		async apply({ owner, state, synced_at, event_id, event }) {
			const { data, error } = await db.rpc("apply_billing_state", {
				p_owner: owner,
				p_plan: state.plan,
				p_status: state.status,
				p_interval: state.interval,
				p_period_end: state.period_end,
				p_cancel_at_period_end: state.cancel_at_period_end,
				p_subscription_id: state.subscription_id,
				p_synced_at: synced_at,
				p_event_id: event_id,
				p_event: event,
			});
			if (error) throw internal_error("billing state apply", error);
			return String(data);
		},
	};
}

export type WebhookDeps = {
	api?: Pick<PolarApi, "list_subscriptions">;
	store?: BillingStore;
	now?: () => Date;
};

// POST /billing/webhook — Polar, signed by Standard Webhooks. The event only
// says that something changed for a customer; the adapter then reads that
// customer's subscriptions back from Polar and applies what it reads, so
// late, repeated or reordered deliveries are harmless by construction (an
// older read never overwrites a newer one: apply_billing_state). A repeat of
// the same delivery (webhook-id) is answered without work. Failures answer
// 5xx so Polar delivers again; unknown event types answer 202
export async function handle_polar_webhook(env: Env, req: Request, deps: WebhookDeps = {}): Promise<Response> {
	if (!env.polar.webhook_secret || !env.polar.access_token || !env.supabase_service_role_key) {
		throw new ApiError(503, "billing webhook is not configured");
	}

	const raw = await req.text();
	const webhook_id = req.headers.get("webhook-id") ?? "";
	verify_standard_webhook(
		raw,
		{
			id: webhook_id,
			timestamp: req.headers.get("webhook-timestamp") ?? "",
			signature: req.headers.get("webhook-signature") ?? "",
		},
		hook_secret_bytes(env.polar.webhook_secret, "billing webhook"),
	);

	let event: { type?: unknown; data?: unknown };
	try {
		event = JSON.parse(raw) as { type?: unknown; data?: unknown };
	} catch {
		throw new ApiError(400, "expected a JSON body");
	}
	const type = typeof event.type === "string" ? event.type : "";
	if (!handled_event(type)) return Response.json({ ok: true, ignored: type }, { status: 202 });

	const data = event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : {};
	const owner = customer_external_id(type, data);
	if (!owner || !UUID_RE.test(owner)) {
		console.warn(`billing webhook: ${type} names no account of ours; ignored`);
		return Response.json({ ok: true, ignored: "no account" }, { status: 202 });
	}

	const event_id = `polar:${webhook_id}`;
	const store = deps.store ?? supabase_billing_store(env);
	if (await store.seen(event_id)) return Response.json({ ok: true, duplicate: true });

	// the read time, taken before the read: whatever Polar answers is at least this fresh
	const synced_at = (deps.now ?? (() => new Date()))().toISOString();
	const api = deps.api ?? new PolarApi(env.polar);
	const state = effective_state(await api.list_subscriptions(owner), env.polar.products);
	if (state.unmapped.length > 0) {
		console.error(`billing webhook: paid subscription on a product this server does not map: ${state.unmapped.join(", ")}`);
	}

	const result = await store.apply({ owner, state, synced_at, event_id, event: event_summary(type, data) });
	return Response.json({ ok: true, result, plan: state.plan });
}
