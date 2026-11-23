import { describe, expect, test } from "bun:test";
import { honeypot_filled, normalize_email } from "./emails";

describe("normalize_email", () => {
	test("trims, lowercases, and accepts a simple address", () => {
		expect(normalize_email("  Ada@Example.COM ")).toBe("ada@example.com");
	});

	test("refuses missing, empty, overlong, or malformed values", () => {
		expect(normalize_email(null)).toBeNull();
		expect(normalize_email("")).toBeNull();
		expect(normalize_email("not-an-email")).toBeNull();
		expect(normalize_email("a@b")).toBeNull();
		expect(normalize_email(`${"a".repeat(250)}@x.co`)).toBeNull();
	});
});

describe("honeypot_filled", () => {
	test("treats only a non-empty string as filled", () => {
		expect(honeypot_filled("http://spam")).toBe(true);
		expect(honeypot_filled("  ")).toBe(false);
		expect(honeypot_filled("")).toBe(false);
		expect(honeypot_filled(undefined)).toBe(false);
	});
});
