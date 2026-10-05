import {
	createCloudFileManager,
	StorageUnreachableError,
	type FileManager,
	type PutBlob,
	type UploadProgressCallback,
} from '@pile-commander/file-manager'
import { is_desktop } from '@/isDesktop'
import { backend_url, require_supabase } from './client'

/**
 * The release desktop webview is `tauri://localhost`. Storage CORS only
 * reflects http(s) origins, so the page's own PUT never finishes. The bytes
 * go to the app process instead, as a raw body rather than a JSON array.
 */
export function uses_native_b2_put(running_in_tauri: boolean): boolean {
	return running_in_tauri
}

/** Slice size sent per IPC call: bounds memory and sets progress granularity */
const NATIVE_PUT_CHUNK_BYTES = 4 * 1024 * 1024

/** Rust's prefix for "storage was never reached" (presigned_put.rs) */
const CONNECT_FAILED = 'blob upload could not connect'

/** Waits before each new attempt after a failed connect; its length caps retries */
export const NATIVE_PUT_RETRY_DELAYS_MS = [1_000, 4_000]

function is_connect_failure(error: unknown): boolean {
	return typeof error === 'string' && error.startsWith(CONNECT_FAILED)
}

/**
 * Streams the blob to the app process slice by slice, so a multi-gigabyte
 * video is never read whole. Each chunk call returns once the previous slice
 * went to the connection, which makes it the progress signal.
 */
async function put_blob_native_once(
	url: string,
	content_type: string,
	data: Blob,
	on_progress?: UploadProgressCallback,
): Promise<void> {
	const { invoke } = await import('@tauri-apps/api/core')
	const id = await invoke<number>('put_presigned_start', {
		url,
		contentType: content_type,
		size: data.size,
	})
	try {
		on_progress?.(0, data.size)
		for (let start = 0; start < data.size; start += NATIVE_PUT_CHUNK_BYTES) {
			const end = Math.min(start + NATIVE_PUT_CHUNK_BYTES, data.size)
			const chunk = new Uint8Array(await data.slice(start, end).arrayBuffer())
			await invoke('put_presigned_chunk', chunk, { headers: { 'x-upload-id': String(id) } })
			// the full size waits for storage's answer below
			if (end < data.size) on_progress?.(end, data.size)
		}
		await invoke('put_presigned_finish', { id })
	} catch (error) {
		await invoke('put_presigned_abort', { id }).catch(() => {})
		throw error
	}
	on_progress?.(data.size, data.size)
}

/**
 * A failed connect never reached storage, so the whole PUT is started again
 * (the presigned URL outlives these waits). One network blip must not stop a
 * copy of hundreds of files. Still unreachable after the last wait, it is
 * reported as such; any other failure is reported as is.
 */
export async function put_blob_native(
	url: string,
	content_type: string,
	data: Blob,
	on_progress?: UploadProgressCallback,
): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await put_blob_native_once(url, content_type, data, on_progress)
		} catch (error) {
			if (!is_connect_failure(error)) throw error
			const delay = NATIVE_PUT_RETRY_DELAYS_MS[attempt]
			if (delay === undefined) throw new StorageUnreachableError(error)
			await new Promise(resolve => setTimeout(resolve, delay))
		}
	}
}

/** The PUT every presigned storage upload in this app goes through */
export const app_put_blob: PutBlob | undefined = uses_native_b2_put(is_desktop) ? put_blob_native : undefined

export function create_app_cloud_file_manager(workspace_id: string): FileManager {
	return createCloudFileManager({
		client: require_supabase(),
		workspace_id,
		backend_url,
		put_blob: app_put_blob,
	})
}
