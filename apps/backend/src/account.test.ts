import { describe, expect, test } from "bun:test";
import { assert_recent_authentication, newest_auth_timestamp } from "./account";

function token_with(claims: Record<string, unknown>): string {
	return `hdr.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
}

describe("newest_auth_timestamp", () => {
	test("picks the newest amr timestamp", () => {
		const token = token_with({
			sub: "u",
			amr: [
				{ method: "password", timestamp: 1000 },
				{ method: "otp", timestamp: 2000 },
			],
		});
		expect(newest_auth_timestamp(token)).toBe(2000);
	});

	test("null without amr or on garbage", () => {
		expect(newest_auth_timestamp(token_with({ sub: "u" }))).toBeNull();
		expect(newest_auth_timestamp("not-a-jwt")).toBeNull();
		expect(newest_auth_timestamp("a.!!!.c")).toBeNull();
	});
});

describe("assert_recent_authentication", () => {
	test("accepts a fresh sign-in, refuses a stale or missing one", () => {
		const fresh = token_with({ amr: [{ method: "password", timestamp: 10_000 }] });
		expect(() => assert_recent_authentication(fresh, 600, 10_300)).not.toThrow();
		expect(() => assert_recent_authentication(fresh, 600, 10_601)).toThrow("reauth_required");
		expect(() => assert_recent_authentication(token_with({}), 600, 10_000)).toThrow("reauth_required");
	});
});
