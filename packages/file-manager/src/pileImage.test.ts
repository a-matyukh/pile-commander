import { describe, expect, test } from "bun:test"
import { is_pile_image_file, is_pile_image_token, parse_pile_image_token, pile_image_file_role, pile_image_hash8, pile_image_token } from "./pileImage"

describe("pile image token", () => {
	test("a different payload keeps the webp extension and changes the hash", async () => {
		const first = await pile_image_hash8(new Uint8Array([1, 2, 3]))
		const second = await pile_image_hash8(new Uint8Array([1, 2, 4]))
		expect(first).toMatch(/^[0-9a-f]{8}$/)
		expect(first).not.toBe(second)
		expect(pile_image_token("cover", first)).toBe(`pile:cover-${first}.webp`)
		expect(pile_image_token("background", second)).toBe(`pile:background-${second}.webp`)
		expect(parse_pile_image_token(`pile:cover-${first}.webp`)).toEqual({
			role: "cover",
			hash8: first,
			file: `cover-${first}.webp`,
		})
	})

	test("rejects a path, a color, and a hash that is not the stored form", () => {
		expect(is_pile_image_token("pile:../x")).toBe(false)
		expect(is_pile_image_token("#fff")).toBe(false)
		expect(is_pile_image_token("cover.png")).toBe(false)
		expect(is_pile_image_token("pile:cover-ABCDEF01.webp")).toBe(false)
		expect(is_pile_image_token("pile:cover-abcd.png")).toBe(false)
		expect(parse_pile_image_token("pile:cover-zzzzzzzz.webp")).toBeNull()
		expect(is_pile_image_file("cover-abcdef01.webp")).toBe(true)
		expect(is_pile_image_file("strokes.json")).toBe(false)
		expect(is_pile_image_file("cover-ABCDEF01.webp")).toBe(false)
		expect(pile_image_file_role("background-abcdef01.webp")).toBe("background")
		expect(pile_image_file_role("strokes.json")).toBeNull()
	})
})
