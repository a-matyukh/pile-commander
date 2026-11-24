import { describe, expect, test } from "bun:test"
import { is_reserved_slug, is_valid_slug, RESERVED_SLUGS } from "./reserved-slugs"

/** Every quoted word between `start` and `end` in a source file. */
async function words_between(path: string, start: string, end: string): Promise<string[]> {
	const source = await Bun.file(new URL(path, import.meta.url)).text()
	const from = source.indexOf(start)
	const to = source.indexOf(end, from + start.length)
	expect(from).toBeGreaterThanOrEqual(0)
	expect(to).toBeGreaterThan(from)
	return [...source.slice(from + start.length, to).matchAll(/['"]([a-z0-9-]+)['"]/g)].map(match => match[1]!)
}

describe("is_reserved_slug", () => {
	test("app routes are reserved", () => {
		for (const slug of ["app", "login", "api", "settings", "p", "invite"]) {
			expect(is_reserved_slug(slug)).toBe(true)
		}
	})

	test("regular words are not reserved", () => {
		expect(is_reserved_slug("my-blog")).toBe(false)
	})

	test("names that would pass for the product or its staff are reserved", () => {
		for (const slug of ["pile-commander", "pilecommander", "official", "team", "support", "security", "billing", "moderator"]) {
			expect(is_reserved_slug(slug)).toBe(true)
		}
		expect(is_reserved_slug("teamwork")).toBe(false)
		expect(is_reserved_slug("pile-of-books")).toBe(false)
	})

	// The database is what refuses a direct update, and the edge middleware
	// decides which root addresses are profiles: three copies of one list
	test("the database and the middleware keep the same list", async () => {
		const sql = await words_between("./schema.sql", "select p_username = any (array[", "]);")
		expect([...sql].sort()).toEqual([...RESERVED_SLUGS].sort())
		const middleware = await words_between("../../../apps/client/middleware.ts", "const RESERVED = new Set([", "])")
		expect([...middleware].sort()).toEqual([...RESERVED_SLUGS].sort())
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
