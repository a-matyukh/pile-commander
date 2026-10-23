import { describe, expect, test } from "bun:test"
import { resolve_connection_endpoint, resolve_folder_connection, resolve_folder_connections } from "./connectionPaths"

describe("resolve_connection_endpoint", () => {
	test("keeps endpoints already under the folder", () => {
		expect(resolve_connection_endpoint(
			"/Users/amatyukh/Desktop/test/a.txt",
			"/Users/amatyukh/Desktop/test",
		)).toBe("/Users/amatyukh/Desktop/test/a.txt")
	})

	test("joins relative endpoints onto the folder", () => {
		expect(resolve_connection_endpoint("a.txt", "/Users/amatyukh/Desktop/test"))
			.toBe("/Users/amatyukh/Desktop/test/a.txt")
		expect(resolve_connection_endpoint("sub/b.txt", "/Users/amatyukh/Desktop/test"))
			.toBe("/Users/amatyukh/Desktop/test/sub/b.txt")
	})

	test("rebases a stale absolute path after the folder moved into a name with spaces", () => {
		expect(resolve_connection_endpoint(
			"/Users/amatyukh/Desktop/test/a.txt",
			"/Users/amatyukh/Desktop/My desktop/test",
		)).toBe("/Users/amatyukh/Desktop/My desktop/test/a.txt")
	})

	test("keeps nested same-name segments after the first folder marker", () => {
		expect(resolve_connection_endpoint(
			"/Users/amatyukh/Desktop/test/test/a.txt",
			"/Users/amatyukh/Desktop/My desktop/test",
		)).toBe("/Users/amatyukh/Desktop/My desktop/test/test/a.txt")
	})

	test("rebases an NFC folder prefix onto the NFD folder id", () => {
		const nfc = "Конвейер".normalize("NFC")
		const nfd = "Конвейер".normalize("NFD")
		const folder = `/Users/amatyukh/Desktop/${nfd}`
		expect(resolve_connection_endpoint(
			`/Users/amatyukh/Desktop/${nfc}/Питч`,
			folder,
		)).toBe(`${folder}/Питч`)
	})

	test("keeps an NFD filename when only the folder prefix differed", () => {
		const nfc = "Конвейер".normalize("NFC")
		const nfd = "Конвейер".normalize("NFD")
		const folder = `/Users/amatyukh/Desktop/${nfd}`
		const file = `Па${"й".normalize("NFD")}.md`
		const resolved = resolve_connection_endpoint(
			`/Users/amatyukh/Desktop/${nfc}/${file}`,
			folder,
		)
		expect(resolved).toBe(`${folder}/${file}`)
		expect(resolved.endsWith(file.normalize("NFC"))).toBe(false)
	})
})

describe("resolve_folder_connection", () => {
	test("remints a deterministic id when endpoints move", () => {
		const stale = {
			id: "/Users/amatyukh/Desktop/test/a.txt:default-/Users/amatyukh/Desktop/test/b.txt:default",
			from: "/Users/amatyukh/Desktop/test/a.txt",
			to: "/Users/amatyukh/Desktop/test/b.txt",
			is_animated: false,
		}
		expect(resolve_folder_connection(stale, "/Users/amatyukh/Desktop/My desktop/test")).toEqual({
			id: "/Users/amatyukh/Desktop/My desktop/test/a.txt:default-/Users/amatyukh/Desktop/My desktop/test/b.txt:default",
			from: "/Users/amatyukh/Desktop/My desktop/test/a.txt",
			to: "/Users/amatyukh/Desktop/My desktop/test/b.txt",
			is_animated: false,
		})
	})

	test("remints a deterministic id when only the folder's Unicode form changed", () => {
		const nfc = "Конвейер".normalize("NFC")
		const nfd = "Конвейер".normalize("NFD")
		const folder = `/Users/amatyukh/Desktop/${nfd}`
		const from = `/Users/amatyukh/Desktop/${nfc}/Питч`
		const to = `/Users/amatyukh/Desktop/${nfc}/Note 4.md`
		expect(resolve_folder_connection({
			id: `${from}:right-${to}:left`,
			from,
			to,
			from_handle: "right",
			to_handle: "left",
			is_animated: true,
		}, folder)).toEqual({
			id: `${folder}/Питч:right-${folder}/Note 4.md:left`,
			from: `${folder}/Питч`,
			to: `${folder}/Note 4.md`,
			from_handle: "right",
			to_handle: "left",
			is_animated: true,
		})
	})

	test("keeps uuid-fallback ids", () => {
		const stale = {
			id: "uuid-fallback",
			from: "/Users/amatyukh/Desktop/test/a.txt",
			to: "/Users/amatyukh/Desktop/test/b.txt",
			is_animated: true,
		}
		expect(resolve_folder_connection(stale, "/Users/amatyukh/Desktop/My desktop/test")).toEqual({
			id: "uuid-fallback",
			from: "/Users/amatyukh/Desktop/My desktop/test/a.txt",
			to: "/Users/amatyukh/Desktop/My desktop/test/b.txt",
			is_animated: true,
		})
	})
})

describe("resolve_folder_connections", () => {
	test("returns the same array when nothing is stale", () => {
		const current = [{
			id: "c1",
			from: "/ws/docs/a.txt",
			to: "/ws/docs/b.txt",
			is_animated: false,
		}]
		expect(resolve_folder_connections(current, "/ws/docs")).toBe(current)
	})
})
