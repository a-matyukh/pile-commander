import { describe, expect, test } from "bun:test"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
	HUB_PREVIEW_MAX_BYTES,
	hub_preview_ext,
	hub_preview_file_error,
	hub_preview_url,
	is_hub_preview_key,
	upload_hub_preview,
} from "./hubPreview"
import { StorageUnreachableError } from "./storageUnreachable"

const WS = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
const FILE = "ffffffff-0000-4111-8222-333333333333"

describe("is_hub_preview_key", () => {
	test("accepts hub/<workspace>/<uuid>.ext", () => {
		expect(is_hub_preview_key(`hub/${WS}/${FILE}.jpg`)).toBe(true)
		expect(is_hub_preview_key(`hub/${WS}/${FILE}.jpeg`)).toBe(true)
		expect(is_hub_preview_key(`hub/${WS}/${FILE}.png`)).toBe(true)
		expect(is_hub_preview_key(`hub/${WS}/${FILE}.webp`)).toBe(true)
	})

	test("rejects workspace media keys and other prefixes", () => {
		expect(is_hub_preview_key(`${WS}/${FILE}.png`)).toBe(false)
		expect(is_hub_preview_key(`hub/${WS}/${FILE}.gif`)).toBe(false)
		expect(is_hub_preview_key(`hub/${WS}/preview.png`)).toBe(false)
	})
})

describe("hub_preview_file_error", () => {
	test("allows jpeg/png/webp under 2 MB", () => {
		expect(hub_preview_file_error({ name: "cover.jpg", type: "image/jpeg", size: 100 })).toBeNull()
		expect(hub_preview_file_error({ name: "cover.PNG", type: "", size: 100 })).toBeNull()
		expect(hub_preview_file_error({ name: "cover.webp", type: "image/webp", size: HUB_PREVIEW_MAX_BYTES })).toBeNull()
	})

	test("rejects oversize and unsupported types", () => {
		expect(hub_preview_file_error({ name: "cover.jpg", type: "image/jpeg", size: HUB_PREVIEW_MAX_BYTES + 1 }))
			.toBe("file is too large (max 2 MB)")
		expect(hub_preview_file_error({ name: "cover.gif", type: "image/gif", size: 100 }))
			.toBe("JPEG, PNG or WebP only")
	})
})

describe("hub_preview_ext", () => {
	test("prefers mime then falls back to the filename", () => {
		expect(hub_preview_ext("x.bin", "image/png")).toBe(".png")
		expect(hub_preview_ext("shot.JPEG", "")).toBe(".jpg")
		expect(hub_preview_ext("shot.gif", "")).toBeNull()
	})
})

describe("hub_preview_url", () => {
	test("builds a stable backend URL and strips a trailing slash", () => {
		expect(hub_preview_url("http://localhost:3000/", `hub/${WS}/${FILE}.jpg`)).toBe(
			`http://localhost:3000/hub-preview?key=${encodeURIComponent(`hub/${WS}/${FILE}.jpg`)}`,
		)
	})
})

describe("upload_hub_preview put_blob", () => {
	test("the staged bytes go through the injected put, not the webview", async () => {
		const client = {
			auth: { getSession: async () => ({ data: { session: { access_token: "token" } } }) },
		} as unknown as SupabaseClient
		const staging = `uploads/hub/${WS}/${FILE}.png`
		const final_key = `hub/${WS}/${FILE}.png`
		const fetched: string[] = []
		const original = globalThis.fetch
		globalThis.fetch = (async (input: string | URL | Request) => {
			const path = String(input)
			fetched.push(path)
			if (path.endsWith("/presign/hub-preview-upload")) {
				return new Response(JSON.stringify({ storage_key: staging, url: "https://b2.example/put" }))
			}
			if (path.endsWith("/hub-preview/finalize")) {
				return new Response(JSON.stringify({ storage_key: final_key }))
			}
			throw new Error(`unexpected fetch ${path}`)
		}) as typeof fetch
		const puts: { url: string; type: string; size: number }[] = []
		try {
			const key = await upload_hub_preview(
				client,
				"https://backend.example",
				WS,
				new Blob([Uint8Array.from([1, 2, 3])], { type: "image/png" }),
				"cover.png",
				async (url, content_type, data) => {
					puts.push({ url, type: content_type, size: data.size })
				},
			)
			expect(key).toBe(final_key)
			expect(puts).toEqual([{ url: "https://b2.example/put", type: "image/png", size: 3 }])
			expect(fetched).toEqual([
				"https://backend.example/presign/hub-preview-upload",
				"https://backend.example/hub-preview/finalize",
			])
		} finally {
			globalThis.fetch = original
		}
	})

	test("a PUT that never gets a response reads as unreachable storage", async () => {
		const client = {
			auth: { getSession: async () => ({ data: { session: null } }) },
		} as unknown as SupabaseClient
		const original = globalThis.fetch
		globalThis.fetch = (async (input: string | URL | Request) => {
			if (String(input).endsWith("/presign/hub-preview-upload")) {
				return new Response(JSON.stringify({ storage_key: "k", url: "https://b2.example/put" }))
			}
			throw new TypeError("Load failed")
		}) as typeof fetch
		try {
			await expect(upload_hub_preview(
				client,
				"https://backend.example",
				WS,
				new Blob([Uint8Array.from([1])], { type: "image/png" }),
				"cover.png",
			)).rejects.toBeInstanceOf(StorageUnreachableError)
		} finally {
			globalThis.fetch = original
		}
	})
})
