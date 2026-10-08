import type { RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js"
import { is_valid_slug } from "./reserved-slugs"
import { parse_plan_limit_error, PlanLimitError } from "./planLimit"
import { MediaUnavailableError, parse_media_unavailable } from "./mediaUnavailable"
import { StorageUnreachableError } from "./storageUnreachable"
import type {
	ConnectionsWatchEvent,
	CreateFolderOptions,
	CreateTextFileOptions,
	FileManager,
	FolderChild,
	FolderConnection,
	FolderStroke,
	FolderWithChildrenXattrs,
	MediaSrc,
	PutBlob,
	StrokesWatchEvent,
	UploadProgressCallback,
	WatchEvent,
	Xattr,
} from "./types"

/**
 * Cloud implementation of FileManager on top of Supabase (Postgres + Realtime).
 * Media blobs live in Backblaze B2 and are served through the backend gateway
 * (presigned URLs), see apps/backend.
 *
 * DB schema: src/schema.sql; structural operations (rename/move/copy):
 * src/rpc.sql. Same identity contract as local.ts: `id` is exposed as the
 * text path (entries.path); rename/move return a new id.
 */

export type CloudFileManagerOptions = {
	client: SupabaseClient
	workspace_id: string
	/** URL of the B2 backend gateway (GET /presign?entry=...) */
	backend_url: string
	/** PUTs the staged bytes; the default is the webview's XHR (with progress) */
	put_blob?: PutBlob
}

export type EntryRow = {
	id: string
	workspace_id: string
	parent_id: string | null
	name: string
	kind: "file" | "folder"
	mime: string | null
	path: string
	xattrs: Record<string, string>
	storage_key: string | null
	size_bytes: number | null
	deleted_at: string | null
	updated_by: string | null
	updated_by_client: string | null
	updated_at: string
	content_modified_at: string | null
}

// Text payloads live in the separate entry_contents table (schema.sql):
// entries rows stay slim so realtime never broadcasts megabytes
const ENTRY_COLUMNS =
	"id, workspace_id, parent_id, name, kind, mime, path, xattrs, storage_key, size_bytes, deleted_at, updated_by, updated_by_client, updated_at, content_modified_at"

export type StrokeRow = {
	id: string
	entry_id: string
	workspace_id: string
	z: number
	position: { x: number; y: number }
	points: { x: number; y: number }[]
	color: string
	stroke_width: number
	width: number
	height: number
	updated_by_client: string | null
}

const STROKE_COLUMNS =
	"id, entry_id, workspace_id, z, position, points, color, stroke_width, width, height, updated_by_client"

function row_to_stroke(row: StrokeRow): FolderStroke {
	return {
		id: row.id,
		z: row.z,
		position: row.position,
		points: row.points,
		color: row.color,
		stroke_width: row.stroke_width,
		width: row.width,
		height: row.height,
	}
}

export type ConnectionPropsRow = {
	from_handle?: FolderConnection["from_handle"]
	to_handle?: FolderConnection["to_handle"]
	marker_start?: FolderConnection["marker_start"]
	marker_end?: FolderConnection["marker_end"]
	is_animated?: boolean
	label?: string
}

export type ConnectionRow = {
	record_id: string
	id: string
	entry_id: string
	workspace_id: string
	from_entry: string
	to_entry: string
	props: ConnectionPropsRow
	updated_by_client: string | null
}

const CONNECTION_COLUMNS = "record_id, id, entry_id, workspace_id, from_entry, to_entry, props, updated_by_client"

function row_to_connection(row: ConnectionRow, from: string, to: string): FolderConnection {
	const label = row.props?.label
	return {
		id: row.id,
		from,
		to,
		from_handle: row.props?.from_handle ?? undefined,
		to_handle: row.props?.to_handle ?? undefined,
		marker_start: row.props?.marker_start ?? undefined,
		marker_end: row.props?.marker_end ?? undefined,
		is_animated: row.props?.is_animated ?? false,
		...(label ? { label } : {}),
	}
}

function connection_props(connection: FolderConnection): ConnectionPropsRow {
	return {
		from_handle: connection.from_handle,
		to_handle: connection.to_handle,
		marker_start: connection.marker_start,
		marker_end: connection.marker_end,
		is_animated: connection.is_animated,
		...(connection.label ? { label: connection.label } : {}),
	}
}

/**
 * Client-instance id written to updated_by_client as an audit/presence hint
 * ("which device changed this"). Persisted per device in localStorage so it
 * is stable across restarts; ephemeral outside the browser. Deliberately
 * NOT used for echo suppression — that stays per-instance in recent_writes
 */
const CLIENT_ID_KEY = "pile-commander:client-instance-id"
let ephemeral_client_id: string | null = null

export function client_instance_id(): string {
	const storage = typeof localStorage === "undefined" ? null : localStorage
	const cached = storage?.getItem(CLIENT_ID_KEY)
	if (cached) return cached
	if (!ephemeral_client_id) ephemeral_client_id = crypto.randomUUID()
	storage?.setItem(CLIENT_ID_KEY, ephemeral_client_id)
	return ephemeral_client_id
}

/**
 * UX-side guard mirroring the DB limit: the real gate is the entries_touch
 * trigger in schema.sql — this constant only fails fast with a friendly error
 */
export const MAX_TEXT_CONTENT_BYTES = 8 * 1024 * 1024

const MIME_BY_EXTENSION: Record<string, string> = {
	md: "text/markdown",
	txt: "text/plain",
	json: "application/json",
	csv: "text/csv",
	svg: "image/svg+xml",
	html: "text/html",
	css: "text/css",
	js: "text/javascript",
	ts: "text/typescript",
	yaml: "text/yaml",
	yml: "text/yaml",
	xml: "text/xml",
}

export function mime_from_name(name: string): string {
	const ext = name.split(".").pop()?.toLowerCase() ?? ""
	return MIME_BY_EXTENSION[ext] ?? "text/plain"
}

// textual types outside the text/* family
const TEXT_MIME_EXACT = new Set([
	"application/json",
	"application/xml",
	"application/javascript",
	"application/x-yaml",
	"image/svg+xml",
])

/** Routes upload_file between the content column (text) and B2 (binary) */
export function is_text_mime(mime: string): boolean {
	const base = mime.split(";")[0]?.trim().toLowerCase() ?? ""
	return base.startsWith("text/") || TEXT_MIME_EXACT.has(base)
}

// Types a browser executes when they are the top-level document. A blob: URL
// inherits the origin of the page that created it, so opening user-authored
// HTML/SVG from a shared or public board in a new tab would run its scripts
// with this app's origin (and its session in localStorage) — stored XSS
const ACTIVE_DOCUMENT_MIME = new Set([
	"text/html",
	"application/xhtml+xml",
	"image/svg+xml",
	"text/xml",
	"application/xml",
	"text/javascript",
	"application/javascript",
	"application/ecmascript",
])

/**
 * MIME to give a text payload that is about to be opened as a document in
 * this origin: active content is shown as source (text/plain) instead of
 * being rendered. Inline previews (img tags, sanitized markup) keep the
 * real type — this is only for window.open / top-level navigation
 */
export function inert_document_mime(mime: string | null | undefined): string {
	const base = (mime ?? "text/plain").split(";")[0]?.trim().toLowerCase() ?? "text/plain"
	return ACTIVE_DOCUMENT_MIME.has(base) ? "text/plain" : mime ?? "text/plain"
}

/**
 * Strict UTF-8 decode. Rejects invalid sequences (instead of the lossy
 * replacement chars of `Blob.text()`) and NUL bytes — Postgres text/json
 * cannot store `\u0000`, so such payloads must go to blob storage.
 */
function decode_text_content(bytes: Uint8Array): string | null {
	if (bytes.includes(0)) return null
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
	} catch {
		return null
	}
}
export { decode_text_content }

function parent_path(path: string): string {
	const idx = path.lastIndexOf("/")
	return idx <= 0 ? "/" : path.slice(0, idx)
}

function is_under(path: string, folder_path: string): boolean {
	if (path === folder_path) return true
	return folder_path === "/" ? path.startsWith("/") : path.startsWith(`${folder_path}/`)
}

function record_to_xattrs(record: Record<string, string>): Xattr[] {
	return Object.entries(record).map(([name, value]) => ({ name, value }))
}

// Paths per merge_entry_xattrs call: one statement per batch and a request
// body that stays small even when entries carry sizeable attributes
const XATTRS_BATCH_SIZE = 200

// A spent per-route budget (apps/backend/src/ratelimit.ts) answers 429 with
// Retry-After. Bulk flows — a multi-file drop, a bridge copy — hit it in
// normal use, so a request waits and retries a few times before giving up
const RATE_LIMIT_RETRIES = 5
const RATE_LIMIT_MIN_WAIT_MS = 1_000
const RATE_LIMIT_MAX_WAIT_MS = 60_000

/**
 * Wait before retrying a 429: the backend's Retry-After seconds when the
 * header is usable (CORS exposes it), otherwise an exponential backoff by
 * attempt. Clamped to 1–60 s
 */
export function retry_after_ms(header: string | null, attempt: number): number {
	const trimmed = header?.trim() ?? ""
	const seconds = trimmed === "" ? Number.NaN : Number(trimmed)
	const ms = Number.isFinite(seconds) && seconds >= 0
		? seconds * 1000
		: RATE_LIMIT_MIN_WAIT_MS * 2 ** attempt
	return Math.min(Math.max(ms, RATE_LIMIT_MIN_WAIT_MS), RATE_LIMIT_MAX_WAIT_MS)
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve_sleep) => setTimeout(resolve_sleep, ms))
}

export type CloudFileManager = FileManager & {
	/**
	 * Replaces the bytes of a live file without changing its id. `'unsupported'`
	 * means this backend did not echo `replace` on the presign: nothing was
	 * uploaded, and later calls in this session skip the network.
	 */
	replace_file(
		id: string,
		data: Blob,
		mime?: string,
		onProgress?: UploadProgressCallback,
	): Promise<"replaced" | "unsupported">
}

function createCloudFileManager(options: CloudFileManagerOptions): CloudFileManager {
	const { client, workspace_id, backend_url } = options

	type RefusedXattrs = { path: string; status: "missing" | "too_large" }

	// One server-side jsonb merge for many entries (rpc.sql merge_entry_xattrs).
	// Refused paths come back instead of failing the batch: gone or trashed
	// rows as `missing`, rows whose attributes would break the 64 KB cap as
	// `too_large` (left untouched)
	async function merge_xattrs(
		items: { path: string; xattrs: Record<string, string> }[],
	): Promise<RefusedXattrs[]> {
		if (items.length === 0) return []
		const { data, error } = await client.rpc("merge_entry_xattrs", {
			p_workspace: workspace_id,
			p_items: items,
			p_client_id: client_instance_id(),
		})
		if (error) throw new Error(`merge_entry_xattrs failed: ${error.message}`)
		return (data ?? []) as RefusedXattrs[]
	}

	async function resolve(path: string): Promise<EntryRow> {
		// maybeSingle: zero rows is an expected "deleted / never existed" case;
		// .single() would make PostgREST answer 406, noisy in the console
		const { data, error } = await client
			.from("entries")
			.select(ENTRY_COLUMNS)
			.eq("workspace_id", workspace_id)
			.eq("path", path)
			.is("deleted_at", null)
			.maybeSingle()
		if (error) throw new Error(`resolve failed: ${path} (${error.message})`)
		if (!data) throw new Error(`entry not found: ${path}`)
		return data as EntryRow
	}

	async function read_content(entry_id: string): Promise<string | null> {
		const { data, error } = await client
			.from("entry_contents")
			.select("content")
			.eq("entry_id", entry_id)
			.maybeSingle()
		if (error) throw new Error(`read_content failed: ${error.message}`)
		return (data as { content: string } | null)?.content ?? null
	}

	// One RPC writes the entries row and the payload row atomically (rpc.sql
	// create_text_file): a failed size/quota gate leaves nothing behind, and
	// clients need no DELETE privilege on entries for a rollback. The id is
	// minted here so the realtime echo is recognized as our own write — two
	// echoes: the INSERT and the entries UPDATE that entry_contents_touch
	// makes in the same transaction. Initial xattrs ride along in the INSERT,
	// so no watcher ever reads the entry without them
	async function insert_text_entry(
		folder: EntryRow,
		filename: string,
		mime: string,
		content: string,
		xattrs: Record<string, string> = {},
	): Promise<EntryRow> {
		const id = crypto.randomUUID()
		mark_write(id, 2)
		const { data, error } = await client.rpc("create_text_file", {
			p_parent: folder.id,
			p_name: filename,
			p_mime: mime,
			p_content: content,
			p_client_id: client_instance_id(),
			p_id: id,
			p_xattrs: xattrs,
		})
		if (error) {
			const limit = parse_plan_limit_error(error)
			if (limit) throw new PlanLimitError(limit, error.message)
			throw new Error(`insert_text_entry failed: ${error.message}`)
		}
		return data as EntryRow
	}

	function to_child(row: EntryRow): FolderChild {
		return { id: row.path, name: row.name, type: row.kind }
	}

	type FolderReadResult = { folder: EntryRow; children: EntryRow[] }

	// folder + children in one roundtrip; the message text is passed through
	// untouched — is_missing_path_error in the client matches /not found/i
	async function folder_read(path: string): Promise<FolderReadResult> {
		const { data, error } = await client.rpc("folder_read", {
			p_workspace: workspace_id,
			p_path: path,
		})
		if (error) throw new Error(error.message)
		return data as FolderReadResult
	}

	async function auth_headers(): Promise<Record<string, string>> {
		const { data } = await client.auth.getSession()
		return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}
	}

	// getSession() can still hand out a JWT whose Auth session row is gone
	// (rotation, time-box, sign-out in another tab). One refresh + retry
	// recovers when the refresh token is still valid. A 429 waits out the
	// route budget a few times instead of failing a bulk flow.
	async function fetch_with_auth(url: string, init: RequestInit = {}): Promise<Response> {
		const send = async () => {
			const headers = new Headers(init.headers)
			for (const [name, value] of Object.entries(await auth_headers())) {
				headers.set(name, value)
			}
			return fetch(url, { ...init, headers })
		}
		let response = await send()
		if (response.status === 401) {
			const { error } = await client.auth.refreshSession()
			if (!error) response = await send()
		}
		for (let attempt = 0; response.status === 429 && attempt < RATE_LIMIT_RETRIES; attempt++) {
			await sleep(retry_after_ms(response.headers.get("Retry-After"), attempt))
			response = await send()
		}
		return response
	}

	// Download URLs are short-lived read capabilities (PRESIGN_GET_TTL_SECONDS
	// on the backend); the expiry travels with the URL so caches can refresh.
	// The margin keeps a URL from being handed out seconds before it dies
	const PRESIGN_EXPIRY_MARGIN_MS = 30_000

	// By entry id, not storage key: the row decides whose egress budget pays
	// (forks share the source's key until re-keyed, copies share objects).
	// `original` asks for the file itself rather than a visitor's preview
	// (Download as .pile): signed-in only, charged to the caller
	async function presign(entry_id: string, original = false): Promise<MediaSrc> {
		const response = await fetch_with_auth(
			`${backend_url}/presign?entry=${encodeURIComponent(entry_id)}${original ? "&original=1" : ""}`,
		)
		if (!response.ok) {
			const refusal: unknown = await response.json().catch(() => null)
			// a public-board visitor refused by the egress fair use gets a typed
			// error the widgets render as a placeholder
			const reason = parse_media_unavailable(refusal)
			if (reason) throw new MediaUnavailableError(reason)
			if ((refusal as { error?: unknown } | null)?.error === "download_not_allowed") {
				throw new Error("The author does not allow downloads of this workspace")
			}
			throw new Error(`presign failed: ${response.status}`)
		}
		const body = (await response.json()) as { url: string; expires_in?: number; variant?: unknown }
		const media: MediaSrc = { url: body.url }
		if (typeof body.expires_in === "number" && Number.isFinite(body.expires_in)) {
			media.expires_at = Date.now() + Math.max(0, body.expires_in * 1000 - PRESIGN_EXPIRY_MARGIN_MS)
		}
		// a non-member of a public board may be served a preview instead of the
		// original; anything unrecognised is treated as the original
		if (body.variant === "thumb" || body.variant === "poster") media.variant = body.variant
		return media
	}

	async function backend_post<T>(path: string, body: unknown): Promise<T> {
		const response = await fetch_with_auth(`${backend_url}${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		})
		if (!response.ok) {
			const text = await response.text()
			let parsed: unknown = text
			try {
				parsed = JSON.parse(text)
			} catch {
				/* keep the raw text */
			}
			const limit = parse_plan_limit_error(parsed) ?? parse_plan_limit_error(text)
			if (limit) throw new PlanLimitError(limit, `${path} failed: ${response.status} ${text}`)
			if (response.status === 401) {
				throw new Error(
					`${path} failed: ${response.status} ${text}. Sign out and sign in, then try again.`,
				)
			}
			throw new Error(`${path} failed: ${response.status} ${text}`)
		}
		return (await response.json()) as T
	}

	// XHR instead of fetch: fetch has no upload progress events
	function put_with_progress(
		url: string,
		type: string,
		data: Blob,
		onProgress?: UploadProgressCallback,
	): Promise<void> {
		return new Promise((resolve_promise, reject) => {
			const xhr = new XMLHttpRequest()
			xhr.open("PUT", url)
			xhr.setRequestHeader("Content-Type", type)
			xhr.upload.onprogress = (event) => {
				if (event.lengthComputable) onProgress?.(event.loaded, event.total)
			}
			xhr.onload = () => {
				if (xhr.status >= 200 && xhr.status < 300) resolve_promise()
				else reject(new Error(`blob upload failed: ${xhr.status}`))
			}
			xhr.onerror = () => reject(new StorageUnreachableError("blob upload failed: network error"))
			xhr.send(data)
		})
	}

	// Echo suppression: realtime events caused by THIS fm instance are skipped
	// in watch(); events from other devices and other members flow through.
	// Own echoes are pointless refetches and can yank an editor mid-typing.
	// False positives (a remote write to the same entry inside the TTL window)
	// self-heal on the next event or folder reload
	// `echoes`: how many realtime events the write produces for this id
	// (a trigger touching the same row in one transaction adds one)
	const ECHO_TTL_MS = 10_000
	const recent_writes = new Map<string, { ts: number; remaining: number }>()

	function mark_write(id: string, echoes = 1) {
		const now = Date.now()
		for (const [key, mark] of recent_writes) {
			if (now - mark.ts > ECHO_TTL_MS) recent_writes.delete(key)
		}
		const pending = recent_writes.get(id)?.remaining ?? 0
		recent_writes.set(id, { ts: now, remaining: pending + echoes })
	}

	function consume_own_echo(id: string | undefined): boolean {
		if (!id) return false
		const mark = recent_writes.get(id)
		if (mark === undefined) return false
		mark.remaining -= 1
		if (mark.remaining <= 0) recent_writes.delete(id)
		return Date.now() - mark.ts <= ECHO_TTL_MS
	}

	type EntryPatch = { id: string; path: string; name: string }

	async function call_entry_rpc(
		fn: "rename_entry" | "move_entry" | "copy_entry",
		params: Record<string, string | null>,
	): Promise<EntryPatch> {
		const { data, error } = await client.rpc(fn, params)
		if (error) {
			const limit = parse_plan_limit_error(error)
			if (limit) throw new PlanLimitError(limit, `${fn} failed: ${error.message}`)
			throw new Error(`${fn} failed: ${error.message}`)
		}
		const result = (data as EntryPatch[])[0]
		if (!result) throw new Error(`${fn} returned no rows`)
		return result
	}

	// Same-workspace copies share the original's blobs: objects are immutable
	// and the GC keeps one alive while any row references it (rpc.sql
	// copy_entry), so no backend re-key is needed here — only forks
	// (fork_workspace below) get their own objects
	async function copy_entry_impl(source_path: string, target_folder_id: string, new_name?: string) {
		const source = await resolve(source_path)
		const target = await resolve(target_folder_id)
		const patch = await call_entry_rpc("copy_entry", {
			p_source: source.id,
			p_target_folder: target.id,
			p_new_name: new_name ?? null,
			p_client_id: client_instance_id(),
		})
		mark_write(patch.id)
		return { id: patch.path, type: source.kind, name: patch.name }
	}

	// as_document: the URL will be opened as a top-level page (open_file), so
	// text payloads of active types are served inert — see inert_document_mime
	async function get_media_src_impl(
		id: string,
		mime_override?: string,
		as_document = false,
		original = false,
	): Promise<MediaSrc> {
		const row = await resolve(id)
		if (row.storage_key) {
			// presigned URLs expire on their own, no revoke needed. The object
			// is served from the B2 origin, never from this one
			return presign(row.id, original)
		}
		const content = await read_content(row.id)
		if (content !== null) {
			const type = mime_override ?? row.mime ?? "text/plain"
			const blob = new Blob([content], {
				type: as_document ? inert_document_mime(type) : type,
			})
			const url = URL.createObjectURL(blob)
			return { url, revoke: () => URL.revokeObjectURL(url) }
		}
		throw new Error(`entry has no content: ${id}`)
	}

	// presign upload → PUT bytes straight to B2 → finalize. The backend
	// copies staging into an immutable key and atomically records the entry
	// with an idempotency receipt. Repeating finalize never deletes the blob.
	async function upload_file_impl(
		folder_id: string,
		filename: string,
		data: Blob,
		mime?: string,
		onProgress?: UploadProgressCallback,
	): Promise<FolderChild> {
		const folder = await resolve(folder_id)
		let type = mime || data.type || mime_from_name(filename)

		if (is_text_mime(type)) {
			const bytes = new Uint8Array(await data.arrayBuffer())
			const content = decode_text_content(bytes)
			if (content !== null) {
				if (bytes.byteLength > MAX_TEXT_CONTENT_BYTES) {
					throw new Error(
						`file too large for text storage: ${bytes.byteLength} bytes (limit ${MAX_TEXT_CONTENT_BYTES})`,
					)
				}
				const row = await insert_text_entry(folder, filename, type, content)
				onProgress?.(bytes.byteLength, bytes.byteLength)
				return to_child(row)
			}
			// Binary payload behind a text-looking mime (e.g. an unknown
			// extension falls back to text/plain): route it to blob storage
			// instead of failing the upload on Postgres text constraints.
			type = "application/octet-stream"
		}

		try {
			const { storage_key, url } = await backend_post<{ storage_key: string; url: string }>(
				"/presign/upload",
				{ workspace_id, name: filename, size_bytes: data.size, mime: type },
			)
			if (options.put_blob) await options.put_blob(url, type, data, onProgress)
			else await put_with_progress(url, type, data, onProgress)

			// the id is minted here so the realtime echo of the backend's insert
			// is recognized as our own write
			const id = crypto.randomUUID()
			mark_write(id)
			const { entry } = await backend_post<{ entry: EntryRow; size_bytes: number }>("/finalize", {
				storage_key,
				id,
				parent_id: folder.id,
				name: filename,
				mime: type,
				client_id: client_instance_id(),
			})
			return to_child(entry)
		} catch (error) {
			if (error instanceof PlanLimitError && !error.file_mime) {
				throw new PlanLimitError({ ...error.to_info(), file_mime: type }, error.message)
			}
			throw error
		}
	}

	// Remembered for the session: an old backend accepts the extra field and
	// answers without echoing it. Detect that before the PUT, so the bytes
	// are never uploaded into a ticket the finalize cannot use.
	let replace_supported = true

	async function replace_file(
		id: string,
		data: Blob,
		mime?: string,
		onProgress?: UploadProgressCallback,
	): Promise<"replaced" | "unsupported"> {
		if (!replace_supported) return "unsupported"
		const row = await resolve(id)
		let type = mime || data.type || mime_from_name(row.name)
		if (is_text_mime(type)) {
			const bytes = new Uint8Array(await data.arrayBuffer())
			if (bytes.byteLength > MAX_TEXT_CONTENT_BYTES || decode_text_content(bytes) === null) {
				type = "application/octet-stream"
			}
		}
		try {
			const ticket = await backend_post<{ storage_key: string; url: string; replace?: string }>(
				"/presign/upload",
				{ workspace_id, name: row.name, size_bytes: data.size, mime: type, replace: row.id },
			)
			if (ticket.replace !== row.id) {
				replace_supported = false
				return "unsupported"
			}
			if (options.put_blob) await options.put_blob(ticket.url, type, data, onProgress)
			else await put_with_progress(ticket.url, type, data, onProgress)
			mark_write(row.id)
			await backend_post<{ entry: EntryRow }>("/finalize", {
				storage_key: ticket.storage_key,
				replace: row.id,
				mime: type,
				client_id: client_instance_id(),
			})
			return "replaced"
		} catch (error) {
			if (error instanceof PlanLimitError && !error.file_mime) {
				throw new PlanLimitError({ ...error.to_info(), file_mime: type }, error.message)
			}
			throw error
		}
	}

	let watch_counter = 0
	// supabase-js 2.112 reuses RealtimeChannel by topic: a second
	// .on('postgres_changes') on a joining/joined channel throws
	// "cannot add postgres_changes callbacks after subscribe()".
	// Unique topics per FM (+ generation) so two FileManagers that share
	// the process-wide client, or a retry after CHANNEL_ERROR, never
	// attach to a leftover subscribed channel.
	const fm_realtime_id = crypto.randomUUID()

	function next_realtime_topic(kind: string): string {
		watch_counter += 1
		return `file-manager-${kind}:${workspace_id}:${fm_realtime_id}:${watch_counter}`
	}

	// One postgres_changes channel per FM instance and table, shared by every
	// watcher of that table: all subscriptions carry the same workspace_id
	// filter, so a channel per watcher would only deliver (and bill) every
	// event once per watcher. Joined on the first ensure(), removed once the
	// owner reports no watchers left.
	//
	// Only a failed first join is fatal: ensure() rejects and a retry gets a
	// fresh topic. After the join, CHANNEL_ERROR / TIMED_OUT mean a dropped
	// connection — Phoenix rejoins by itself, and removing the channel here
	// would cancel that. The events of the gap are lost, so the next
	// SUBSCRIBED calls `on_resync` and the watchers re-read. A channel the
	// server closed is not rejoined: its slot is freed, and the watchers
	// resync once the next ensure() has joined a replacement
	function shared_postgres_channel(
		kind: string,
		table: string,
		has_watchers: () => boolean,
		on_payload: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void,
		on_resync: () => void,
	) {
		let channel: ReturnType<typeof client.channel> | null = null
		let ready: Promise<void> | null = null
		let replaces_closed = false

		function ensure(): Promise<void> {
			if (ready) return ready
			const created = client
				.channel(next_realtime_topic(kind))
				.on(
					"postgres_changes",
					{ event: "*", schema: "public", table, filter: `workspace_id=eq.${workspace_id}` },
					on_payload,
				)
			channel = created
			ready = new Promise<void>((resolve_subscribe, reject_subscribe) => {
				let joined = false
				let interrupted = false
				created.subscribe((status) => {
					// late statuses of a released or replaced channel
					if (channel !== created) return
					if (status === "SUBSCRIBED") {
						if (!joined) {
							joined = true
							resolve_subscribe()
							if (replaces_closed) {
								replaces_closed = false
								on_resync()
							}
						} else if (interrupted) {
							interrupted = false
							on_resync()
						}
					} else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
						if (joined) {
							interrupted = true
							return
						}
						channel = null
						ready = null
						void client.removeChannel(created)
						reject_subscribe(new Error(`${kind} watch subscribe failed: ${status}`))
					} else if (status === "CLOSED" && joined) {
						channel = null
						ready = null
						replaces_closed = true
					}
				})
			})
			return ready
		}

		return {
			ensure,
			async release_if_idle(): Promise<void> {
				if (has_watchers()) return
				const current = channel
				channel = null
				ready = null
				replaces_closed = false
				if (current) await client.removeChannel(current)
			},
		}
	}

	// folder_strokes: watchers register by entry uuid (survives renames),
	// events are dispatched to the matching folder's callbacks. A DELETE
	// payload carries only the narrow replica identity (workspace_id + id, see
	// schema.sql) and no entry_id, so deletes are fanned out to every watcher:
	// stroke ids are globally unique uuids, removal from other folders' maps
	// is a no-op.
	const strokes_watchers = new Map<string, Set<(event: StrokesWatchEvent) => void>>()
	const strokes_channel = shared_postgres_channel(
		"strokes",
		"folder_strokes",
		() => strokes_watchers.size > 0,
		(payload) => {
			if (payload.eventType === "DELETE") {
				const id = (payload.old as Partial<StrokeRow>).id
				if (!id || consume_own_echo(id)) return
				for (const callbacks of strokes_watchers.values()) {
					for (const on_event of callbacks) {
						on_event({ upserted: [], deleted: [id] })
					}
				}
				return
			}
			const row = payload.new as StrokeRow
			if (!row.id || consume_own_echo(row.id)) return
			const callbacks = strokes_watchers.get(row.entry_id)
			if (!callbacks) return
			const event: StrokesWatchEvent = { upserted: [row_to_stroke(row)], deleted: [] }
			for (const on_event of callbacks) on_event(event)
		},
		() => {
			for (const callbacks of strokes_watchers.values()) {
				for (const on_event of callbacks) on_event({ upserted: [], deleted: [], resync: true })
			}
		},
	)

	// DELETE exposes only an opaque database UUID, never the business id (which
	// contains file paths). Map only records we have actually read in THIS
	// workspace. Global DELETE events from other workspaces cannot remove an
	// edge with an identical client id, nor trigger a gratuitous resync.
	const connections_watchers = new Map<string, Set<(event: ConnectionsWatchEvent) => void>>()
	const connection_records = new Map<string, { id: string; entry_id: string }>()
	function remember_connection(row: ConnectionRow) {
		if (row.record_id && row.workspace_id === workspace_id) {
			connection_records.set(row.record_id, { id: row.id, entry_id: row.entry_id })
		}
	}

	// Events arrive in order on the channel, but endpoint uuid→path mapping
	// is async — chain the dispatches so ordering survives the lookups. A
	// failed lookup drops only its own event: a rejected link would skip
	// every later one
	let connections_dispatch: Promise<void> = Promise.resolve()
	function dispatch_connections(task: () => void | Promise<void>) {
		connections_dispatch = connections_dispatch.then(task).catch((error: unknown) => {
			console.error("connections event dropped:", error)
		})
	}

	// Batch uuid→path map for connection endpoints (rows carry uuids, the FM
	// identity contract exposes paths)
	async function paths_for_entry_ids(ids: string[]): Promise<Map<string, string>> {
		const unique = [...new Set(ids)]
		if (unique.length === 0) return new Map()
		const { data, error } = await client
			.from("entries")
			.select("id, path")
			.eq("workspace_id", workspace_id)
			.in("id", unique)
		if (error) throw new Error(`paths_for_entry_ids failed: ${error.message}`)
		return new Map((data as { id: string; path: string }[]).map((row) => [row.id, row.path]))
	}

	// Batch path→uuid map for writes; a missing endpoint fails loudly here
	// instead of tripping the FK
	async function entry_ids_for_paths(paths: string[]): Promise<Map<string, string>> {
		const unique = [...new Set(paths)]
		if (unique.length === 0) return new Map()
		const { data, error } = await client
			.from("entries")
			.select("id, path")
			.eq("workspace_id", workspace_id)
			.in("path", unique)
			.is("deleted_at", null)
		if (error) throw new Error(`entry_ids_for_paths failed: ${error.message}`)
		const map = new Map((data as { id: string; path: string }[]).map((row) => [row.path, row.id]))
		for (const path of unique) {
			if (!map.has(path)) throw new Error(`entry not found: ${path}`)
		}
		return map
	}

	function connection_with_paths(
		row: ConnectionRow,
		paths: Map<string, string>,
	): FolderConnection | null {
		const from = paths.get(row.from_entry)
		const to = paths.get(row.to_entry)
		// an endpoint outside the map was hard-deleted between the list and
		// the lookup; the cascade removes the row, so just skip it
		if (!from || !to) return null
		return row_to_connection(row, from, to)
	}

	const connections_channel = shared_postgres_channel(
		"connections",
		"folder_connections",
		() => connections_watchers.size > 0,
		(payload) => {
			dispatch_connections(async () => {
				if (payload.eventType === "DELETE") {
					const old = payload.old as Partial<ConnectionRow>
					if (old.workspace_id && old.workspace_id !== workspace_id) return
					const record = old.record_id ? connection_records.get(old.record_id) : undefined
					if (!record) return
					connection_records.delete(old.record_id!)
					if (consume_own_echo(record.id)) return
					for (const on_event of connections_watchers.get(record.entry_id) ?? []) {
						on_event({ upserted: [], deleted: [record.id] })
					}
					return
				}
				const row = payload.new as ConnectionRow
				if (row.workspace_id !== workspace_id) return
				remember_connection(row)
				if (!row.id || consume_own_echo(row.id)) return
				const callbacks = connections_watchers.get(row.entry_id)
				if (!callbacks) return
				const paths = await paths_for_entry_ids([row.from_entry, row.to_entry])
				const connection = connection_with_paths(row, paths)
				if (!connection) return
				const event: ConnectionsWatchEvent = { upserted: [connection], deleted: [] }
				for (const on_event of callbacks) on_event(event)
			})
		},
		() => {
			dispatch_connections(() => {
				for (const callbacks of connections_watchers.values()) {
					for (const on_event of callbacks) on_event({ upserted: [], deleted: [], resync: true })
				}
			})
		},
	)

	// entries: the handler turns a row change into a path-level WatchEvent
	// once — own-echo check included — and every watcher filters it by its
	// own folder scope
	const entries_watchers = new Set<(event: WatchEvent) => void>()
	const entries_channel = shared_postgres_channel(
		"entries",
		"entries",
		() => entries_watchers.size > 0,
		(payload) => {
			const new_row = payload.new as Partial<EntryRow>
			const old_row = payload.old as Partial<EntryRow>
			// own changes were already applied locally — ignore the echo.
			// Per-instance tracking, not updated_by: the same account may
			// be active on several devices, and their events must flow
			if (consume_own_echo(new_row.id ?? old_row.id)) return

			let event: WatchEvent | null = null
			if (payload.eventType === "INSERT" && new_row.path) {
				event = { kind: "create", ids: [new_row.path] }
			} else if (payload.eventType === "DELETE") {
				// Hard delete (pg_cron, trash purge). Under RLS Realtime
				// trims the old record to the PK, so no path arrives —
				// and none is needed: rows are hard-deleted only from
				// the trash, after their soft-delete UPDATE already
				// produced the "remove" event
				return
			} else if (payload.eventType === "UPDATE" && new_row.path) {
				const was_deleted = old_row.deleted_at != null
				const is_deleted = new_row.deleted_at != null
				if (!was_deleted && is_deleted) {
					// soft delete: entry moved to the trash
					event = { kind: "remove", ids: [new_row.path] }
				} else if (was_deleted && !is_deleted) {
					// restored from the trash
					event = { kind: "create", ids: [new_row.path] }
				} else if (!is_deleted) {
					// replica identity full: the old row is whole, so a layout-only
					// update (xattrs, a drag) is told apart from new bytes — a blob
					// replaced in place, a text save
					event =
						old_row.path && old_row.path !== new_row.path
							? { kind: "rename", ids: [old_row.path, new_row.path] }
							: {
								kind: "modify",
								ids: [new_row.path],
								content_changed: old_row.storage_key !== new_row.storage_key
									|| old_row.content_modified_at !== new_row.content_modified_at,
							}
				}
				// updates inside the trash (was && is) are ignored
			}
			if (!event) return
			for (const on_event of entries_watchers) on_event(event)
		},
		() => {
			for (const on_event of entries_watchers) on_event({ kind: "resync", ids: [] })
		},
	)

	return {
		async FolderChildren(folder_id: string): Promise<FolderChild[]> {
			const { children } = await folder_read(folder_id)
			return children.map(to_child)
		},

		async open_file(id: string) {
			const media = await get_media_src_impl(id, undefined, true)
			window.open(media.url, "_blank", "noopener")
		},

		async create_folder(folder_id: string, folder_name: string, options?: CreateFolderOptions) {
			const folder = await resolve(folder_id)
			const id = crypto.randomUUID()
			mark_write(id)
			const { data, error } = await client
				.from("entries")
				.insert({
					id,
					workspace_id,
					parent_id: folder.id,
					name: folder_name,
					kind: "folder",
					xattrs: options?.xattrs ?? {},
					updated_by_client: client_instance_id(),
				})
				.select(ENTRY_COLUMNS)
				.single()
			if (error) throw new Error(`create_folder failed: ${error.message}`)
			return to_child(data as EntryRow)
		},

		async create_text_file(folder_id: string, filename: string, options?: CreateTextFileOptions) {
			const folder = await resolve(folder_id)
			const row = await insert_text_entry(
				folder,
				filename,
				mime_from_name(filename),
				options?.content ?? "",
				options?.xattrs,
			)
			return to_child(row)
		},

		async read_text_file(id: string) {
			const row = await resolve(id)
			if (row.storage_key !== null) {
				throw new Error(`not a text file: ${id}`)
			}
			const content = await read_content(row.id)
			if (content === null) {
				throw new Error(`not a text file: ${id}`)
			}
			return content
		},

		async get_media_src(id: string, media_options?: { mimeType?: string; original?: boolean }) {
			return get_media_src_impl(id, media_options?.mimeType, false, media_options?.original)
		},

		async save_text_file(id: string, content: string) {
			const bytes = new TextEncoder().encode(content).length
			if (bytes > MAX_TEXT_CONTENT_BYTES) {
				throw new Error(
					`file too large for text storage: ${bytes} bytes (limit ${MAX_TEXT_CONTENT_BYTES})`,
				)
			}
			const row = await resolve(id)
			mark_write(row.id)
			const { error } = await client.from("entry_contents").upsert({
				entry_id: row.id,
				workspace_id,
				content,
				updated_by_client: client_instance_id(),
			})
			if (error) {
				const limit = parse_plan_limit_error(error)
				if (limit) throw new PlanLimitError(limit, error.message)
				throw new Error(`save_text_file failed: ${error.message}`)
			}
		},

		async upload_file(folder_id: string, filename: string, data: Blob, mime?: string, onProgress?: UploadProgressCallback) {
			return upload_file_impl(folder_id, filename, data, mime, onProgress)
		},

		replace_file,

		async rename(id: string, new_name: string) {
			const row = await resolve(id)
			mark_write(row.id)
			const patch = await call_entry_rpc("rename_entry", {
				p_entry: row.id,
				p_new_name: new_name,
				p_client_id: client_instance_id(),
			})
			return { id: patch.path, name: patch.name }
		},

		async move(id: string, target_folder_id: string, new_name?: string) {
			const row = await resolve(id)
			const target = await resolve(target_folder_id)
			mark_write(row.id)
			const patch = await call_entry_rpc("move_entry", {
				p_entry: row.id,
				p_target_folder: target.id,
				p_new_name: new_name ?? null,
				p_client_id: client_instance_id(),
			})
			return { id: patch.path, name: patch.name }
		},

		// copy_file and copy_entry share one RPC in the cloud: xattrs are always copied
		async copy_file(source_path: string, target_folder_id: string, new_name?: string) {
			return copy_entry_impl(source_path, target_folder_id, new_name)
		},

		async copy_entry(source_path: string, target_folder_id: string, new_name?: string) {
			return copy_entry_impl(source_path, target_folder_id, new_name)
		},

		// soft delete: the entry and its whole subtree get deleted_at (trash).
		// hard delete is done by pg_cron after 30 days; B2 blobs are removed
		// by the backend GC worker via the blob_deletions queue
		async remove(id: string) {
			const row = await resolve(id)
			mark_write(row.id)
			const { error } = await client.rpc("delete_entry", {
				p_entry: row.id,
				p_client_id: client_instance_id(),
			})
			if (error) throw new Error(`remove failed: ${error.message}`)
		},

		// a server-side jsonb merge (rpc.sql merge_entry_xattrs): two clients
		// writing different keys of one entry no longer clobber each other
		async set_xattr(id: string, name: string, value: string) {
			const row = await resolve(id)
			mark_write(row.id)
			const [refused] = await merge_xattrs([{ path: row.path, xattrs: { [name]: value } }])
			if (refused) {
				throw new Error(
					refused.status === "too_large"
						? `set_xattr failed: attributes of ${id} exceed the 64 KB limit`
						: `set_xattr failed: entry not found: ${id}`,
				)
			}
		},

		// Bulk layout writes (the cloud bridge, a pack import) land in a
		// workspace this instance does not watch, so they skip echo marking:
		// a watching store would only refetch
		async set_xattrs(items) {
			const missing: string[] = []
			for (let start = 0; start < items.length; start += XATTRS_BATCH_SIZE) {
				const refused = await merge_xattrs(
					items
						.slice(start, start + XATTRS_BATCH_SIZE)
						.map((item) => ({ path: item.id, xattrs: item.xattrs })),
				)
				missing.push(...refused.map((row) => row.path))
			}
			return { missing }
		},

		// text payloads are mirrored into size_bytes by entry_contents_touch
		async entry_size(id: string) {
			return (await resolve(id)).size_bytes ?? 0
		},

		async get_xattr(id: string, name: string) {
			const row = await resolve(id)
			return row.xattrs[name] ?? null
		},

		async remove_xattr(id: string, name: string) {
			const row = await resolve(id)
			mark_write(row.id)
			const xattrs = { ...row.xattrs }
			delete xattrs[name]
			const { error } = await client
				.from("entries")
				.update({ xattrs, updated_by_client: client_instance_id() })
				.eq("id", row.id)
			if (error) throw new Error(`remove_xattr failed: ${error.message}`)
		},

		async list_xattrs(id: string) {
			const row = await resolve(id)
			return record_to_xattrs(row.xattrs)
		},

		async folder_with_children_xattrs(id: string): Promise<FolderWithChildrenXattrs> {
			const { folder, children } = await folder_read(id)
			return {
				id: folder.path,
				name: folder.name,
				type: "folder",
				xattrs: record_to_xattrs(folder.xattrs),
				children: children.map((row) => ({
					id: row.path,
					name: row.name,
					type: row.kind,
					xattrs: record_to_xattrs(row.xattrs),
				})),
			}
		},

		strokes: {
			async list_strokes(folder_id: string): Promise<FolderStroke[]> {
				const row = await resolve(folder_id)
				const { data, error } = await client
					.from("folder_strokes")
					.select(STROKE_COLUMNS)
					.eq("entry_id", row.id)
					.order("z", { ascending: true })
				if (error) throw new Error(`list_strokes failed: ${error.message}`)
				return (data as StrokeRow[]).map(row_to_stroke)
			},

			async upsert_strokes(folder_id: string, strokes: FolderStroke[]) {
				if (strokes.length === 0) return
				const row = await resolve(folder_id)
				for (const stroke of strokes) mark_write(stroke.id)
				const { error } = await client.from("folder_strokes").upsert(
					strokes.map((stroke) => ({
						id: stroke.id,
						entry_id: row.id,
						workspace_id,
						z: stroke.z,
						position: stroke.position,
						points: stroke.points,
						color: stroke.color,
						stroke_width: stroke.stroke_width,
						width: stroke.width,
						height: stroke.height,
						updated_by_client: client_instance_id(),
					})),
				)
				if (error) throw new Error(`upsert_strokes failed: ${error.message}`)
			},

			async delete_strokes(folder_id: string, stroke_ids: string[]) {
				if (stroke_ids.length === 0) return
				const row = await resolve(folder_id)
				for (const id of stroke_ids) mark_write(id)
				const { error } = await client
					.from("folder_strokes")
					.delete()
					.eq("entry_id", row.id)
					.in("id", stroke_ids)
				if (error) throw new Error(`delete_strokes failed: ${error.message}`)
			},

			async watch_strokes(folder_id, on_event) {
				const row = await resolve(folder_id)
				let callbacks = strokes_watchers.get(row.id)
				if (!callbacks) {
					callbacks = new Set()
					strokes_watchers.set(row.id, callbacks)
				}
				callbacks.add(on_event)
				try {
					await strokes_channel.ensure()
				} catch (error) {
					callbacks.delete(on_event)
					if (callbacks.size === 0) strokes_watchers.delete(row.id)
					throw error
				}
				return () => {
					const current = strokes_watchers.get(row.id)
					current?.delete(on_event)
					if (current?.size === 0) strokes_watchers.delete(row.id)
					void strokes_channel.release_if_idle()
				}
			},
		},

		connections: {
			async list_connections(folder_id: string): Promise<FolderConnection[]> {
				const row = await resolve(folder_id)
				const { data, error } = await client
					.from("folder_connections")
					.select(CONNECTION_COLUMNS)
					.eq("entry_id", row.id)
				if (error) throw new Error(`list_connections failed: ${error.message}`)
				const rows = data as ConnectionRow[]
				// Replace the snapshot's mapping; stale entries would grow on every
				// missed DELETE followed by a reconnect/list.
				for (const [key, record] of connection_records) {
					if (record.entry_id === row.id) connection_records.delete(key)
				}
				for (const connection of rows) remember_connection(connection)
				const paths = await paths_for_entry_ids(
					rows.flatMap((connection) => [connection.from_entry, connection.to_entry]),
				)
				return rows
					.map((connection) => connection_with_paths(connection, paths))
					.filter((connection) => connection !== null)
			},

			async upsert_connections(folder_id: string, connections: FolderConnection[]) {
				if (connections.length === 0) return
				const row = await resolve(folder_id)
				const endpoint_ids = await entry_ids_for_paths(
					connections.flatMap((connection) => [connection.from, connection.to]),
				)
				for (const connection of connections) mark_write(connection.id)
				const { error } = await client.from("folder_connections").upsert(
					connections.map((connection) => ({
						id: connection.id,
						entry_id: row.id,
						workspace_id,
						from_entry: endpoint_ids.get(connection.from)!,
						to_entry: endpoint_ids.get(connection.to)!,
						props: connection_props(connection),
						updated_by_client: client_instance_id(),
					})),
					{ onConflict: "workspace_id,id" },
				)
				if (error) throw new Error(`upsert_connections failed: ${error.message}`)
			},

			async delete_connections(folder_id: string, connection_ids: string[]) {
				if (connection_ids.length === 0) return
				const row = await resolve(folder_id)
				for (const id of connection_ids) mark_write(id)
				const { error } = await client
					.from("folder_connections")
					.delete()
					.eq("entry_id", row.id)
					.in("id", connection_ids)
				if (error) throw new Error(`delete_connections failed: ${error.message}`)
			},

			async watch_connections(folder_id, on_event) {
				const row = await resolve(folder_id)
				let callbacks = connections_watchers.get(row.id)
				if (!callbacks) {
					callbacks = new Set()
					connections_watchers.set(row.id, callbacks)
				}
				callbacks.add(on_event)
				try {
					await connections_channel.ensure()
				} catch (error) {
					callbacks.delete(on_event)
					if (callbacks.size === 0) connections_watchers.delete(row.id)
					throw error
				}
				return () => {
					const current = connections_watchers.get(row.id)
					current?.delete(on_event)
					if (current?.size === 0) connections_watchers.delete(row.id)
					void connections_channel.release_if_idle()
				}
			},
		},

		async watch(folder_id, on_event, watch_options) {
			const recursive = watch_options?.recursive ?? false
			const delay_ms = watch_options?.delay_ms ?? 0

			const in_scope = (path: string): boolean =>
				recursive ? is_under(path, folder_id) : parent_path(path) === folder_id

			let pending: WatchEvent[] = []
			let timer: ReturnType<typeof setTimeout> | null = null
			const emit = (event: WatchEvent) => {
				if (delay_ms <= 0) {
					on_event(event)
					return
				}
				// event storms (e.g. moving a large folder) are collapsed by debounce
				pending.push(event)
				if (timer) return
				timer = setTimeout(() => {
					const batch = pending
					pending = []
					timer = null
					for (const batched of batch) on_event(batched)
				}, delay_ms)
			}

			const watcher = (event: WatchEvent) => {
				// a resync concerns the whole watched folder, not single paths
				if (event.kind === "resync") {
					emit({ kind: "resync", ids: [folder_id] })
					return
				}
				const scoped_ids = event.ids.filter(in_scope)
				if (scoped_ids.length === 0) return
				emit({ ...event, ids: scoped_ids })
			}
			entries_watchers.add(watcher)
			try {
				await entries_channel.ensure()
			} catch (error) {
				entries_watchers.delete(watcher)
				throw error
			}

			return () => {
				if (timer) clearTimeout(timer)
				entries_watchers.delete(watcher)
				void entries_channel.release_if_idle()
			}
		},
	}
}

/** Creates a workspace with its root entry; returns the workspace_id */
export async function create_workspace(
	client: SupabaseClient,
	name: string,
): Promise<string> {
	const { data, error } = await client.rpc("create_workspace", { p_name: name })
	if (error) throw new Error(`create_workspace failed: ${error.message}`)
	return data as string
}

export type WorkspaceRole = "editor" | "viewer"

export type WorkspaceMember = {
	user_id: string
	email: string
	role: WorkspaceRole
	created_at: string
}

export type WorkspaceInvite = {
	workspace_id: string
	email: string
	role: WorkspaceRole
	invited_by: string
	created_at: string
	expires_at: string
}

export type AddWorkspaceMemberResult =
	| { kind: "member" }
	| { kind: "pending"; token: string; workspace_name: string; inviter: string }

export type WorkspaceInvitePreview = {
	workspace_id: string
	workspace_name: string
	role: WorkspaceRole
	email: string
	inviter: string
}

/** Shares a workspace by exact email (owner only). Existing user → member; otherwise pending. */
export async function add_workspace_member(
	client: SupabaseClient,
	workspace_id: string,
	email: string,
	role: WorkspaceRole,
): Promise<AddWorkspaceMemberResult> {
	const { data, error } = await client.rpc("add_workspace_member", {
		p_workspace: workspace_id,
		p_email: email,
		p_role: role,
	})
	if (error) throw new Error(`add_workspace_member failed: ${error.message}`)
	return data as AddWorkspaceMemberResult
}

/** /invite/<token> landing. Null when the invite is missing, expired, or revoked. */
export async function preview_workspace_invite(
	client: SupabaseClient,
	token: string,
): Promise<WorkspaceInvitePreview | null> {
	const { data, error } = await client.rpc("preview_workspace_invite", {
		p_token: token,
	})
	if (error) throw new Error(`preview_workspace_invite failed: ${error.message}`)
	return (data as WorkspaceInvitePreview | null) ?? null
}

/** Turns live pending invites for the caller's email into memberships. */
export async function claim_workspace_invites(client: SupabaseClient): Promise<void> {
	const { error } = await client.rpc("claim_workspace_invites")
	if (error) throw new Error(`claim_workspace_invites failed: ${error.message}`)
}

/** Members with emails for the share dialog (owner or member) */
export async function list_workspace_members(
	client: SupabaseClient,
	workspace_id: string,
): Promise<WorkspaceMember[]> {
	const { data, error } = await client.rpc("list_workspace_members", {
		p_workspace: workspace_id,
	})
	if (error) throw new Error(`list_workspace_members failed: ${error.message}`)
	return data as WorkspaceMember[]
}

export type WorkspaceAccess = "owner" | WorkspaceRole

/**
 * The caller's access level for a workspace: owner, member role, or null
 * (no access / workspace missing). Two selects; RLS allows both for
 * owners and members.
 */
export async function get_workspace_access(
	client: SupabaseClient,
	workspace_id: string,
): Promise<WorkspaceAccess | null> {
	const { data: session_data } = await client.auth.getSession()
	const user_id = session_data.session?.user.id
	if (!user_id) return null

	const { data: ws, error: ws_error } = await client
		.from("workspaces")
		.select("owner_id")
		.eq("id", workspace_id)
		.maybeSingle()
	if (ws_error) throw new Error(`get_workspace_access failed: ${ws_error.message}`)
	if (!ws) return null
	if ((ws as { owner_id: string }).owner_id === user_id) return "owner"

	const { data: member, error: member_error } = await client
		.from("workspace_members")
		.select("role")
		.eq("workspace_id", workspace_id)
		.eq("user_id", user_id)
		.maybeSingle()
	if (member_error) throw new Error(`get_workspace_access failed: ${member_error.message}`)
	return (member as { role: WorkspaceRole } | null)?.role ?? null
}

export type Profile = {
	id: string
	username: string | null
	display_name: string | null
}

/**
 * Public identity for /<username> pages. Works for anon callers: profiles
 * RLS select is `using (true)`. Null means no such user (or username unset).
 */
export async function get_profile_by_username(
	client: SupabaseClient,
	username: string,
): Promise<Profile | null> {
	const { data, error } = await client
		.from("profiles")
		.select("id, username, display_name")
		.eq("username", username)
		.maybeSingle()
	if (error) throw new Error(`get_profile_by_username failed: ${error.message}`)
	return (data as Profile | null) ?? null
}

/** Own profile (username may be null until set). Null when signed out */
export async function get_my_profile(client: SupabaseClient): Promise<Profile | null> {
	const {
		data: { session },
	} = await client.auth.getSession()
	if (!session) return null

	const { data, error } = await client
		.from("profiles")
		.select("id, username, display_name")
		.eq("id", session.user.id)
		.maybeSingle()
	if (error) throw new Error(`get_my_profile failed: ${error.message}`)
	return (data as Profile | null) ?? null
}

/**
 * Direct update — RLS profiles_update limits it to the owner and column
 * grants to username/display_name. Unique-violation errors surface with
 * Postgres' 'duplicate key' message; callers translate it for the UI
 */
export async function update_profile(
	client: SupabaseClient,
	patch: { username?: string | null; display_name?: string | null },
): Promise<Profile> {
	const {
		data: { session },
	} = await client.auth.getSession()
	if (!session) throw new Error("update_profile: no session")

	const { data, error } = await client
		.from("profiles")
		.update(patch)
		.eq("id", session.user.id)
		.select("id, username, display_name")
		.single()
	if (error) throw new Error(`update_profile failed: ${error.message}`)
	return data as Profile
}

/**
 * PostgREST returns a 1:1 embed as an object and a 1:n embed as an array.
 * hub_publications.source_workspace_id is the PK, so the workspaces join is 1:1.
 */
export function first_embed<T>(value: T | T[] | null | undefined): T | null {
	if (value == null) return null
	return Array.isArray(value) ? (value[0] ?? null) : value
}

export type PublishedWorkspace = {
	id: string
	name: string
	published_at: string | null
	/** workspaces.allow_fork — visitors may fork even when not on the Hub */
	allow_fork: boolean
	/** Hub listing of this workspace; null when not listed */
	fork: {
		allow_fork: boolean
		fork_count: number
		description: string
		preview_key: string | null
	} | null
}

/**
 * Resolves a public workspace at /<username>/<slug>. Two hops: the profile
 * gives the owner_id, then the live workspace is matched by slug + owner
 * (slugs are unique per owner, not globally). Works for anon callers: RLS
 * workspaces_select exposes is_public rows. Null means the address is free
 * or the workspace was made private. The Hub listing is embedded through
 * source_workspace_id to surface fork_count on the public page.
 */
export async function get_published_workspace(
	client: SupabaseClient,
	username: string,
	slug: string,
): Promise<PublishedWorkspace | null> {
	const profile = await get_profile_by_username(client, username)
	if (!profile) return null

	const { data, error } = await client
		.from("workspaces")
		.select(
			"id, name, published_at, allow_fork, hub_publications!source_workspace_id (allow_fork, fork_count, description, preview_key)",
		)
		.eq("owner_id", profile.id)
		.eq("slug", slug)
		.eq("is_public", true)
		.maybeSingle()
	if (error) throw new Error(`get_published_workspace failed: ${error.message}`)

	type Row = {
		id: string
		name: string
		published_at: string | null
		allow_fork: boolean
		hub_publications:
			| { allow_fork: boolean; fork_count: number; description: string; preview_key: string | null }
			| { allow_fork: boolean; fork_count: number; description: string; preview_key: string | null }[]
			| null
	}
	const row = data as unknown as Row | null
	if (!row) return null
	return {
		id: row.id,
		name: row.name,
		published_at: row.published_at,
		allow_fork: row.allow_fork,
		fork: first_embed(row.hub_publications),
	}
}

/** A Hub-listed public workspace — for the /<username> showcase */
export type UserPublication = {
	id: string
	slug: string
	name: string
	published_at: string | null
	hub: {
		description: string
		tags: string[]
		allow_fork: boolean
		fork_count: number
		preview_key: string | null
	} | null
}

/**
 * Hub-listed public workspaces of a user (the /<username> showcase).
 * Unlisted public boards are omitted; their /<username>/<slug> link still works.
 */
export async function list_user_publications(
	client: SupabaseClient,
	owner_id: string,
): Promise<UserPublication[]> {
	const { data, error } = await client
		.from("workspaces")
		.select(
			"id, slug, name, published_at, hub_publications!source_workspace_id!inner (description, tags, allow_fork, fork_count, preview_key, hidden_at)",
		)
		.eq("owner_id", owner_id)
		.eq("is_public", true)
		.is("hub_publications.hidden_at", null)
		.order("published_at", { ascending: false })
	if (error) throw new Error(`list_user_publications failed: ${error.message}`)

	type Row = {
		id: string
		slug: string
		name: string
		published_at: string | null
		hub_publications:
			| { description: string; tags: string[]; allow_fork: boolean; fork_count: number; preview_key: string | null }
			| { description: string; tags: string[]; allow_fork: boolean; fork_count: number; preview_key: string | null }[]
			| null
	}
	return ((data ?? []) as unknown as Row[]).map(row => ({
		id: row.id,
		slug: row.slug,
		name: row.name,
		published_at: row.published_at,
		hub: first_embed(row.hub_publications),
	}))
}

/** Default Hub page size (RPC clamp is 1–48). */
export const HUB_PAGE_SIZE = 24

export type HubPage<T> = {
	items: T[]
	total: number
}

export type HubListOptions = {
	query?: string
	limit?: number
	offset?: number
}

/** A card in the /hub gallery */
export type HubPublication = {
	workspace_id: string
	slug: string
	name: string
	description: string
	tags: string[]
	listed_at: string
	username: string
	display_name: string | null
	allow_fork: boolean
	fork_count: number
	preview_key: string | null
}

export type HubAuthor = {
	username: string
	display_name: string | null
	publication_count: number
}

export type HubTag = {
	name: string
	count: number
}

function hub_list_args(opts?: HubListOptions) {
	return {
		p_query: opts?.query ?? "",
		p_limit: opts?.limit ?? HUB_PAGE_SIZE,
		p_offset: opts?.offset ?? 0,
	}
}

function hub_page<Row extends { total: number | string }, T>(
	rows: Row[] | null,
	item: (row: Row) => T,
): HubPage<T> {
	const list = rows ?? []
	return {
		items: list.map(item),
		total: Number(list[0]?.total ?? 0),
	}
}

/**
 * One page of the Hub gallery, newest first. Search matches workspace
 * name, description, username, and display_name. `tag` is exact
 * containment. Anon callers welcome.
 */
export async function list_hub_publications(
	client: SupabaseClient,
	opts?: HubListOptions & { tag?: string },
): Promise<HubPage<HubPublication>> {
	const { data, error } = await client.rpc("list_hub_publications", {
		...hub_list_args(opts),
		p_tag: opts?.tag ?? null,
	})
	if (error) throw new Error(`list_hub_publications failed: ${error.message}`)

	type Row = HubPublication & { total: number | string }
	return hub_page((data ?? []) as Row[], row => ({
		workspace_id: row.workspace_id,
		slug: row.slug,
		name: row.name,
		description: row.description,
		tags: row.tags,
		listed_at: row.listed_at,
		username: row.username,
		display_name: row.display_name,
		allow_fork: row.allow_fork,
		fork_count: Number(row.fork_count),
		preview_key: row.preview_key,
	}))
}

/** One page of Hub authors, most publications first. */
export async function list_hub_authors(
	client: SupabaseClient,
	opts?: HubListOptions,
): Promise<HubPage<HubAuthor>> {
	const { data, error } = await client.rpc("list_hub_authors", hub_list_args(opts))
	if (error) throw new Error(`list_hub_authors failed: ${error.message}`)

	type Row = HubAuthor & { total: number | string }
	return hub_page((data ?? []) as Row[], row => ({
		username: row.username,
		display_name: row.display_name,
		publication_count: Number(row.publication_count),
	}))
}

/** One page of Hub tags, most used first. */
export async function list_hub_tags(
	client: SupabaseClient,
	opts?: HubListOptions,
): Promise<HubPage<HubTag>> {
	const { data, error } = await client.rpc("list_hub_tags", hub_list_args(opts))
	if (error) throw new Error(`list_hub_tags failed: ${error.message}`)

	type Row = { name: string; tag_count: number | string; total: number | string }
	return hub_page((data ?? []) as Row[], row => ({
		name: row.name,
		count: Number(row.tag_count),
	}))
}

/**
 * Upserts the Hub listing of an already-public workspace (owner only).
 * allow_fork is written to both the listing and the workspace row
 */
export async function set_hub_listing(
	client: SupabaseClient,
	workspace_id: string,
	description: string,
	tags: string[],
	allow_fork: boolean,
	preview_key: string | null = null,
): Promise<void> {
	const { error } = await client.rpc("set_hub_listing", {
		p_workspace: workspace_id,
		p_description: description,
		p_tags: tags,
		p_allow_fork: allow_fork,
		p_preview_key: preview_key,
	})
	if (error) {
		const limit = parse_plan_limit_error(error)
		if (limit) throw new PlanLimitError(limit, error.message)
		throw new Error(`set_hub_listing failed: ${error.message}`)
	}
}

/** Removes a workspace from the Hub gallery (owner only) */
export async function remove_from_hub(
	client: SupabaseClient,
	workspace_id: string,
): Promise<void> {
	const { error } = await client.rpc("remove_from_hub", { p_workspace: workspace_id })
	if (error) throw new Error(`remove_from_hub failed: ${error.message}`)
}

/** Authenticated visitor report of a public board. One per user per workspace. */
export async function report_hub_listing(
	client: SupabaseClient,
	workspace_id: string,
	reason: string,
): Promise<void> {
	const { error } = await client.rpc("report_hub_listing", {
		p_workspace: workspace_id,
		p_reason: reason,
	})
	if (error) throw new Error(`report_hub_listing failed: ${error.message}`)
}

/** Whether the current user already reported this workspace. */
export async function hub_listing_reported(
	client: SupabaseClient,
	workspace_id: string,
): Promise<boolean> {
	const { data, error } = await client.rpc("hub_listing_reported", {
		p_workspace: workspace_id,
	})
	if (error) throw new Error(`hub_listing_reported failed: ${error.message}`)
	return data === true
}

async function resolve_trashed(
	client: SupabaseClient,
	workspace_id: string,
	path: string,
): Promise<string> {
	const { data, error } = await client
		.from("entries")
		.select("id")
		.eq("workspace_id", workspace_id)
		.eq("path", path)
		.not("deleted_at", "is", null)
		.maybeSingle()
	if (error) throw new Error(`resolve_trashed failed: ${path} (${error.message})`)
	if (!data) throw new Error(`not found in trash: ${path}`)
	return (data as { id: string }).id
}

export type TrashEntry = {
	id: string
	path: string
	name: string
	kind: "file" | "folder"
	size_bytes: number | null
	deleted_at: string
	/** total size of the whole deleted subtree */
	subtree_bytes: number
	/** number of files in the deleted subtree */
	subtree_files: number
}

/** Top level of the trash: deleted entries whose parent is alive, with subtree aggregates */
export async function list_trash(
	client: SupabaseClient,
	workspace_id: string,
): Promise<TrashEntry[]> {
	const { data, error } = await client.rpc("list_trash", { p_workspace: workspace_id })
	if (error) throw new Error(`list_trash failed: ${error.message}`)
	return data as TrashEntry[]
}

export type WorkspaceUsage = {
	live_bytes: number
	trash_bytes: number
	live_files: number
	trash_files: number
}

/**
 * Space accounting for quotas. The trash counts (blobs in B2 live until
 * hard delete): quota usage = live_bytes + trash_bytes
 */
export async function workspace_usage(
	client: SupabaseClient,
	workspace_id: string,
): Promise<WorkspaceUsage> {
	const { data, error } = await client.rpc("workspace_usage", { p_workspace: workspace_id })
	if (error) throw new Error(`workspace_usage failed: ${error.message}`)
	const row = (data as WorkspaceUsage[])[0]
	if (!row) throw new Error("workspace_usage returned no rows")
	return row
}

export type OwnerUsage = {
	used_bytes: number
	live_bytes: number
	trash_bytes: number
}

/** Owner-level usage (all workspaces, including system + trash). */
export async function owner_usage(client: SupabaseClient): Promise<OwnerUsage> {
	const { data, error } = await client.rpc("owner_usage")
	if (error) throw new Error(`owner_usage failed: ${error.message}`)
	const row = (data as OwnerUsage[])[0]
	if (!row) throw new Error("owner_usage returned no rows")
	return row
}

export type BillingAccount = {
	owner_id: string
	plan: string
	plan_status: string
	quota_bytes: number
	max_file_bytes: number
	max_hub_listings: number | null
	grace_until: string | null
	external_subscription_id: string | null
}

export async function get_billing_account(client: SupabaseClient): Promise<BillingAccount | null> {
	const { data, error } = await client
		.from("billing_accounts")
		.select(
			"owner_id, plan, plan_status, quota_bytes, max_file_bytes, max_hub_listings, grace_until, external_subscription_id",
		)
		.maybeSingle()
	if (error) throw new Error(`get_billing_account failed: ${error.message}`)
	return (data as BillingAccount | null) ?? null
}

export type QuotaWallEventInput = {
	kind: "quota" | "file_size" | "hub_limit"
	used_bytes?: number | null
	quota_bytes?: number | null
	file_bytes?: number | null
	file_mime?: string | null
	needed_bytes?: number | null
	answer?: string | null
}

export async function record_quota_wall_event(
	client: SupabaseClient,
	owner_id: string,
	input: QuotaWallEventInput,
): Promise<string> {
	const { data, error } = await client
		.from("quota_wall_events")
		.insert({
			owner_id,
			kind: input.kind,
			used_bytes: input.used_bytes ?? null,
			quota_bytes: input.quota_bytes ?? null,
			file_bytes: input.file_bytes ?? null,
			file_mime: input.file_mime ?? null,
			needed_bytes: input.needed_bytes ?? null,
			answer: input.answer ?? null,
		})
		.select("id")
		.single()
	if (error) throw new Error(`record_quota_wall_event failed: ${error.message}`)
	return (data as { id: string }).id
}

export async function update_quota_wall_event(
	client: SupabaseClient,
	event_id: string,
	answer: string,
): Promise<void> {
	const { error } = await client
		.from("quota_wall_events")
		.update({ answer })
		.eq("id", event_id)
	if (error) throw new Error(`update_quota_wall_event failed: ${error.message}`)
}

export type PlanLimits = {
	quota_bytes: number
	max_file_bytes: number
}

/** Storage numbers of a plan (private.plan_defaults), to show what it would give. */
export async function get_plan_limits(client: SupabaseClient, plan: string): Promise<PlanLimits | null> {
	const { data, error } = await client.rpc("plan_limits", { p_plan: plan })
	if (error) throw new Error(`plan_limits failed: ${error.message}`)
	const row = (data as { quota_bytes: number | string; max_file_bytes: number | string }[] | null)?.[0]
	return row ? { quota_bytes: Number(row.quota_bytes), max_file_bytes: Number(row.max_file_bytes) } : null
}

export type BridgeEventInput = {
	step:
		| "opened"
		| "preflight"
		| "wall_shown"
		| "pro_clicked"
		| "started"
		| "resumed"
		| "completed"
		| "failed"
		| "cancelled"
	door: "share" | "publish" | "device" | "list" | "tile" | "pile" | "sync"
	source_type: "local" | "browser"
	workspace_id?: string | null
	total_bytes?: number | null
	file_count?: number | null
	largest_file_bytes?: number | null
	largest_file_mime?: string | null
	bytes_by_kind?: Record<string, number> | null
	used_bytes?: number | null
	quota_bytes?: number | null
	max_file_bytes?: number | null
	excluded_files?: number | null
	answer?: string | null
}

/** One step of the local → cloud bridge funnel (bridge_events). */
export async function record_bridge_event(
	client: SupabaseClient,
	owner_id: string,
	input: BridgeEventInput,
): Promise<void> {
	const { error } = await client.from("bridge_events").insert({
		owner_id,
		step: input.step,
		door: input.door,
		source_type: input.source_type,
		workspace_id: input.workspace_id ?? null,
		total_bytes: input.total_bytes ?? null,
		file_count: input.file_count ?? null,
		largest_file_bytes: input.largest_file_bytes ?? null,
		largest_file_mime: input.largest_file_mime ?? null,
		bytes_by_kind: input.bytes_by_kind ?? null,
		used_bytes: input.used_bytes ?? null,
		quota_bytes: input.quota_bytes ?? null,
		max_file_bytes: input.max_file_bytes ?? null,
		excluded_files: input.excluded_files ?? null,
		answer: input.answer ?? null,
	})
	if (error) throw new Error(`record_bridge_event failed: ${error.message}`)
}

/**
 * Restores an entry (and its whole subtree) from the trash by path.
 * The RPC refuses if the parent is in the trash; a name taken by a live
 * sibling is auto-renamed to "name (n)" (same rule as resolve_unique_filename).
 */
export async function restore_entry(
	client: SupabaseClient,
	workspace_id: string,
	path: string,
): Promise<void> {
	const entry_id = await resolve_trashed(client, workspace_id, path)
	const { error } = await client.rpc("restore_entry", {
		p_entry: entry_id,
		p_client_id: client_instance_id(),
	})
	if (error) throw new Error(`restore_entry failed: ${error.message}`)
}

/**
 * Hard-deletes one trash entry (and its subtree) by path. B2 blobs are
 * removed by the backend GC worker via the blob_deletions queue (async)
 */
export async function purge_entry(
	client: SupabaseClient,
	workspace_id: string,
	path: string,
): Promise<void> {
	const entry_id = await resolve_trashed(client, workspace_id, path)
	const { error } = await client.rpc("purge_entry", { p_entry: entry_id })
	if (error) throw new Error(`purge_entry failed: ${error.message}`)
}

/**
 * Hard-deletes one entry by id once it is in the trash. A path can name
 * several trashed versions of a file; the local sync knows the exact row
 */
export async function purge_entry_id(client: SupabaseClient, entry_id: string): Promise<void> {
	const { error } = await client.rpc("purge_entry", { p_entry: entry_id })
	if (error) throw new Error(`purge_entry failed: ${error.message}`)
}

/** Rows of a workspace listed at once, ordered by id for stable pages */
const LIST_ENTRIES_PAGE = 1000

/**
 * Every live entry of a workspace in one paged read (root included, path
 * "/"). The local sync compares it with a folder on disk; RLS limits it to
 * workspaces the caller can read
 */
export async function list_workspace_entries(
	client: SupabaseClient,
	workspace_id: string,
): Promise<EntryRow[]> {
	const rows: EntryRow[] = []
	for (let from = 0; ; from += LIST_ENTRIES_PAGE) {
		const { data, error } = await client
			.from("entries")
			.select(ENTRY_COLUMNS)
			.eq("workspace_id", workspace_id)
			.is("deleted_at", null)
			.order("id")
			.range(from, from + LIST_ENTRIES_PAGE - 1)
		if (error) throw new Error(`list_workspace_entries failed: ${error.message}`)
		const page = (data ?? []) as EntryRow[]
		rows.push(...page)
		if (page.length < LIST_ENTRIES_PAGE) return rows
	}
}

/** Empties the trash (hard-deletes all deleted entries of the workspace) */
export async function purge_trash(
	client: SupabaseClient,
	workspace_id: string,
): Promise<void> {
	const { error } = await client.rpc("purge_trash", { p_workspace: workspace_id })
	if (error) throw new Error(`purge_trash failed: ${error.message}`)
}

/**
 * fork_workspace clones rows pointing at the SOURCE's storage_key (SQL
 * cannot reach B2); right after the RPC the backend copies every foreign
 * blob under a key of the new workspace and rewrites the rows. This call
 * is an accelerator: the backend GC sweep re-keys whatever it misses, so a
 * failure here is logged, not thrown
 */
async function copy_clone_blobs(
	client: SupabaseClient,
	backend_url: string,
	workspace_id: string,
): Promise<void> {
	try {
		const { data: session_data } = await client.auth.getSession()
		const headers: Record<string, string> = { "Content-Type": "application/json" }
		if (session_data.session) {
			headers.Authorization = `Bearer ${session_data.session.access_token}`
		}
		const response = await fetch(`${backend_url}/blobs/copy-clones`, {
			method: "POST",
			headers,
			body: JSON.stringify({ workspace_id }),
		})
		if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
	} catch (err) {
		console.error("blob copy failed; the clone shares the original's blobs:", err)
	}
}

/**
 * Makes the workspace itself public at /<username>/<slug> (no snapshot
 * clone). Re-calling with a new slug changes the address.
 */
export async function set_workspace_public(
	client: SupabaseClient,
	workspace_id: string,
	slug: string,
	allow_fork = true,
): Promise<void> {
	if (!is_valid_slug(slug)) {
		throw new Error(`invalid or reserved slug: ${slug}`)
	}
	const { error } = await client.rpc("set_workspace_public", {
		p_workspace: workspace_id,
		p_slug: slug,
		p_allow_fork: allow_fork,
	})
	if (error) throw new Error(`set_workspace_public failed: ${error.message}`)
}

/** Drops the public link and any Hub listing (owner only) */
export async function set_workspace_private(
	client: SupabaseClient,
	workspace_id: string,
): Promise<void> {
	const { error } = await client.rpc("set_workspace_private", { p_workspace: workspace_id })
	if (error) throw new Error(`set_workspace_private failed: ${error.message}`)
}

/**
 * Forks a live public workspace into the caller's account as a regular
 * private workspace. Returns the new workspace id. Blobs are re-keyed
 * through /blobs/copy-clones — the forker owns the new workspace, so the
 * endpoint authorizes the copy.
 */
export async function fork_workspace(
	client: SupabaseClient,
	source_id: string,
	backend_url: string,
): Promise<string> {
	const { data, error } = await client.rpc("fork_workspace", { p_workspace: source_id })
	if (error) {
		const limit = parse_plan_limit_error(error)
		if (limit) throw new PlanLimitError(limit, error.message)
		throw new Error(`fork_workspace failed: ${error.message}`)
	}
	const workspace_id = data as string
	await copy_clone_blobs(client, backend_url, workspace_id)
	return workspace_id
}

export default createCloudFileManager
