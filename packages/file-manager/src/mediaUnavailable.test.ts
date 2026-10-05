import { describe, expect, test } from "bun:test"
import { MediaUnavailableError, parse_media_unavailable } from "./mediaUnavailable"

describe("parse_media_unavailable", () => {
	test("reads the backend refusal", () => {
		expect(parse_media_unavailable({ error: "media_unavailable", reason: "public_file_size" })).toBe("public_file_size")
		expect(parse_media_unavailable({ error: "media_unavailable", reason: "visitor_share" })).toBe("visitor_share")
		expect(parse_media_unavailable({ error: "media_unavailable", reason: "egress_budget" })).toBe("egress_budget")
		expect(parse_media_unavailable({ error: "media_unavailable", reason: "download_budget" })).toBe("download_budget")
	})

	test("anything else is not a refusal", () => {
		expect(parse_media_unavailable(null)).toBeNull()
		expect(parse_media_unavailable("media_unavailable")).toBeNull()
		expect(parse_media_unavailable({ error: "blob not found" })).toBeNull()
		expect(parse_media_unavailable({ error: "download_not_allowed" })).toBeNull()
		expect(parse_media_unavailable({ error: "media_unavailable", reason: "later" })).toBeNull()
		expect(parse_media_unavailable([{ error: "media_unavailable", reason: "egress_budget" }])).toBeNull()
	})
})

describe("MediaUnavailableError", () => {
	test("carries the reason and a readable message", () => {
		const error = new MediaUnavailableError("public_file_size")
		expect(error).toBeInstanceOf(Error)
		expect(error.name).toBe("MediaUnavailableError")
		expect(error.reason).toBe("public_file_size")
		expect(error.message).toBe("This file is too large to open on a public board")
		expect(new MediaUnavailableError("egress_budget").message).toBe("This media is temporarily unavailable")
		expect(new MediaUnavailableError("download_budget").message).toBe("You have used this month's download allowance")
	})
})
