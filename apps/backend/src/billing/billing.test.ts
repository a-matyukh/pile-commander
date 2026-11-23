import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { ApiError } from "../auth";
import { polar_env, type Env, type PolarEnv } from "../env";
import { PolarApi, type CheckoutInput, type PolarProduct, type PolarSubscription } from "./polar";
import { handle_checkout, handle_plans, handle_portal, plan_prices, reset_plans_cache } from "./routes";
import { effective_state, product_for } from "./state";
import { event_summary, handle_polar_webhook, type ApplyArgs, type BillingStore } from "./webhook";

const OWNER = "12121212-1212-4212-8212-121212121212";
const KEY = Buffer.from("polar-webhook-test-key-0123456789");
const SECRET = `whsec_${KEY.toString("base64")}`;

const PRODUCTS: PolarEnv["products"] = new Map([
	["prod_pro_m", { plan: "pro", interval: "month" }],
	["prod_pro_y", { plan: "pro", interval: "year" }],
	["prod_max_m", { plan: "max", interval: "month" }],
	["prod_ultra_y", { plan: "ultra", interval: "year" }],
]);

function product(id: string, interval: string | null, amount: number, extra: Partial<PolarProduct> = {}): PolarProduct {
	return {
		id,
		is_archived: false,
		recurring_interval: interval,
		recurring_interval_count: 1,
		prices: [{ amount_type: "fixed", price_amount: amount, price_currency: "usd" }],
		...extra,
	};
}

/** Polar's catalog as it should be: every mapped product billed on the cycle its env name says */
const LIVE: PolarProduct[] = [
	product("prod_pro_m", "month", 1000),
	product("prod_pro_y", "year", 9600),
	product("prod_max_m", "month", 2400),
	product("prod_ultra_y", "year", 34800),
];

function env_with(overrides: Partial<PolarEnv> = {}, rest: Partial<Env> = {}): Env {
	const polar: PolarEnv = {
		access_token: "polar_oat_test",
		webhook_secret: SECRET,
		server: "sandbox",
		api_version: "2027-01",
		products: PRODUCTS,
		...overrides,
	};
	return {
		polar,
		supabase_service_role_key: "service-role",
		public_app_url: "https://app.test",
		...rest,
	} as unknown as Env;
}

function sub(partial: Partial<PolarSubscription>): PolarSubscription {
	return {
		id: "sub_1",
		status: "active",
		product_id: "prod_pro_m",
		current_period_end: "2026-12-23T00:00:00Z",
		cancel_at_period_end: false,
		created_at: "2026-11-23T00:00:00Z",
		modified_at: "2026-11-23T00:00:00Z",
		...partial,
	};
}

function signed(body: string, id = "msg_1", ts = Math.floor(Date.now() / 1000), key = KEY): Request {
	const signature = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
	return new Request("https://backend.test/billing/webhook", {
		method: "POST",
		body,
		headers: { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": `v1,${signature}` },
	});
}

function memory_store(seen: string[] = []): BillingStore & { applied: ApplyArgs[] } {
	const applied: ApplyArgs[] = [];
	return {
		applied,
		async seen(event_id) {
			return seen.includes(event_id);
		},
		async apply(args) {
			applied.push(args);
			return "applied";
		},
	};
}

async function api_error(promise: Promise<unknown>): Promise<ApiError> {
	try {
		await promise;
	} catch (err) {
		if (err instanceof ApiError) return err;
		throw err;
	}
	throw new Error("expected an ApiError");
}

describe("polar_env", () => {
	test("maps each configured product to its plan and interval, production by default", () => {
		const env = polar_env({
			POLAR_ACCESS_TOKEN: " oat ",
			POLAR_PRODUCT_PRO_MONTH: "p1",
			POLAR_PRODUCT_ULTRA_YEAR: "p8",
		});
		expect(env.access_token).toBe("oat");
		expect(env.server).toBe("production");
		expect(env.api_version).toBe("2027-01");
		expect([...env.products]).toEqual([
			["p1", { plan: "pro", interval: "month" }],
			["p8", { plan: "ultra", interval: "year" }],
		]);
	});

	test("sandbox only when asked, and nothing configured means no token", () => {
		expect(polar_env({ POLAR_SERVER: "sandbox" }).server).toBe("sandbox");
		expect(polar_env({}).access_token).toBeNull();
	});
});

describe("effective_state", () => {
	test("no subscription at all is Free and active", () => {
		expect(effective_state([], PRODUCTS)).toMatchObject({ plan: "free", status: "active", subscription_id: null });
	});

	test("an active subscription gives its plan, interval and period", () => {
		const state = effective_state([sub({ product_id: "prod_pro_y", cancel_at_period_end: true })], PRODUCTS);
		expect(state).toMatchObject({
			plan: "pro",
			status: "active",
			interval: "year",
			period_end: "2026-12-23T00:00:00Z",
			cancel_at_period_end: true,
			subscription_id: "sub_1",
		});
	});

	test("past_due keeps the plan while Polar retries", () => {
		expect(effective_state([sub({ status: "past_due" })], PRODUCTS)).toMatchObject({ plan: "pro", status: "past_due" });
	});

	test("a revoked subscription is Free and canceled, with the last subscription kept for the trail", () => {
		const state = effective_state([sub({ id: "sub_old", status: "canceled" })], PRODUCTS);
		expect(state).toMatchObject({ plan: "free", status: "canceled", interval: null, subscription_id: "sub_old" });
	});

	test("unpaid, paused or incomplete give no paid plan", () => {
		for (const status of ["unpaid", "paused", "incomplete", "incomplete_expired"]) {
			expect(effective_state([sub({ status })], PRODUCTS).plan).toBe("free");
		}
	});

	test("if two overlap, the bigger plan wins", () => {
		const state = effective_state(
			[sub({ id: "a", product_id: "prod_ultra_y" }), sub({ id: "b", product_id: "prod_max_m" })],
			PRODUCTS,
		);
		expect(state).toMatchObject({ plan: "ultra", subscription_id: "a" });
	});

	test("a paid subscription on a product we do not map is reported, never applied", () => {
		const state = effective_state([sub({ product_id: "prod_unknown" })], PRODUCTS);
		expect(state.plan).toBe("free");
		expect(state.unmapped).toEqual(["prod_unknown"]);
	});

	test("product_for finds the product of a plan and interval", () => {
		expect(product_for(PRODUCTS, "pro", "year")).toBe("prod_pro_y");
		expect(product_for(PRODUCTS, "studio", "month")).toBeNull();
	});
});

describe("handle_polar_webhook", () => {
	const body = JSON.stringify({
		type: "subscription.updated",
		data: {
			id: "sub_1",
			status: "active",
			product_id: "prod_pro_m",
			customer: { external_id: OWNER, email: "buyer@example.com" },
		},
	});

	test("503 until the token and the secret are set", async () => {
		const err = await api_error(handle_polar_webhook(env_with({ webhook_secret: null }), signed(body)));
		expect(err.status).toBe(503);
	});

	test("a wrong signature or an old timestamp is 401", async () => {
		const forged = await api_error(
			handle_polar_webhook(env_with(), signed(body, "msg_1", undefined, Buffer.from("another-key")), { store: memory_store() }),
		);
		expect(forged.status).toBe(401);
		const replayed = await api_error(
			handle_polar_webhook(env_with(), signed(body, "msg_1", Math.floor(Date.now() / 1000) - 3600), { store: memory_store() }),
		);
		expect(replayed.status).toBe(401);
	});

	test("reads the customer's subscriptions back from Polar and applies them", async () => {
		const store = memory_store();
		let asked: string | null = null;
		const now = new Date("2026-11-23T12:00:00Z");
		const res = await handle_polar_webhook(env_with(), signed(body, "msg_42"), {
			store,
			now: () => now,
			api: {
				async list_subscriptions(id) {
					asked = id;
					return [sub({ product_id: "prod_max_m" })];
				},
			},
		});
		expect(res.status).toBe(200);
		expect(asked as string | null).toBe(OWNER);
		expect(store.applied).toHaveLength(1);
		const applied = store.applied[0]!;
		expect(applied.owner).toBe(OWNER);
		expect(applied.event_id).toBe("polar:msg_42");
		expect(applied.synced_at).toBe(now.toISOString());
		// the state comes from the read, not from the event (which said Pro)
		expect(applied.state.plan).toBe("max");
		expect(applied.event).toEqual({ type: "subscription.updated", subscription_id: "sub_1", status: "active", product_id: "prod_pro_m" });
	});

	test("a repeated delivery is answered without reading Polar or writing", async () => {
		const store = memory_store(["polar:msg_7"]);
		const res = await handle_polar_webhook(env_with(), signed(body, "msg_7"), {
			store,
			api: {
				async list_subscriptions() {
					throw new Error("must not be called");
				},
			},
		});
		expect(res.status).toBe(200);
		expect(((await res.json()) as { duplicate?: boolean }).duplicate).toBe(true);
		expect(store.applied).toHaveLength(0);
	});

	test("an event type we do not handle is 202 and changes nothing", async () => {
		const store = memory_store();
		const res = await handle_polar_webhook(
			env_with(),
			signed(JSON.stringify({ type: "product.updated", data: {} })),
			{ store },
		);
		expect(res.status).toBe(202);
		expect(store.applied).toHaveLength(0);
	});

	test("an event without one of our accounts is 202", async () => {
		const store = memory_store();
		const foreign = JSON.stringify({ type: "subscription.created", data: { id: "s", customer: { external_id: null } } });
		const res = await handle_polar_webhook(env_with(), signed(foreign), { store });
		expect(res.status).toBe(202);
		expect(store.applied).toHaveLength(0);
	});

	test("when Polar cannot be read the delivery fails, so Polar sends it again", async () => {
		const err = await api_error(
			handle_polar_webhook(env_with(), signed(body), {
				store: memory_store(),
				api: {
					async list_subscriptions() {
						throw new ApiError(502, "billing provider unavailable");
					},
				},
			}),
		);
		expect(err.status).toBe(502);
	});

	test("the trail keeps no personal data", () => {
		const summary = event_summary("order.refunded", {
			id: "ord_1",
			subscription_id: "sub_9",
			status: "refunded",
			product_id: "prod_pro_m",
			customer: { email: "buyer@example.com" },
			billing_address: { line1: "street" },
		});
		expect(summary).toEqual({ type: "order.refunded", subscription_id: "sub_9", status: "refunded", product_id: "prod_pro_m" });
	});
});

describe("handle_checkout", () => {
	const caller = async () => ({ id: OWNER, email: "buyer@example.com" });

	beforeEach(() => reset_plans_cache());

	function checkout_req(body: unknown): Request {
		return new Request("https://backend.test/billing/checkout", { method: "POST", body: JSON.stringify(body) });
	}

	test("offers the chosen product first and the other interval second, tied to the account", async () => {
		let input: CheckoutInput | null = null;
		const res = await handle_checkout(env_with(), checkout_req({ plan: "pro", interval: "year" }), "203.0.113.7", {
			caller,
			api: {
				async list_subscriptions() {
					return [];
				},
				async create_checkout(i) {
					input = i;
					return "https://sandbox.polar.sh/checkout/xyz";
				},
				async create_portal_session() {
					throw new Error("must not be called");
				},
				async list_products() {
					return LIVE;
				},
			},
		});
		expect(await res.json()).toEqual({ url: "https://sandbox.polar.sh/checkout/xyz" });
		expect(input as CheckoutInput | null).toEqual({
			products: ["prod_pro_y", "prod_pro_m"],
			external_customer_id: OWNER,
			customer_email: "buyer@example.com",
			customer_ip_address: "203.0.113.7",
			success_url: "https://app.test/?billing=paid",
			return_url: "https://app.test/?billing=back",
		});
	});

	test("the desktop app gets Polar's own confirmation and no back link; its portal none either", async () => {
		let input: CheckoutInput | null = null;
		const portal_returns: (string | undefined)[] = [];
		let paying = false;
		const api = {
			async list_subscriptions() {
				return paying ? [sub({ status: "active" })] : [];
			},
			async create_checkout(i: CheckoutInput) {
				input = i;
				return "https://sandbox.polar.sh/checkout/xyz";
			},
			async create_portal_session(_id: string, return_url?: string) {
				portal_returns.push(return_url);
				return "https://sandbox.polar.sh/portal/abc";
			},
			async list_products() {
				return LIVE;
			},
		};
		await handle_checkout(env_with(), checkout_req({ plan: "pro", interval: "month", from: "desktop" }), "1.1.1.1", { caller, api });
		const sent = input as CheckoutInput | null;
		expect(sent?.success_url).toBeUndefined();
		expect(sent?.return_url).toBeUndefined();

		paying = true;
		await handle_checkout(env_with(), checkout_req({ plan: "max", interval: "month", from: "desktop" }), "1.1.1.1", { caller, api });
		await handle_checkout(env_with(), checkout_req({ plan: "max", interval: "month" }), "1.1.1.1", { caller, api });
		expect(portal_returns).toEqual([undefined, "https://app.test/?billing=portal"]);
	});

	test("somebody who already pays is sent to the portal", async () => {
		const res = await handle_checkout(env_with(), checkout_req({ plan: "max", interval: "month" }), "unknown", {
			caller,
			api: {
				async list_subscriptions() {
					return [sub({ status: "active" })];
				},
				async create_portal_session() {
					return "https://sandbox.polar.sh/portal/abc";
				},
				async create_checkout() {
					throw new Error("must not be called");
				},
				async list_products() {
					return LIVE;
				},
			},
		});
		expect(await res.json()).toEqual({ portal_url: "https://sandbox.polar.sh/portal/abc" });
	});

	test("only our plans and intervals, and only ones that are on sale", async () => {
		const bad = await api_error(handle_checkout(env_with(), checkout_req({ plan: "gold", interval: "month" }), "1.1.1.1", { caller }));
		expect(bad.status).toBe(400);
		const off_sale = await api_error(handle_checkout(env_with(), checkout_req({ plan: "studio", interval: "month" }), "1.1.1.1", { caller }));
		expect(off_sale.status).toBe(503);
	});

	test("a product Polar bills on another cycle is neither sold nor offered as the other interval", async () => {
		// "Pro, yearly" created with a monthly cycle: the yearly price every month
		const catalog = [product("prod_pro_m", "month", 1000), product("prod_pro_y", "month", 9600)];
		let input: CheckoutInput | null = null;
		const api = {
			async list_subscriptions() {
				return [];
			},
			async create_checkout(i: CheckoutInput) {
				input = i;
				return "https://sandbox.polar.sh/checkout/xyz";
			},
			async create_portal_session() {
				return null;
			},
			async list_products() {
				return catalog;
			},
		};
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			const yearly = await api_error(handle_checkout(env_with(), checkout_req({ plan: "pro", interval: "year" }), "1.1.1.1", { caller, api }));
			expect(yearly.status).toBe(503);
			await handle_checkout(env_with(), checkout_req({ plan: "pro", interval: "month" }), "1.1.1.1", { caller, api });
			expect((input as CheckoutInput | null)?.products).toEqual(["prod_pro_m"]);
			expect(String(logged.mock.calls[0]?.[0])).toContain("prod_pro_y");
		} finally {
			logged.mockRestore();
		}
	});

	test("503 while billing is not configured", async () => {
		const err = await api_error(handle_checkout(env_with({ access_token: null }), checkout_req({ plan: "pro", interval: "month" }), "1.1.1.1", { caller }));
		expect(err.status).toBe(503);
	});
});

describe("handle_portal", () => {
	test("the web app gets a way back to itself, the desktop app none; no body is the web", async () => {
		const returns: (string | undefined)[] = [];
		const deps = {
			caller: async () => ({ id: OWNER, email: null }),
			api: {
				async create_portal_session(_id: string, return_url?: string) {
					returns.push(return_url);
					return "https://sandbox.polar.sh/portal/abc";
				},
				async create_checkout() {
					return "";
				},
				async list_subscriptions() {
					return [];
				},
				async list_products() {
					return [];
				},
			},
		};
		const portal = (body?: unknown) =>
			handle_portal(
				env_with(),
				new Request("https://backend.test/billing/portal", {
					method: "POST",
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
				}),
				deps,
			);
		expect(await (await portal()).json()).toEqual({ url: "https://sandbox.polar.sh/portal/abc" });
		await portal({ from: "web" });
		await portal({ from: "desktop" });
		expect(returns).toEqual(["https://app.test/?billing=portal", "https://app.test/?billing=portal", undefined]);
	});

	test("404 for somebody who never bought anything", async () => {
		const err = await api_error(
			handle_portal(env_with(), new Request("https://backend.test/billing/portal", { method: "POST" }), {
				caller: async () => ({ id: OWNER, email: null }),
				api: {
					async create_portal_session() {
						return null;
					},
					async create_checkout() {
						return "";
					},
					async list_subscriptions() {
						return [];
					},
					async list_products() {
						return [];
					},
				},
			}),
		);
		expect(err.status).toBe(404);
	});
});

describe("plans", () => {
	const products: PolarProduct[] = [
		product("prod_ultra_y", "year", 34800),
		product("prod_pro_m", "month", 1000),
		product("prod_pro_y", "year", 9600, {
			prices: [{ amount_type: "fixed", price_amount: 9600, price_currency: "usd", is_archived: true }],
		}),
		product("prod_unmapped", "month", 1),
	];

	beforeEach(() => reset_plans_cache());

	test("only mapped products with a live fixed price, in plan order", () => {
		expect(plan_prices(products, PRODUCTS)).toEqual([
			{ plan: "pro", interval: "month", amount: 1000, currency: "usd" },
			{ plan: "ultra", interval: "year", amount: 34800, currency: "usd" },
		]);
	});

	test("a product billed on another cycle than its env name is not on sale", () => {
		const wrong = [
			product("prod_pro_m", "month", 1000),
			product("prod_pro_y", "month", 9600), // created with a monthly cycle
			product("prod_max_m", "month", 2400, { recurring_interval_count: 3 }), // every 3 months
			product("prod_ultra_y", null, 34800), // one-time
		];
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(plan_prices(wrong, PRODUCTS)).toEqual([{ plan: "pro", interval: "month", amount: 1000, currency: "usd" }]);
			expect(logged).toHaveBeenCalledTimes(3);
		} finally {
			logged.mockRestore();
		}
	});

	test("cached for a few minutes", async () => {
		let calls = 0;
		const api = {
			async list_products() {
				calls += 1;
				return products;
			},
			async create_checkout() {
				return "";
			},
			async create_portal_session() {
				return null;
			},
			async list_subscriptions() {
				return [];
			},
		};
		await handle_plans(env_with(), { api }, 1_000);
		await handle_plans(env_with(), { api }, 2_000);
		expect(calls).toBe(1);
		await handle_plans(env_with(), { api }, 1_000 + 11 * 60 * 1000);
		expect(calls).toBe(2);
	});
});

describe("PolarApi", () => {
	test("pins the version, sends the token, talks to the sandbox when asked", async () => {
		const seen: { url: string; init: RequestInit }[] = [];
		const api = new PolarApi(env_with().polar, async (url, init) => {
			seen.push({ url, init });
			return Response.json({ items: [sub({})] });
		});
		const subs = await api.list_subscriptions(OWNER);
		expect(subs).toHaveLength(1);
		expect(seen[0]!.url).toBe(`https://sandbox-api.polar.sh/v1/subscriptions/?external_customer_id=${OWNER}&limit=100`);
		const headers = seen[0]!.init.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer polar_oat_test");
		expect(headers["Polar-Version"]).toBe("2027-01");
	});

	test("deleting a customer that does not exist is fine; other failures are 502 without the token", async () => {
		const missing = new PolarApi(env_with().polar, async () => new Response("not found", { status: 404 }));
		await missing.delete_customer(OWNER);

		const broken = new PolarApi(env_with().polar, async () => new Response("boom", { status: 500 }));
		const err = await api_error(broken.delete_customer(OWNER));
		expect(err.status).toBe(502);
		expect(err.message).not.toContain("polar_oat_test");
	});

	test("a portal for somebody Polar does not know is null", async () => {
		const api = new PolarApi(env_with().polar, async () => new Response("{}", { status: 404 }));
		expect(await api.create_portal_session(OWNER, "https://app.test")).toBeNull();

		// what the sandbox actually answers for an external id it has never seen
		const unknown = new PolarApi(env_with().polar, async () =>
			Response.json(
				{
					error: "PolarRequestValidationError",
					detail: [{ type: "value_error", loc: ["body", "external_customer_id"], msg: "Customer does not exist.", input: OWNER }],
				},
				{ status: 422 },
			),
		);
		expect(await unknown.create_portal_session(OWNER, "https://app.test")).toBeNull();
	});

	test("any other 422 on the portal is still a provider error", async () => {
		const api = new PolarApi(env_with().polar, async () =>
			Response.json({ detail: [{ type: "missing", loc: ["body", "return_url"], msg: "Field required" }] }, { status: 422 }),
		);
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			expect((await api_error(api.create_portal_session(OWNER, "https://app.test"))).status).toBe(502);
		} finally {
			logged.mockRestore();
		}
	});

	test("production by default", async () => {
		let url = "";
		const api = new PolarApi(env_with({ server: "production" }).polar, async (u) => {
			url = u;
			return Response.json({ items: [] });
		});
		await api.list_products();
		expect(url.startsWith("https://api.polar.sh/v1/products/")).toBe(true);
	});
});
