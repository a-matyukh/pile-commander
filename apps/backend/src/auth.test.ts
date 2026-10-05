import { describe, expect, test } from "bun:test";
import { ApiError, require_user } from "./auth";
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
