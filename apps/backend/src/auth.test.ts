import { describe, expect, test } from "bun:test";
import { ApiError, require_live_user, require_user } from "./auth";
import type { SupabaseClient } from "@supabase/supabase-js";

function client_with_claims(
	result: Promise<{ data: { claims: { sub?: string } } | null; error: { message: string } | null }>,
): SupabaseClient {
	return {
		auth: {
			getClaims: () => result,
		},
	} as unknown as SupabaseClient;
}

describe("require_user", () => {
	test("rejects a missing bearer token", async () => {
		const client = client_with_claims(Promise.resolve({ data: null, error: null }));
		await expect(require_user(client, null)).rejects.toMatchObject({
			status: 401,
			message: "missing bearer token",
		});
	});

	test("accepts a JWT whose claims verify locally", async () => {
		const client = client_with_claims(
			Promise.resolve({ data: { claims: { sub: "user-1" } }, error: null }),
		);
		await expect(require_user(client, "token")).resolves.toMatchObject({ id: "user-1" });
	});

	test("maps a failed JWKS verification to the same 401 as a bad JWT", async () => {
		const client = client_with_claims(
			Promise.resolve({ data: null, error: { message: "Session not found" } }),
		);
		try {
			await require_user(client, "stale-but-unexpired");
			throw new Error("expected ApiError");
		} catch (err) {
			expect(err).toBeInstanceOf(ApiError);
			expect(err as ApiError).toMatchObject({ status: 401, message: "invalid or expired token" });
		}
	});

	test("maps a thrown verifier error to 401 without leaking internals", async () => {
		const client = client_with_claims(Promise.reject(new Error("WebCrypto unavailable")));
		try {
			await require_user(client, "token");
			throw new Error("expected ApiError");
		} catch (err) {
			expect(err).toBeInstanceOf(ApiError);
			expect(err as ApiError).toMatchObject({ status: 401, message: "invalid or expired token" });
		}
	});
});

describe("require_live_user", () => {
	type UserAnswer = { data: { user: { id: string; email?: string } | null }; error: { message: string; status?: number } | null };

	function client_with(answer: () => Promise<UserAnswer>, calls = { get_user: 0 }): SupabaseClient {
		return {
			auth: {
				getClaims: async () => ({ data: { claims: { sub: "user-1" } }, error: null }),
				getUser: (token: string) => {
					calls.get_user += 1;
					expect(token).toBe("token");
					return answer();
				},
			},
		} as unknown as SupabaseClient;
	}

	test("a token whose session still exists is the user, with the address", async () => {
		const client = client_with(async () => ({ data: { user: { id: "user-1", email: "ann@example.com" } }, error: null }));
		await expect(require_live_user(client, "token")).resolves.toMatchObject({ id: "user-1", email: "ann@example.com" });
	});

	test("a valid token whose session was signed out is refused", async () => {
		const client = client_with(async () => ({
			data: { user: null },
			error: { message: "Session from session_id claim in JWT does not exist", status: 403 },
		}));
		await expect(require_live_user(client, "token")).rejects.toMatchObject({
			status: 401,
			message: "invalid or expired token",
		});
	});

	test("when Auth does not answer the route is refused, not waved through", async () => {
		const down = client_with(async () => ({ data: { user: null }, error: { message: "fetch failed", status: 0 } }));
		await expect(require_live_user(down, "token")).rejects.toMatchObject({ status: 503 });
		const broken = client_with(async () => ({ data: { user: null }, error: { message: "bad gateway", status: 502 } }));
		await expect(require_live_user(broken, "token")).rejects.toMatchObject({ status: 503 });
		const thrown = client_with(() => Promise.reject(new Error("socket closed")));
		await expect(require_live_user(thrown, "token")).rejects.toMatchObject({ status: 503 });
	});

	test("a token that fails the local check never reaches Auth", async () => {
		const calls = { get_user: 0 };
		const client = {
			auth: {
				getClaims: async () => ({ data: null, error: { message: "invalid signature" } }),
				getUser: async () => {
					calls.get_user += 1;
					return { data: { user: { id: "user-1" } }, error: null };
				},
			},
		} as unknown as SupabaseClient;
		await expect(require_live_user(client, "forged")).rejects.toMatchObject({ status: 401 });
		await expect(require_live_user(client, null)).rejects.toMatchObject({ status: 401 });
		expect(calls.get_user).toBe(0);
	});
});
