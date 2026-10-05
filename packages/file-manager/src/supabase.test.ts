import { describe, expect, test } from "bun:test"
import type { SupabaseClient } from "@supabase/supabase-js"
import createCloudFileManager, {
	decode_text_content,
	first_embed,
	inert_document_mime,
	is_text_mime,
	mime_from_name,
	retry_after_ms,
} from "./supabase"

describe("inert_document_mime", () => {
	test("active document types open as plain text", () => {
		expect(inert_document_mime("text/html")).toBe("text/plain")
		expect(inert_document_mime("text/html; charset=utf-8")).toBe("text/plain")
		expect(inert_document_mime("image/svg+xml")).toBe("text/plain")
		expect(inert_document_mime("application/xhtml+xml")).toBe("text/plain")
		expect(inert_document_mime("text/javascript")).toBe("text/plain")
	})

	test("inert types keep their mime", () => {
		expect(inert_document_mime("text/markdown")).toBe("text/markdown")
		expect(inert_document_mime("application/json")).toBe("application/json")
		expect(inert_document_mime("text/csv")).toBe("text/csv")
		expect(inert_document_mime(null)).toBe("text/plain")
	})
})

describe("decode_text_content", () => {
	test("decodes plain UTF-8 text", () => {
		expect(decode_text_content(new TextEncoder().encode("hello\nworld"))).toBe("hello\nworld")
	})

	test("decodes multi-byte UTF-8", () => {
		const text = "привет, мир — ünïcödé"
		expect(decode_text_content(new TextEncoder().encode(text))).toBe(text)
	})

	test("rejects payloads with NUL bytes (Postgres text cannot store them)", () => {
		expect(decode_text_content(new Uint8Array([0x50, 0x4b, 0x00, 0x00]))).toBeNull()
	})

	test("rejects invalid UTF-8 instead of lossy replacement chars", () => {
		expect(decode_text_content(new Uint8Array([0xff, 0xfe, 0xfd]))).toBeNull()
	})

	test("accepts empty content", () => {
		expect(decode_text_content(new Uint8Array([]))).toBe("")
	})
})

describe("first_embed", () => {
	test("unwraps a 1:1 object and a 1:n array", () => {
		const listing = { description: "hi", preview_key: "hub/a/b.jpg" }
		expect(first_embed(listing)).toEqual(listing)
		expect(first_embed([listing])).toEqual(listing)
		expect(first_embed([])).toBeNull()
		expect(first_embed(null)).toBeNull()
	})
})

describe("text/binary routing", () => {
	test("unknown extensions default to text/plain", () => {
		expect(mime_from_name("archive.xyz123")).toBe("text/plain")
		expect(mime_from_name("no_extension")).toBe("text/plain")
	})

	test("text/plain is routed to the content column", () => {
		expect(is_text_mime("text/plain")).toBe(true)
		expect(is_text_mime("application/octet-stream")).toBe(false)
	})
})

describe("retry_after_ms", () => {
	test("waits the backend's Retry-After seconds", () => {
		expect(retry_after_ms("7", 0)).toBe(7000)
		expect(retry_after_ms(" 12 ", 3)).toBe(12000)
	})

	test("clamps to 1–60 seconds", () => {
		expect(retry_after_ms("0", 0)).toBe(1000)
		expect(retry_after_ms("600", 0)).toBe(60000)
	})

	test("backs off exponentially without a usable header", () => {
		expect(retry_after_ms(null, 0)).toBe(1000)
		expect(retry_after_ms(null, 3)).toBe(8000)
		expect(retry_after_ms("", 1)).toBe(2000)
		expect(retry_after_ms("Wed, 21 Oct 2026 07:28:00 GMT", 2)).toBe(4000)
		expect(retry_after_ms(null, 10)).toBe(60000)
	})
})

describe("upload_file put_blob", () => {
	test("a binary file is sent through the injected put, not the webview", async () => {
		const puts: { url: string; type: string; size: number }[] = []
		const progress: number[] = []
		const folder = {
			id: "root-id",
			workspace_id: "ws",
			parent_id: null,
			name: "",
			kind: "folder" as const,
			mime: null,
			path: "/",
			xattrs: {},
			storage_key: null,
			size_bytes: null,
			deleted_at: null,
			updated_by: null,
			updated_by_client: null,
			updated_at: "",
			content_modified_at: null,
		}
		const query = {
			select: () => query,
			eq: () => query,
			is: () => query,
			maybeSingle: async () => ({ data: folder, error: null }),
		}
		const client = {
			from: () => query,
			auth: {
				getSession: async () => ({ data: { session: { access_token: "token" } } }),
			},
		} as unknown as SupabaseClient
		const original = globalThis.fetch
		globalThis.fetch = (async (input: string | URL | Request) => {
			const path = String(input)
			if (path.endsWith("/presign/upload")) {
				return new Response(JSON.stringify({
					storage_key: "uploads/blob/ws/id.mp4",
					url: "https://b2.example/put",
				}))
			}
			if (path.endsWith("/finalize")) {
				return new Response(JSON.stringify({
					entry: { ...folder, id: "file-id", parent_id: "root-id", name: "sea.mp4", kind: "file", mime: "video/mp4", path: "/sea.mp4" },
					size_bytes: 4,
				}))
			}
			throw new Error(`unexpected fetch ${path}`)
		}) as typeof fetch
		try {
			const fm = createCloudFileManager({
				client,
				workspace_id: "ws",
				backend_url: "https://backend.example",
				put_blob: async (url, content_type, data, on_progress) => {
					puts.push({ url, type: content_type, size: data.size })
					on_progress?.(data.size, data.size)
				},
			})
			const child = await fm.upload_file("/", "sea.mp4", new Blob([Uint8Array.from([1, 2, 3, 4])]), "video/mp4", (loaded) => {
				progress.push(loaded)
			})
			expect(puts).toEqual([{ url: "https://b2.example/put", type: "video/mp4", size: 4 }])
			expect(progress).toEqual([4])
			expect(child).toEqual({ id: "/sea.mp4", name: "sea.mp4", type: "file" })
		} finally {
			globalThis.fetch = original
		}
	})
})
