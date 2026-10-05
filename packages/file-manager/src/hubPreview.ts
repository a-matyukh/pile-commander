import type { SupabaseClient } from "@supabase/supabase-js"
import { StorageUnreachableError } from "./storageUnreachable"
import type { PutBlob } from "./types"

/** Client-side cap shown in Publish; jpeg/png/webp only */
export const HUB_PREVIEW_MAX_BYTES = 2 * 1024 * 1024

export const HUB_PREVIEW_ACCEPT = "image/jpeg,image/png,image/webp"

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
export const HUB_PREVIEW_KEY_RE = new RegExp(`^hub/${UUID}/${UUID}\\.(jpe?g|png|webp)$`, "i")

const MIME_EXT: Record<string, string> = {
	"image/jpeg": ".jpg",
	"image/png": ".png",
	"image/webp": ".webp",
}

export function is_hub_preview_key(key: string): boolean {
	return HUB_PREVIEW_KEY_RE.test(key)
}

export function hub_preview_ext(name: string, mime: string): string | null {
	if (MIME_EXT[mime]) return MIME_EXT[mime]
	const match = /\.(jpe?g|png|webp)$/i.exec(name)
	if (!match) return null
	const ext = match[1]!.toLowerCase()
	return ext === "jpeg" ? ".jpg" : `.${ext}`
}

/** Null when the file is allowed; otherwise a short reason for the dialog. */
export function hub_preview_file_error(file: { name: string; type: string; size: number }): string | null {
	if (file.size > HUB_PREVIEW_MAX_BYTES) return "file is too large (max 2 MB)"
	if (!hub_preview_ext(file.name, file.type)) return "JPEG, PNG or WebP only"
	return null
}

export function hub_preview_url(backend_url: string, key: string): string {
	const base = backend_url.replace(/\/$/, "")
	return `${base}/hub-preview?key=${encodeURIComponent(key)}`
}

/**
 * Presign → PUT to staging → finalize to an immutable key. set_hub_listing
 * accepts the returned final key, never the client's writable staging key.
 */
export async function upload_hub_preview(
	client: SupabaseClient,
	backend_url: string,
	workspace_id: string,
	file: Blob,
	filename: string,
	/** the desktop shell's native PUT; the default is the webview's fetch */
	put_blob?: PutBlob,
): Promise<string> {
	const error = hub_preview_file_error({ name: filename, type: file.type, size: file.size })
	if (error) throw new Error(error)

	const { data } = await client.auth.getSession()
	const headers: Record<string, string> = { "Content-Type": "application/json" }
	if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`
	const base = backend_url.replace(/\/$/, "")

	const presign = await fetch(`${base}/presign/hub-preview-upload`, {
		method: "POST",
		headers,
		body: JSON.stringify({ workspace_id, name: filename }),
	})
	if (!presign.ok) {
		throw new Error(`hub preview upload failed: ${presign.status} ${await presign.text()}`)
	}
	const { storage_key, url } = (await presign.json()) as { storage_key: string; url: string }

	const ext = hub_preview_ext(filename, file.type) ?? ".jpg"
	const content_type = file.type || MIME_EXT_TO_TYPE[ext] || "image/jpeg"
	if (put_blob) {
		await put_blob(url, content_type, file)
	} else {
		// fetch rejects only when no response came back at all
		const put = await fetch(url, {
			method: "PUT",
			headers: { "Content-Type": content_type },
			body: file,
		}).catch((error: unknown) => {
			throw new StorageUnreachableError(error)
		})
		if (!put.ok) throw new Error(`hub preview upload failed: ${put.status}`)
	}

	const finalize = await fetch(`${base}/hub-preview/finalize`, {
		method: "POST",
		headers,
		body: JSON.stringify({ storage_key }),
	})
	if (!finalize.ok) {
		throw new Error(`hub preview upload failed: ${finalize.status} ${await finalize.text()}`)
	}
	const result = (await finalize.json()) as { storage_key: string }
	if (!is_hub_preview_key(result.storage_key)) throw new Error("invalid finalized preview key")
	return result.storage_key
}

const MIME_EXT_TO_TYPE: Record<string, string> = {
	".jpg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp",
}
