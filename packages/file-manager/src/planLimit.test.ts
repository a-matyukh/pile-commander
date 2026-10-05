import { describe, expect, test } from "bun:test"
import { parse_plan_limit_error, PlanLimitError } from "./planLimit"

describe("parse_plan_limit_error", () => {
	test("reads a Postgres quota_exceeded message and JSON details", () => {
		const info = parse_plan_limit_error({
			message: "quota_exceeded: used 104857600 of 104857600 bytes, need 12 more",
			details: JSON.stringify({
				kind: "quota",
				used_bytes: 104857600,
				quota_bytes: 104857600,
				needed_bytes: 12,
			}),
		})
		expect(info).toEqual({
			kind: "quota",
			used_bytes: 104857600,
			quota_bytes: 104857600,
			file_bytes: null,
			needed_bytes: 12,
			max_file_bytes: null,
			file_mime: null,
		})
	})

	test("reads file_too_large from a backend 413 body", () => {
		const info = parse_plan_limit_error({
			error: "file_too_large: 27262976 exceeds limit 26214400",
			kind: "file_size",
			file_bytes: 27262976,
			max_file_bytes: 26214400,
			file_mime: "video/mp4",
		})
		expect(info?.kind).toBe("file_size")
		expect(info?.file_bytes).toBe(27262976)
		expect(info?.max_file_bytes).toBe(26214400)
		expect(info?.file_mime).toBe("video/mp4")
	})

	test("reads file_mime from a mime alias on the 413 body", () => {
		const info = parse_plan_limit_error({
			error: "file_too_large: 27262976 exceeds limit 26214400",
			kind: "file_size",
			file_bytes: 27262976,
			mime: "image/png",
		})
		expect(info?.file_mime).toBe("image/png")
	})

	test("reads hub_listing_limit from a thrown Error", () => {
		const info = parse_plan_limit_error(
			new Error("set_hub_listing failed: hub_listing_limit: 3 of 3 Hub listings"),
		)
		expect(info?.kind).toBe("hub_limit")
		expect(info?.file_mime).toBeNull()
	})

	test("returns null for unrelated errors", () => {
		expect(parse_plan_limit_error(new Error("copy_entry: access denied"))).toBeNull()
		expect(parse_plan_limit_error("nope")).toBeNull()
	})

	test("unwraps PlanLimitError", () => {
		const err = new PlanLimitError({
			kind: "quota",
			used_bytes: 1,
			quota_bytes: 2,
			file_bytes: null,
			needed_bytes: 3,
			max_file_bytes: null,
			file_mime: "text/markdown",
		})
		expect(parse_plan_limit_error(err)?.needed_bytes).toBe(3)
		expect(parse_plan_limit_error(err)?.file_mime).toBe("text/markdown")
	})
})
