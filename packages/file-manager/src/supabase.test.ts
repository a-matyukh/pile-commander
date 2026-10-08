import { describe, expect, test } from "bun:test"
import type { SupabaseClient } from "@supabase/supabase-js"
import createCloudFileManager, {
	decode_text_content,
	first_embed,
	inert_document_mime,
	is_text_mime,
	list_workspace_connections,
	list_workspace_entries,
	list_workspace_strokes,
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

describe("replace_file", () => {
	const file = {
		id: "33333333-3333-4333-8333-333333333333",
		workspace_id: "ws",
		parent_id: "root-id",
		name: "photo.png",
		kind: "file" as const,
		mime: "image/png",
		path: "/photo.png",
		xattrs: {},
		storage_key: "ws/old.png",
		size_bytes: 4,
		deleted_at: null,
		updated_by: null,
		updated_by_client: null,
		updated_at: "",
		content_modified_at: null,
	}

	function manager(handler: (path: string, body: Record<string, unknown>) => Response) {
		const puts: string[] = []
		const query = {
			select: () => query,
			eq: () => query,
			is: () => query,
			maybeSingle: async () => ({ data: file, error: null }),
		}
		const client = {
			from: () => query,
			auth: { getSession: async () => ({ data: { session: { access_token: "token" } } }) },
		} as unknown as SupabaseClient
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const path = String(input)
			const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
			return handler(path, body)
		}) as typeof fetch
		const fm = createCloudFileManager({
			client,
			workspace_id: "ws",
			backend_url: "https://backend.example",
			put_blob: async (url) => { puts.push(url) },
		})
		return { fm, puts }
	}

	test("presign carries replace and finalize names only the row", async () => {
		const original = globalThis.fetch
		const seen: { path: string; body: Record<string, unknown> }[] = []
		const { fm, puts } = manager((path, body) => {
			seen.push({ path, body })
			if (path.endsWith("/presign/upload")) {
				return new Response(JSON.stringify({
					storage_key: "uploads/blob/ws/ticket.png",
					url: "https://b2.example/put",
					replace: file.id,
				}))
			}
			if (path.endsWith("/finalize")) {
				return new Response(JSON.stringify({ entry: file, size_bytes: 4 }))
			}
			throw new Error(`unexpected fetch ${path}`)
		})
		try {
			const result = await fm.replace_file("/photo.png", new Blob([Uint8Array.from([1, 2, 3, 4])]), "image/png")
			expect(result).toBe("replaced")
			expect(puts).toEqual(["https://b2.example/put"])
			expect(seen[0]?.body).toMatchObject({ replace: file.id, workspace_id: "ws", size_bytes: 4 })
			expect(seen[1]?.body).toEqual({
				storage_key: "uploads/blob/ws/ticket.png",
				replace: file.id,
				mime: "image/png",
				client_id: expect.any(String),
			})
			expect(seen[1]?.body).not.toHaveProperty("parent_id")
			expect(seen[1]?.body).not.toHaveProperty("name")
			expect(seen[1]?.body).not.toHaveProperty("id")
		} finally {
			globalThis.fetch = original
		}
	})

	test("a presign that does not echo replace uploads nothing", async () => {
		const original = globalThis.fetch
		let calls = 0
		const { fm, puts } = manager((path) => {
			calls += 1
			if (path.endsWith("/presign/upload")) {
				return new Response(JSON.stringify({
					storage_key: "uploads/blob/ws/ticket.png",
					url: "https://b2.example/put",
				}))
			}
			throw new Error(`unexpected fetch ${path}`)
		})
		try {
			expect(await fm.replace_file("/photo.png", new Blob([Uint8Array.from([1])]), "image/png")).toBe("unsupported")
			expect(puts).toEqual([])
			expect(await fm.replace_file("/photo.png", new Blob([Uint8Array.from([1])]), "image/png")).toBe("unsupported")
			expect(calls).toBe(1)
		} finally {
			globalThis.fetch = original
		}
	})
})

describe("workspace listings", () => {
	/** A PostgREST-style builder that serves `total` rows in pages and records the filters. */
	function paged_client(total: number) {
		const calls: { table: string; filters: string[]; order: string; range: [number, number] }[] = []
		const client = {
			from(table: string) {
				const call = { table, filters: [] as string[], order: "", range: [0, 0] as [number, number] }
				const builder = {
					select() { return builder },
					eq(column: string, value: string) { call.filters.push(`${column}=${value}`); return builder },
					is(column: string, value: null) { call.filters.push(`${column} is ${value}`); return builder },
					order(column: string) { call.order = column; return builder },
					range(from: number, to: number) {
						call.range = [from, to]
						calls.push(call)
						const rows = Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, index) => ({
							id: `row-${from + index}`,
						}))
						return Promise.resolve({ data: rows, error: null })
					},
				}
				return builder
			},
		}
		return { client: client as unknown as SupabaseClient, calls }
	}

	test("reads every page of live entries", async () => {
		const { client, calls } = paged_client(1001)
		const rows = await list_workspace_entries(client, "ws-1")
		expect(rows).toHaveLength(1001)
		expect(calls.map(call => call.range)).toEqual([[0, 999], [1000, 1999]])
		expect(calls[0]!.filters).toEqual(["workspace_id=ws-1", "deleted_at is null"])
	})

	test("ink and edges of the whole workspace, in stable order", async () => {
		const strokes = paged_client(3)
		expect(await list_workspace_strokes(strokes.client, "ws-1")).toHaveLength(3)
		expect(strokes.calls[0]).toMatchObject({ table: "folder_strokes", filters: ["workspace_id=ws-1"], order: "id" })

		const edges = paged_client(2)
		expect(await list_workspace_connections(edges.client, "ws-1")).toHaveLength(2)
		expect(edges.calls[0]).toMatchObject({ table: "folder_connections", filters: ["workspace_id=ws-1"], order: "record_id" })
	})
})
