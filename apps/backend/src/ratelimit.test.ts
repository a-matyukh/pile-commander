import { describe, expect, test } from "bun:test";
import { RateLimiter, client_ip, enforce_rate_limits, is_ip_like, unverified_subject } from "./ratelimit";

function clock(start = 1_000_000) {
	let now = start;
	return {
		now: () => now,
		advance(ms: number) {
			now += ms;
		},
	};
}

describe("RateLimiter", () => {
	test("allows up to the limit inside the window, then refuses with a retry hint", () => {
		const c = clock();
		const limiter = new RateLimiter(c.now);
		const rule = { limit: 3, window_ms: 10_000 };
		expect(limiter.check("k", rule)).toEqual({ allowed: true });
		c.advance(1000);
		expect(limiter.check("k", rule)).toEqual({ allowed: true });
		c.advance(1000);
		expect(limiter.check("k", rule)).toEqual({ allowed: true });
		const refused = limiter.check("k", rule);
		expect(refused.allowed).toBe(false);
		// the oldest hit is 2 s old → the window frees up in 8 s
		if (!refused.allowed) expect(refused.retry_after_s).toBe(8);
	});

	test("a refused request does not consume budget; hits expire as the window slides", () => {
		const c = clock();
		const limiter = new RateLimiter(c.now);
		const rule = { limit: 2, window_ms: 10_000 };
		limiter.check("k", rule);
		c.advance(5000);
		limiter.check("k", rule);
		expect(limiter.check("k", rule).allowed).toBe(false);
		expect(limiter.check("k", rule).allowed).toBe(false);
		c.advance(5001); // first hit falls out
		expect(limiter.check("k", rule).allowed).toBe(true);
		expect(limiter.check("k", rule).allowed).toBe(false);
	});

	test("keys are independent", () => {
		const limiter = new RateLimiter(clock().now);
		const rule = { limit: 1, window_ms: 1000 };
		expect(limiter.check("a", rule).allowed).toBe(true);
		expect(limiter.check("b", rule).allowed).toBe(true);
		expect(limiter.check("a", rule).allowed).toBe(false);
	});
});

describe("client_ip / unverified_subject", () => {
	test("reads the hop the trusted proxy appended, not the one the client sent", () => {
		// the client forged "1.2.3.4"; Render appended the address it saw
		const forged = new Request("http://x/", { headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.9" } });
		expect(client_ip(forged, "10.0.0.1")).toBe("203.0.113.9");
		// no forgery: the single entry is the real client
		const plain = new Request("http://x/", { headers: { "x-forwarded-for": "203.0.113.9" } });
		expect(client_ip(plain, "10.0.0.1")).toBe("203.0.113.9");
		expect(client_ip(new Request("http://x/"), "9.9.9.9")).toBe("9.9.9.9");
		expect(client_ip(new Request("http://x/"), null)).toBe("unknown");
	});

	test("a long forged chain cannot widen the bucket", () => {
		const bucket_of = (forged: string) =>
			client_ip(
				new Request("http://x/", { headers: { "x-forwarded-for": `${forged}, 203.0.113.9` } }),
				"10.0.0.1",
			);
		// every attempt lands in the same bucket: the appended hop
		expect(bucket_of("1.1.1.1, 2.2.2.2, 3.3.3.3")).toBe("203.0.113.9");
		expect(bucket_of("9.9.9.9")).toBe("203.0.113.9");
	});

	test("falls back to the socket when the header is shorter than the proxy depth", () => {
		const req = new Request("http://x/", { headers: { "x-forwarded-for": "203.0.113.9" } });
		expect(client_ip(req, "10.0.0.1", 2)).toBe("10.0.0.1");
		const two = new Request("http://x/", { headers: { "x-forwarded-for": "1.2.3.4, 198.51.100.7, 203.0.113.9" } });
		expect(client_ip(two, "10.0.0.1", 2)).toBe("198.51.100.7");
	});

	test("a hop that is not an address never becomes a bucket key", () => {
		const junk = new Request("http://x/", { headers: { "x-forwarded-for": "1.2.3.4, not-an-ip" } });
		expect(client_ip(junk, "10.0.0.1")).toBe("10.0.0.1");
		const empty = new Request("http://x/", { headers: { "x-forwarded-for": " , " } });
		expect(client_ip(empty, "10.0.0.1")).toBe("10.0.0.1");
	});

	test("is_ip_like accepts v4/v6 shapes and rejects text", () => {
		expect(is_ip_like("203.0.113.9")).toBe(true);
		expect(is_ip_like("2001:db8::1")).toBe(true);
		expect(is_ip_like("::ffff:1.2.3.4")).toBe(true);
		expect(is_ip_like("[2001:db8::1]")).toBe(true);
		expect(is_ip_like("fe80::1%eth0")).toBe(true);
		expect(is_ip_like("999.1.1.1")).toBe(false);
		expect(is_ip_like("evil.example.com")).toBe(false);
		expect(is_ip_like("")).toBe(false);
	});

	test("decodes the sub claim without verifying, tolerates garbage", () => {
		const payload = Buffer.from(JSON.stringify({ sub: "user-1", role: "authenticated" })).toString("base64url");
		const req = new Request("http://x/", { headers: { Authorization: `Bearer aaa.${payload}.sig` } });
		expect(unverified_subject(req)).toBe("user-1");
		expect(unverified_subject(new Request("http://x/", { headers: { Authorization: "Bearer nope" } }))).toBeNull();
		expect(unverified_subject(new Request("http://x/"))).toBeNull();
	});
});

describe("enforce_rate_limits", () => {
	test("route buckets: per-user budget on account delete", () => {
		const limiter = new RateLimiter(clock().now);
		const payload = Buffer.from(JSON.stringify({ sub: "u1" })).toString("base64url");
		const req = new Request("http://x/account/delete", {
			method: "POST",
			headers: { Authorization: `Bearer a.${payload}.b`, "x-forwarded-for": "5.5.5.5" },
		});
		expect(enforce_rate_limits(limiter, req, "POST /account/delete", "5.5.5.5")).toBeNull();
		expect(enforce_rate_limits(limiter, req, "POST /account/delete", "5.5.5.5")).toBeNull();
		expect(enforce_rate_limits(limiter, req, "POST /account/delete", "5.5.5.5")).toBeNull();
		expect(enforce_rate_limits(limiter, req, "POST /account/delete", "5.5.5.5")).toBeGreaterThan(0);
		// an unrelated route from the same client is still fine
		expect(enforce_rate_limits(limiter, req, "GET /", "5.5.5.5")).toBeNull();
	});

	test("route buckets: per-user budget on workspace invite", () => {
		const limiter = new RateLimiter(clock().now);
		const payload = Buffer.from(JSON.stringify({ sub: "u1" })).toString("base64url");
		const req = new Request("http://x/workspace/invite", {
			method: "POST",
			headers: { Authorization: `Bearer a.${payload}.b`, "x-forwarded-for": "5.5.5.5" },
		});
		for (let i = 0; i < 10; i += 1) {
			expect(enforce_rate_limits(limiter, req, "POST /workspace/invite", "5.5.5.5")).toBeNull();
		}
		expect(enforce_rate_limits(limiter, req, "POST /workspace/invite", "5.5.5.5")).toBeGreaterThan(0);
	});

	test("unknown routes only pay the global IP fence", () => {
		const limiter = new RateLimiter(clock().now);
		const req = new Request("http://x/", { headers: { "x-forwarded-for": "7.7.7.7" } });
		for (let i = 0; i < 1000; i += 1) expect(enforce_rate_limits(limiter, req, "GET /", "5.5.5.5")).toBeNull();
		expect(enforce_rate_limits(limiter, req, "GET /", "5.5.5.5")).toBeGreaterThan(0);
	});
});
