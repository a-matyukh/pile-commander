import { ApiError, bearer_token, require_live_user, user_client } from "../auth";
import { PAID_PLANS, type BillingInterval, type Env, type PaidPlan } from "../env";
import { PolarApi, type PolarProduct } from "./polar";
import { KEEPS_PLAN, product_for } from "./state";

const INTERVALS: readonly BillingInterval[] = ["month", "year"];
// what Polar accepts as customer_ip_address: a bare IPv4 or IPv6 address
const IP_RE = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-f:]+)$/i;

export type BillingRouteDeps = {
	api?: Pick<PolarApi, "create_checkout" | "create_portal_session" | "list_subscriptions" | "list_products">;
	/** the verified caller: id from the JWT, email from Auth */
	caller?: (req: Request) => Promise<{ id: string; email: string | null }>;
};

function require_billing(env: Env): string {
	if (!env.polar.access_token || !env.supabase_service_role_key || !env.public_app_url) {
		throw new ApiError(503, "billing is not configured on this server");
	}
	return env.public_app_url;
}

// A checkout or the payment portal is opened only for a session that still
// exists (`require_live_user`); the same answer carries the address
async function verified_caller(env: Env, req: Request): Promise<{ id: string; email: string | null }> {
	const token = bearer_token(req);
	const user = await require_live_user(user_client(env, token), token);
	return { id: user.id, email: user.email ?? null };
}

async function json_object(req: Request): Promise<Record<string, unknown>> {
	try {
		const body = (await req.json()) as unknown;
		if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
	} catch {
		// fall through
	}
	throw new ApiError(400, "expected a JSON object body");
}

/**
 * Where Polar sends people back. The web app paid in its own tab, so it
 * returns there with ?billing=… and refreshes the plan. The desktop app
 * opened the system browser: Polar's own confirmation page ends that tab
 * (no success URL, no back link) and the app reads the plan when its window
 * is focused again
 */
type Client = "web" | "desktop";

function client_of(body: Record<string, unknown>): Client {
	return body.from === "desktop" ? "desktop" : "web";
}

function checkout_return(app_url: string, from: Client): { success_url?: string; return_url?: string } {
	if (from === "desktop") return {};
	return { success_url: `${app_url}/?billing=paid`, return_url: `${app_url}/?billing=back` };
}

function portal_return(app_url: string, from: Client): string | undefined {
	return from === "desktop" ? undefined : `${app_url}/?billing=portal`;
}

// POST /billing/checkout { plan, interval } → { url } or { portal_url }.
// Only for the verified caller, and only for a plan and interval this server
// maps to a Polar product: the browser never names a product or a customer.
// Polar ties the payment to the account through external_customer_id = our
// user id, which the webhook reads back. Somebody who already pays changes
// plan in the portal instead of buying a second subscription
export async function handle_checkout(env: Env, req: Request, ip: string, deps: BillingRouteDeps = {}): Promise<Response> {
	const app_url = require_billing(env);
	const caller = await (deps.caller ?? ((r) => verified_caller(env, r)))(req);
	const body = await json_object(req);
	const plan = body.plan as PaidPlan;
	const interval = body.interval as BillingInterval;
	if (!PAID_PLANS.includes(plan) || !INTERVALS.includes(interval)) {
		throw new ApiError(400, "unknown plan or interval");
	}
	const product = product_for(env.polar.products, plan, interval);
	if (!product) throw new ApiError(503, "this plan is not on sale yet");

	const api = deps.api ?? new PolarApi(env.polar);
	// what the plans list shows is all that is sold: a mapped product that
	// Polar bills on another interval than its env name says is in neither
	const on_sale = await plans_on_sale(env, api);
	const sells = (i: BillingInterval) => on_sale.some((p) => p.plan === plan && p.interval === i);
	if (!sells(interval)) throw new ApiError(503, "this plan is not on sale yet");
	const other_interval: BillingInterval = interval === "month" ? "year" : "month";
	const other = sells(other_interval) ? product_for(env.polar.products, plan, other_interval) : null;

	const from = client_of(body);
	const current = await api.list_subscriptions(caller.id);
	if (current.some((sub) => KEEPS_PLAN.has(sub.status) && env.polar.products.has(sub.product_id))) {
		const portal_url = await api.create_portal_session(caller.id, portal_return(app_url, from));
		if (portal_url) return Response.json({ portal_url });
	}

	const url = await api.create_checkout({
		// the chosen interval first; the other one lets people switch in the checkout
		products: other ? [product, other] : [product],
		external_customer_id: caller.id,
		...(caller.email ? { customer_email: caller.email } : {}),
		// Polar picks the country and currency by IP; ours would be Render's
		...(IP_RE.test(ip) ? { customer_ip_address: ip } : {}),
		...checkout_return(app_url, from),
	});
	return Response.json({ url });
}

// POST /billing/portal { from? } → { url }: Polar's customer portal for the
// caller — cancel, change plan, card, invoices. 404 when the caller never
// bought anything. The body is optional: no body is the web app
export async function handle_portal(env: Env, req: Request, deps: BillingRouteDeps = {}): Promise<Response> {
	const app_url = require_billing(env);
	const caller = await (deps.caller ?? ((r) => verified_caller(env, r)))(req);
	const body = await json_object(req).catch(() => ({}));
	const api = deps.api ?? new PolarApi(env.polar);
	const url = await api.create_portal_session(caller.id, portal_return(app_url, client_of(body)));
	if (!url) throw new ApiError(404, "no billing account");
	return Response.json({ url });
}

export type PlanPrice = { plan: PaidPlan; interval: BillingInterval; amount: number; currency: string };

/**
 * The prices of our mapped products, as Polar has them (cents); archived
 * prices skipped. A product sells what its env name says or not at all: the
 * interval is fixed when the product is created in Polar, so "Studio, yearly"
 * made with a monthly cycle would charge the yearly price every month
 */
export function plan_prices(products: PolarProduct[], mapping: Env["polar"]["products"]): PlanPrice[] {
	const prices: PlanPrice[] = [];
	for (const product of products) {
		const mapped = mapping.get(product.id);
		if (!mapped || product.is_archived) continue;
		const every = product.recurring_interval_count ?? 1;
		if (product.recurring_interval !== mapped.interval || every !== 1) {
			console.error(
				`billing: product ${product.id} is mapped as ${mapped.plan}/${mapped.interval}, but Polar bills it ` +
					`${product.recurring_interval ? `every ${every} ${product.recurring_interval}` : "once"}; not on sale`,
			);
			continue;
		}
		const price = product.prices.find(
			(p) => p.amount_type === "fixed" && !p.is_archived && typeof p.price_amount === "number",
		);
		if (!price) continue;
		prices.push({
			plan: mapped.plan,
			interval: mapped.interval,
			amount: price.price_amount as number,
			currency: price.price_currency ?? "usd",
		});
	}
	const order = (p: PlanPrice) => PAID_PLANS.indexOf(p.plan) * 2 + INTERVALS.indexOf(p.interval);
	return prices.sort((a, b) => order(a) - order(b));
}

const PLANS_TTL_MS = 10 * 60 * 1000;
let plans_cache: { at: number; plans: PlanPrice[] } | null = null;

/** plan_prices of the live catalog, cached for a few minutes; shared by the list and the checkout */
async function plans_on_sale(env: Env, api: Pick<PolarApi, "list_products">, now = Date.now()): Promise<PlanPrice[]> {
	if (plans_cache && now - plans_cache.at < PLANS_TTL_MS) return plans_cache.plans;
	const plans = plan_prices(await api.list_products(), env.polar.products);
	plans_cache = { at: now, plans };
	return plans;
}

// GET /billing/plans → { plans }: prices live in Polar, limits in
// plan_defaults; the app shows both without duplicating either. Public,
// cached for a few minutes so a busy pricing dialog is not a Polar call each
export async function handle_plans(env: Env, deps: BillingRouteDeps = {}, now = Date.now()): Promise<Response> {
	if (!env.polar.access_token) throw new ApiError(503, "billing is not configured on this server");
	const plans = await plans_on_sale(env, deps.api ?? new PolarApi(env.polar), now);
	return Response.json({ plans });
}

/** tests only: the next handle_plans call reads Polar again */
export function reset_plans_cache(): void {
	plans_cache = null;
}
