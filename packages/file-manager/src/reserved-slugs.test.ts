import { describe, expect, test } from "bun:test"
import { is_reserved_slug, is_valid_slug, RESERVED_SLUGS } from "./reserved-slugs"

describe("is_reserved_slug", () => {
	test("app routes are reserved", () => {
		for (const slug of ["app", "login", "api", "settings", "p", "invite"]) {
			expect(is_reserved_slug(slug)).toBe(true)
		}
	})

	test("regular words are not reserved", () => {
		expect(is_reserved_slug("my-blog")).toBe(false)
	})
})

describe("is_valid_slug", () => {
	test("accepts lowercase alphanumeric with dashes", () => {
		expect(is_valid_slug("my-blog")).toBe(true)
		expect(is_valid_slug("notes-2026")).toBe(true)
	})

	test("rejects reserved words", () => {
		expect(is_valid_slug("login")).toBe(false)
	})

	test("rejects invalid characters and shapes", () => {
		expect(is_valid_slug("My Blog")).toBe(false)
		expect(is_valid_slug("-lead")).toBe(false)
		expect(is_valid_slug("ab")).toBe(false)
		expect(is_valid_slug("")).toBe(false)
	})

	test("reserved list has no duplicates and all entries are well-formed", () => {
		expect(new Set(RESERVED_SLUGS).size).toBe(RESERVED_SLUGS.length)
		for (const slug of RESERVED_SLUGS) {
			expect(slug).toMatch(/^[a-z0-9][a-z0-9-]*$/)
		}
	})
})
