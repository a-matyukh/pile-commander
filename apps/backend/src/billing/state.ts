import type { BillingInterval, PaidPlan, PolarEnv } from "../env";
import type { PolarSubscription } from "./polar";

/**
 * Polar statuses that keep a paid plan. past_due keeps it while Polar retries
 * the renewal (four tries over 21 days, then it revokes the subscription) —
 * the promise on the pricing page and in the Terms. Anything else (canceled,
 * unpaid, paused, incomplete …) is no paid plan
 */
export const KEEPS_PLAN: ReadonlySet<string> = new Set(["active", "trialing", "past_due"]);

const RANK: Record<PaidPlan, number> = { pro: 1, studio: 2, max: 3, ultra: 4 };

export type BillingState = {
	plan: "free" | PaidPlan;
	status: "active" | "past_due" | "canceled";
	interval: BillingInterval | null;
	period_end: string | null;
	cancel_at_period_end: boolean;
	subscription_id: string | null;
	/**
	 * A plan Polar has scheduled for later (a downgrade waits for the end of
	 * the period: `pending_update`). Null when nothing is scheduled, when it
	 * keeps the same plan, and when the subscription ends then instead —
	 * Polar keeps the pending change after a cancellation too
	 */
	next_plan: PaidPlan | null;
	next_plan_at: string | null;
	/** product ids of paid subscriptions this server does not map: logged, never applied */
	unmapped: string[];
};

function newer(a: PolarSubscription, b: PolarSubscription): boolean {
	return (a.modified_at ?? a.created_at) > (b.modified_at ?? b.created_at);
}

/**
 * What a customer has right now, from all of their Polar subscriptions. One
 * subscription per customer is the rule (multiple subscriptions are off in
 * Polar, and checkout sends a paying customer to the portal instead), but if
 * two ever overlap, the bigger plan wins so nobody loses room they pay for.
 * No paid subscription → Free: 'canceled' when one existed, 'active' when
 * the customer never had one
 */
export function effective_state(
	subscriptions: PolarSubscription[],
	products: PolarEnv["products"],
): BillingState {
	const unmapped: string[] = [];
	let best: { sub: PolarSubscription; plan: PaidPlan; interval: BillingInterval } | null = null;
	let last: PolarSubscription | null = null;

	for (const sub of subscriptions) {
		const mapped = products.get(sub.product_id);
		if (mapped && (!last || newer(sub, last))) last = sub;
		if (!KEEPS_PLAN.has(sub.status)) continue;
		if (!mapped) {
			unmapped.push(sub.product_id);
			continue;
		}
		if (
			!best
			|| RANK[mapped.plan] > RANK[best.plan]
			|| (RANK[mapped.plan] === RANK[best.plan] && newer(sub, best.sub))
		) {
			best = { sub, plan: mapped.plan, interval: mapped.interval };
		}
	}

	if (!best) {
		return {
			plan: "free",
			status: last ? "canceled" : "active",
			interval: null,
			period_end: null,
			cancel_at_period_end: false,
			subscription_id: last?.id ?? null,
			next_plan: null,
			next_plan_at: null,
			unmapped,
		};
	}
	const cancel_at_period_end = Boolean(best.sub.cancel_at_period_end);
	const pending = best.sub.pending_update ?? null;
	const scheduled = pending?.product_id ? products.get(pending.product_id) : undefined;
	const next = !cancel_at_period_end && scheduled && scheduled.plan !== best.plan && pending?.applies_at
		? { plan: scheduled.plan, at: pending.applies_at }
		: null;
	return {
		plan: best.plan,
		status: best.sub.status === "past_due" ? "past_due" : "active",
		interval: best.interval,
		period_end: best.sub.current_period_end ?? null,
		cancel_at_period_end,
		subscription_id: best.sub.id,
		next_plan: next?.plan ?? null,
		next_plan_at: next?.at ?? null,
		unmapped,
	};
}

/** The Polar product for one of our plans and intervals, or null when it is not configured */
export function product_for(
	products: PolarEnv["products"],
	plan: PaidPlan,
	interval: BillingInterval,
): string | null {
	for (const [id, mapped] of products) {
		if (mapped.plan === plan && mapped.interval === interval) return id;
	}
	return null;
}
