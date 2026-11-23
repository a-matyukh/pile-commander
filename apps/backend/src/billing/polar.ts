import { ApiError } from "../auth";
import type { PolarEnv } from "../env";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** The fields of a Polar subscription the adapter reads (pinned Polar-Version) */
export type PolarSubscription = {
	id: string;
	status: string;
	product_id: string;
	current_period_end: string | null;
	cancel_at_period_end: boolean;
	created_at: string;
	modified_at: string | null;
	/** a change Polar applies later, e.g. a downgrade at the period's end */
	pending_update?: { product_id?: string | null; applies_at?: string | null } | null;
};

export type PolarPrice = {
	amount_type: string;
	price_amount?: number;
	price_currency?: string;
	is_archived?: boolean;
};

export type PolarProduct = {
	id: string;
	is_archived: boolean;
	/** how often Polar bills it: "month", "year", … — null for a one-time product */
	recurring_interval: string | null;
	/** every N intervals; absent on older API versions, which only bill every 1 */
	recurring_interval_count?: number | null;
	prices: PolarPrice[];
};

export type CheckoutInput = {
	products: string[];
	external_customer_id: string;
	customer_email?: string;
	customer_ip_address?: string;
	/** where Polar sends the buyer after paying; without it Polar shows its own confirmation */
	success_url?: string;
	/** a back link in the checkout; without it there is none */
	return_url?: string;
};

export function polar_base_url(env: PolarEnv): string {
	return env.server === "sandbox" ? "https://sandbox-api.polar.sh" : "https://api.polar.sh";
}

/** Which failed answers mean "no such thing" (the call then returns null) */
type Missing = (status: number, body: unknown) => boolean;

const NOT_FOUND: Missing = (status) => status === 404;

// POST /v1/customer-sessions/ answers an external id it has never seen with a
// 422 on that field ("Customer does not exist."), not a 404 — checked against
// the sandbox. We always send our own user id, so a 422 there means "never bought"
const UNKNOWN_CUSTOMER: Missing = (status, body) => {
	if (status === 404) return true;
	if (status !== 422 || !body || typeof body !== "object") return false;
	const detail = (body as { detail?: unknown }).detail;
	return (
		Array.isArray(detail) &&
		detail.some((item) => {
			const loc = (item as { loc?: unknown } | null)?.loc;
			return Array.isArray(loc) && loc[loc.length - 1] === "external_customer_id";
		})
	);
};

function parse_json(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return null;
	}
}

/**
 * The few Polar calls the adapter makes. Every failure is a 502 with a
 * stable phrase; Polar's own error text goes to the log, never to the client,
 * and the token never appears in either
 */
export class PolarApi {
	constructor(
		private readonly env: PolarEnv,
		private readonly fetcher: FetchLike = fetch,
	) {}

	private async call<T>(method: string, path: string, body?: unknown, missing?: Missing): Promise<T | null> {
		if (!this.env.access_token) throw new ApiError(503, "billing is not configured on this server");
		const headers: Record<string, string> = {
			Authorization: `Bearer ${this.env.access_token}`,
			"Polar-Version": this.env.api_version,
			Accept: "application/json",
		};
		if (body !== undefined) headers["Content-Type"] = "application/json";
		let res: Response;
		try {
			res = await this.fetcher(`${polar_base_url(this.env)}${path}`, {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body),
			});
		} catch (err) {
			console.error(`polar ${method} ${path}:`, err instanceof Error ? err.message : err);
			throw new ApiError(502, "billing provider unavailable");
		}
		if (!res.ok) {
			const detail = await res.text().catch(() => "");
			if (missing?.(res.status, parse_json(detail))) return null;
			console.error(`polar ${method} ${path}: ${res.status} ${detail.slice(0, 500)}`);
			throw new ApiError(502, "billing provider error");
		}
		if (res.status === 204) return null;
		return (await res.json()) as T;
	}

	/** A checkout session for our signed-in user; the URL to send them to */
	async create_checkout(input: CheckoutInput): Promise<string> {
		const checkout = await this.call<{ url?: unknown }>("POST", "/v1/checkouts/", input);
		if (typeof checkout?.url !== "string" || !checkout.url) throw new ApiError(502, "billing provider error");
		return checkout.url;
	}

	/**
	 * The customer portal for our user; null when Polar has no such customer
	 * yet. `return_url` puts a back link in the portal; without it there is none
	 */
	async create_portal_session(external_customer_id: string, return_url?: string): Promise<string | null> {
		const session = await this.call<{ customer_portal_url?: unknown }>(
			"POST",
			"/v1/customer-sessions/",
			return_url ? { external_customer_id, return_url } : { external_customer_id },
			UNKNOWN_CUSTOMER,
		);
		if (session === null) return null;
		if (typeof session.customer_portal_url !== "string") throw new ApiError(502, "billing provider error");
		return session.customer_portal_url;
	}

	/** Every subscription of our user, in any status: the adapter picks what counts */
	async list_subscriptions(external_customer_id: string): Promise<PolarSubscription[]> {
		const query = new URLSearchParams({ external_customer_id, limit: "100" });
		const page = await this.call<{ items?: PolarSubscription[] }>("GET", `/v1/subscriptions/?${query}`);
		return Array.isArray(page?.items) ? page.items : [];
	}

	/**
	 * Account deletion: Polar cancels every subscription of the customer at
	 * once and anonymizes them; orders stay on Polar's side for refunds and
	 * tax. A user who never bought anything has no customer — that is fine
	 */
	async delete_customer(external_customer_id: string): Promise<void> {
		await this.call(
			"DELETE",
			`/v1/customers/external/${encodeURIComponent(external_customer_id)}?anonymize=true`,
			undefined,
			NOT_FOUND,
		);
	}

	async list_products(): Promise<PolarProduct[]> {
		const query = new URLSearchParams({ is_archived: "false", limit: "100" });
		const page = await this.call<{ items?: PolarProduct[] }>("GET", `/v1/products/?${query}`);
		return Array.isArray(page?.items) ? page.items : [];
	}
}
