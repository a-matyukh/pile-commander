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
			expect(child).toMatchObject({ id: "/sea.mp4", name: "sea.mp4", type: "file" })
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

describe("cloud pile images", () => {
	type Row = {
		id: string
		workspace_id: string
		parent_id: string | null
		name: string
		kind: "folder" | "file"
		mime: string | null
		path: string
		xattrs: Record<string, string>
		storage_key: string | null
		size_bytes: number | null
		deleted_at: string | null
		updated_by: null
		updated_by_client: null
		updated_at: string
		content_modified_at: null
	}

	function blank(partial: Partial<Row> & Pick<Row, "id" | "parent_id" | "name" | "kind" | "path">): Row {
		return {
			workspace_id: "ws",
			mime: null,
			xattrs: {},
			storage_key: null,
			size_bytes: null,
			deleted_at: null,
			updated_by: null,
			updated_by_client: null,
			updated_at: "",
			content_modified_at: null,
			...partial,
		}
	}

	function world(options?: {
		purge_error?: string
		/** a database before the null-removes merge: refuses null values */
		old_merge?: boolean
		/** another client writes this key right before each merge lands */
		concurrent_key?: string
		/** The server clock: rows written get it as updated_at */
		now?: () => string
	}) {
		const now = () => options?.now?.() ?? ""
		const rows = new Map<string, Row>()
		rows.set("root", blank({ id: "root", parent_id: null, name: "", kind: "folder", path: "/" }))
		const puts: string[] = []
		const calls = { merges: 0, updates: 0 }
		const live = (path: string) => [...rows.values()].find(row => row.path === path && row.deleted_at === null) ?? null

		const client = {
			from() {
				const filters: Record<string, string> = {}
				const builder = {
					select: () => builder,
					eq: (column: string, value: string) => { filters[column] = value; return builder },
					is: () => builder,
					insert(patch: Row) {
						return {
							select: () => ({
								single: async () => {
									const parent = [...rows.values()].find(row => row.id === patch.parent_id)
									const taken = [...rows.values()].some(row =>
										row.parent_id === patch.parent_id && row.name === patch.name && row.deleted_at === null)
									if (taken) return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "entries_sibling_name_unique"' } }
									const row = blank({
										...patch,
										path: parent && parent.path !== "/" ? `${parent.path}/${patch.name}` : `/${patch.name}`,
										updated_at: now(),
									})
									rows.set(row.id, row)
									return { data: row, error: null }
								},
							}),
						}
					},
					update(patch: Partial<Row>) {
						calls.updates += 1
						return {
							eq: async (_column: string, value: string) => {
								const row = [...rows.values()].find(item => item.id === value)
								if (row) Object.assign(row, patch, { updated_at: now() })
								return { error: null }
							},
						}
					},
					maybeSingle: async () => ({ data: live(filters.path ?? ""), error: null }),
				}
				return builder
			},
			rpc: async (name: string, args: Record<string, unknown>) => {
				if (name === "folder_read") {
					const folder = live(String(args.p_path))
					if (!folder) return { data: null, error: { message: `entry not found: ${args.p_path}` } }
					const children = [...rows.values()].filter(row => row.parent_id === folder.id && row.deleted_at === null)
					return { data: { folder, children }, error: null }
				}
				if (name === "merge_entry_xattrs") {
					calls.merges += 1
					const items = args.p_items as { path: string; xattrs: Record<string, string | null> }[]
					if (options?.old_merge && items.some(item => Object.values(item.xattrs).some(value => value === null))) {
						return { data: null, error: { message: "merge_entry_xattrs: every item needs a path and string xattr values" } }
					}
					const refused: { path: string; status: string }[] = []
					for (const item of items) {
						const row = live(item.path)
						if (!row) { refused.push({ path: item.path, status: "missing" }); continue }
						if (item.xattrs.cover === "TOO") { refused.push({ path: item.path, status: "too_large" }); continue }
						if (options?.concurrent_key) row.xattrs = { ...row.xattrs, [options.concurrent_key]: "theirs" }
						const next: Record<string, string> = { ...row.xattrs }
						for (const [key, value] of Object.entries(item.xattrs)) {
							if (value === null) delete next[key]
							else next[key] = value
						}
						row.xattrs = next
						row.updated_at = now()
					}
					return { data: refused, error: null }
				}
				if (name === "delete_entry") {
					const row = rows.get(String(args.p_entry))
					if (!row || row.deleted_at) return { error: { message: "delete_entry: entry not found" } }
					row.deleted_at = "now"
					return { error: null }
				}
				if (name === "purge_entry") {
					if (options?.purge_error) return { error: { message: options.purge_error } }
					const row = rows.get(String(args.p_entry))
					if (!row?.deleted_at) return { error: { message: "purge_entry: entry not found in trash" } }
					rows.delete(row.id)
					return { error: null }
				}
				return { data: null, error: { message: `unexpected rpc ${name}` } }
			},
			auth: { getSession: async () => ({ data: { session: { access_token: "token" } } }) },
		} as unknown as SupabaseClient

		const fm = createCloudFileManager({
			client,
			workspace_id: "ws",
			backend_url: "https://backend.example",
			put_blob: async (url) => { puts.push(url) },
		})
		return { fm, rows, puts, live, calls }
	}

	/** finalize stamps new files with this clock (the backend's) */
	let finalize_now = () => ""
	/** The backend in install_fetch is an older one, without presign by path */
	let presign_by_path_refused = false
	/** Which kind of presign each picture read used */
	const presigns: string[] = []

	function install_fetch(rows: Map<string, { id: string; parent_id: string | null; name: string; kind: string; path: string; deleted_at: string | null }>, bytes: Uint8Array) {
		const original = globalThis.fetch
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const path = String(input)
			if (path.endsWith("/presign/upload")) {
				return new Response(JSON.stringify({ storage_key: "uploads/blob/ws/ticket.webp", url: "https://b2.example/put" }))
			}
			if (path.endsWith("/finalize")) {
				const body = JSON.parse(String(init?.body ?? "{}")) as { parent_id: string; name: string; id: string; mime: string }
				const parent = [...rows.values()].find(row => row.id === body.parent_id)
				const taken = [...rows.values()].some(row => row.parent_id === body.parent_id && row.name === body.name && row.deleted_at === null)
				if (taken) return new Response(JSON.stringify({ error: "an entry with this name already exists" }), { status: 409 })
				const row = {
					id: body.id,
					workspace_id: "ws",
					parent_id: body.parent_id,
					name: body.name,
					kind: "file" as const,
					mime: body.mime,
					path: parent && parent.path !== "/" ? `${parent.path}/${body.name}` : `/${body.name}`,
					xattrs: {},
					storage_key: "ws/blob",
					size_bytes: bytes.byteLength,
					deleted_at: null,
					updated_by: null,
					updated_by_client: null,
					updated_at: finalize_now(),
					content_modified_at: null,
				}
				rows.set(row.id, row)
				return new Response(JSON.stringify({ entry: row, size_bytes: bytes.byteLength }))
			}
			if (path.includes("/presign?")) {
				const query = new URL(path).searchParams
				if (query.has("path")) {
					// an older backend knows only entry ids
					if (presign_by_path_refused) return new Response(JSON.stringify({ error: "invalid entry id" }), { status: 400 })
					const found = [...rows.values()].some(row => row.path === query.get("path") && row.deleted_at === null)
					if (!found) return new Response(JSON.stringify({ error: "blob not found" }), { status: 404 })
				}
				presigns.push(query.has("path") ? "path" : "entry")
				return new Response(JSON.stringify({ url: "https://b2.example/get", expires_in: 60 }))
			}
			if (path === "https://b2.example/get") {
				const copy = new Uint8Array(bytes.byteLength)
				copy.set(bytes)
				return new Response(copy)
			}
			throw new Error(`unexpected fetch ${path}`)
		}) as typeof fetch
		return () => { globalThis.fetch = original }
	}

	function files_named(rows: Map<string, { name: string; kind: string; deleted_at: string | null }>, role: string) {
		return [...rows.values()].filter(row => row.kind === "file" && row.deleted_at === null && row.name.startsWith(`${role}-`))
	}

	test("writes a cover into .pile, reads it back, and purges the previous file on replace", async () => {
		const { fm, rows } = world()
		const first_bytes = new Uint8Array([1, 2, 3])
		const second_bytes = new Uint8Array([1, 2, 4])
		const restore = install_fetch(rows, first_bytes)
		try {
			const first = await fm.write_pile_image("/", "cover", first_bytes)
			expect(first).toMatch(/^pile:cover-[0-9a-f]{8}\.webp$/)
			expect(files_named(rows, "cover")).toHaveLength(1)
			await expect(fm.read_pile_image("/", first)).resolves.toEqual(first_bytes)
			await expect(fm.read_pile_image("/missing", first)).resolves.toBeNull()

			const second = await fm.write_pile_image("/", "cover", second_bytes)
			await fm.set_xattr("/", "cover", second)
			const left = files_named(rows, "cover")
			expect(left.map(row => row.name)).toEqual([second.slice("pile:".length)])
			expect([...rows.values()].filter(row => row.deleted_at)).toEqual([])
		} finally {
			restore()
		}
	})

	test("two parallel writes of one picture share .pile and one file", async () => {
		const { fm, rows, puts } = world()
		const bytes = new Uint8Array([7, 7, 7])
		const restore = install_fetch(rows, bytes)
		try {
			const [a, b] = await Promise.all([
				fm.write_pile_image("/", "cover", bytes),
				fm.write_pile_image("/", "cover", bytes),
			])
			expect(a).toBe(b)
			expect([...rows.values()].filter(row => row.name === ".pile" && row.deleted_at === null)).toHaveLength(1)
			expect(files_named(rows, "cover")).toHaveLength(1)
			expect(puts.length).toBeGreaterThan(0)
		} finally {
			restore()
		}
	})

	test("setting the cover to none purges the file and leaves nothing in the trash", async () => {
		const { fm, rows } = world()
		const restore = install_fetch(rows, new Uint8Array([4]))
		try {
			const token = await fm.write_pile_image("/", "cover", new Uint8Array([4]))
			await fm.set_xattr("/", "cover", token)
			await fm.set_xattr("/", "cover", "none")
			expect(files_named(rows, "cover")).toEqual([])
			expect([...rows.values()].filter(row => row.deleted_at)).toEqual([])
		} finally {
			restore()
		}
	})

	test("listings hide .pile, and the picture is still listed at that path", async () => {
		const { fm, rows } = world()
		const restore = install_fetch(rows, new Uint8Array([1]))
		try {
			await fm.write_pile_image("/", "cover", new Uint8Array([1]))
			expect((await fm.FolderChildren("/")).map(child => child.name)).not.toContain(".pile")
			const pile = await fm.FolderChildren("/.pile")
			expect(pile.map(child => child.name)).toEqual([expect.stringMatching(/^cover-[0-9a-f]{8}\.webp$/)])
			const listed = await fm.folder_with_children_xattrs("/")
			expect(listed.children.map(child => child.name)).not.toContain(".pile")
		} finally {
			restore()
		}
	})

	test("a picture cleanup failure leaves the xattr written", async () => {
		const { fm, rows, live } = world({ purge_error: "storage down" })
		const restore = install_fetch(rows, new Uint8Array([4]))
		const logged: unknown[][] = []
		const original = console.error
		console.error = (...args: unknown[]) => { logged.push(args) }
		try {
			const token = await fm.write_pile_image("/", "cover", new Uint8Array([4]))
			await fm.set_xattr("/", "cover", token)
			await expect(fm.set_xattr("/", "cover", "none")).resolves.toBeUndefined()
			expect(live("/")?.xattrs.cover).toBe("none")
			expect(logged.some(args => args[0] === "pile image cleanup failed")).toBe(true)
		} finally {
			console.error = original
			restore()
		}
	})

	test("remove_xattr removes one key in the merge: a key another client wrote meanwhile survives", async () => {
		const { fm, live, calls } = world({ concurrent_key: "view" })
		await fm.set_xattr("/", "icon", "tabler:star")
		await fm.remove_xattr("/", "icon")
		expect(live("/")?.xattrs).toEqual({ view: "theirs" })
		expect(calls.updates).toBe(0)
	})

	test("remove_xattr on a database without the null merge falls back to the rewrite, once", async () => {
		const { fm, live, calls } = world({ old_merge: true })
		await fm.set_xattr("/", "icon", "tabler:star")
		await fm.set_xattr("/", "view", "grid")
		const merges_before = calls.merges
		await fm.remove_xattr("/", "icon")
		expect(live("/")?.xattrs).toEqual({ view: "grid" })
		expect(calls.merges - merges_before).toBe(1)
		expect(calls.updates).toBe(1)
		await fm.remove_xattr("/", "view")
		expect(live("/")?.xattrs).toEqual({})
		// remembered: no second refused merge
		expect(calls.merges - merges_before).toBe(1)
		expect(calls.updates).toBe(2)
	})

	test("cleanup leaves an unnamed picture younger than an hour; an older one goes", async () => {
		let clock = Date.parse("2026-11-04T10:00:00Z")
		const at = () => new Date(clock).toISOString()
		const { fm, rows } = world({ now: at })
		finalize_now = at
		const restore = install_fetch(rows, new Uint8Array([1]))
		try {
			const old = await fm.write_pile_image("/", "cover", new Uint8Array([1]))
			clock += 2 * 60 * 60 * 1000
			const named = await fm.write_pile_image("/", "cover", new Uint8Array([2]))
			clock += 60 * 1000
			// the next picture, uploaded, its attribute not written yet
			const next = await fm.write_pile_image("/", "cover", new Uint8Array([3]))
			clock += 60 * 1000
			await fm.set_xattr("/", "cover", named)
			const left = files_named(rows, "cover").map(row => row.name).sort()
			expect(left).toEqual([named, next].map(token => token.slice("pile:".length)).sort())
			expect(left).not.toContain(old.slice("pile:".length))
		} finally {
			finalize_now = () => ""
			restore()
		}
	})

	test("choosing an old picture again freshens it, so the cleanup keeps it", async () => {
		let clock = Date.parse("2026-11-04T10:00:00Z")
		const at = () => new Date(clock).toISOString()
		const { fm, rows } = world({ now: at })
		finalize_now = at
		const restore = install_fetch(rows, new Uint8Array([1]))
		try {
			const again = await fm.write_pile_image("/", "cover", new Uint8Array([1]))
			const current = await fm.write_pile_image("/", "cover", new Uint8Array([2]))
			await fm.set_xattr("/", "cover", current)
			clock += 2 * 60 * 60 * 1000
			// two hours later the first picture, unnamed, is chosen again
			await expect(fm.write_pile_image("/", "cover", new Uint8Array([1]))).resolves.toBe(again)
			clock += 1000
			// a cleanup from another write runs before its attribute is written
			await fm.set_xattr("/", "cover", current)
			expect(files_named(rows, "cover").map(row => row.name)).toContain(again.slice("pile:".length))
		} finally {
			finalize_now = () => ""
			restore()
		}
	})

	test("a picture is read with one presign by path; an older backend falls back to the id lookup", async () => {
		const { fm, rows } = world()
		const bytes = new Uint8Array([5, 6])
		const restore = install_fetch(rows, bytes)
		presigns.length = 0
		try {
			const token = await fm.write_pile_image("/", "cover", bytes)
			await expect(fm.read_pile_image("/", token)).resolves.toEqual(bytes)
			expect(presigns).toEqual(["path"])

			const older = world()
			const restore_older = install_fetch(older.rows, bytes)
			presign_by_path_refused = true
			presigns.length = 0
			try {
				const again = await older.fm.write_pile_image("/", "cover", bytes)
				await expect(older.fm.read_pile_image("/", again)).resolves.toEqual(bytes)
				await expect(older.fm.read_pile_image("/", again)).resolves.toEqual(bytes)
				// one refused try, then the id lookup for both reads
				expect(presigns).toEqual(["entry", "entry"])
			} finally {
				presign_by_path_refused = false
				restore_older()
			}
		} finally {
			restore()
		}
	})

	test("a refused xattr path does not purge its picture", async () => {
		const { fm, rows } = world()
		const bytes = new Uint8Array([4])
		const restore = install_fetch(rows, bytes)
		try {
			const token = await fm.write_pile_image("/", "cover", bytes)
			await fm.set_xattr("/", "cover", token)
			const { missing } = await fm.set_xattrs([{ id: "/", xattrs: { cover: "TOO" } }])
			expect(missing).toEqual(["/"])
			expect(files_named(rows, "cover")).toHaveLength(1)
		} finally {
			restore()
		}
	})
})
