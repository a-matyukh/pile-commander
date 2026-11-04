import { open } from '@tauri-apps/plugin-dialog'
import { readFile, stat } from '@tauri-apps/plugin-fs'
import { cloud_trace, pile_image_hash8, pile_image_token, type PileImageRole } from '@pile-commander/file-manager'
import type { WorkspaceStore } from '@/domain/Store'
import { is_desktop } from '@/isDesktop'
import { t } from '@/i18n'
import { report_error } from '@/store/helpers/reportError'
import { track_unsaved_write } from './xattrs'
import { pile_cache_key, seed_pile_url } from './pileImageCache'
import { begin_pile_image, end_pile_image } from './pileImageUpload'

/** The file the person picks may be this large. What we store is a resized webp. */
export const PILE_IMAGE_INPUT_LIMIT = 8 * 1024 * 1024
const PILE_IMAGE_MAX_EDGE = 2048

const IMAGE_FILTER = {
	name: 'Image',
	extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
}

function mime_of(path: string): string {
	const ext = path.split('.').pop()?.toLowerCase()
	if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
	if (ext === 'webp') return 'image/webp'
	if (ext === 'gif') return 'image/gif'
	return 'image/png'
}

/** Longest side about 2048px, encoded as webp. Gif animation does not survive. */
export async function encode_pile_image(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
	const copy = new Uint8Array(bytes.byteLength)
	copy.set(bytes)
	const blob = new Blob([copy], { type: mime })
	const bitmap = await createImageBitmap(blob)
	try {
		const longest = Math.max(bitmap.width, bitmap.height)
		const scale = longest > PILE_IMAGE_MAX_EDGE ? PILE_IMAGE_MAX_EDGE / longest : 1
		const width = Math.max(1, Math.round(bitmap.width * scale))
		const height = Math.max(1, Math.round(bitmap.height * scale))
		const canvas = document.createElement('canvas')
		canvas.width = width
		canvas.height = height
		const context = canvas.getContext('2d')
		if (!context) throw new Error('Could not draw the picture')
		context.drawImage(bitmap, 0, 0, width, height)
		const encoded = await new Promise<Blob | null>(resolve => {
			canvas.toBlob(resolve, 'image/webp', 0.85)
		})
		if (!encoded) throw new Error('Could not encode the picture')
		return new Uint8Array(await encoded.arrayBuffer())
	} finally {
		bitmap.close()
	}
}

type PickedImage = { bytes: Uint8Array; mime: string; size: number }

async function pick_desktop_image(): Promise<PickedImage | null> {
	const picked = await open({ multiple: false, filters: [IMAGE_FILTER] })
	const path = Array.isArray(picked) ? picked[0] : picked
	if (!path) return null
	const info = await stat(path)
	return { bytes: await readFile(path), mime: mime_of(path), size: info.size }
}

/** The browser's own file input. The desktop app keeps the system dialog. */
function pick_web_image(): Promise<PickedImage | null> {
	return new Promise(resolve => {
		const input = document.createElement('input')
		input.type = 'file'
		input.accept = 'image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif'
		let settled = false
		const finish = (file: File | null) => {
			if (settled) return
			settled = true
			if (!file) { resolve(null); return }
			void file.arrayBuffer().then(buffer => {
				resolve({ bytes: new Uint8Array(buffer), mime: file.type || mime_of(file.name), size: file.size })
			}, () => resolve(null))
		}
		input.addEventListener('change', () => finish(input.files?.[0] ?? null))
		input.addEventListener('cancel', () => finish(null))
		// A cancel does not always emit `cancel`. Focus returns either way,
		// and a chosen file has already fired `change` by then.
		window.addEventListener('focus', () => {
			setTimeout(() => finish(input.files?.[0] ?? null), 500)
		}, { once: true })
		input.click()
	})
}

/** A picture picked and encoded: its token, known before the upload, and the upload in flight */
export type PickedPicture = {
	token: string
	/** True once the file is in the folder's `.pile`; false when it failed (the error is reported) */
	upload: Promise<boolean>
}

/**
 * A file dialog, then a resized webp. The token comes from the bytes, so it
 * is known at once: the bytes are seeded into the picture cache (shown
 * without a download) and the upload into the folder's `.pile` starts in the
 * background. Null when the person cancels or the file is unusable.
 * The "uploading" mark is on from the encode; whoever applies the token ends it.
 */
export async function choose_pile_image(
	store: WorkspaceStore,
	folder_id: string,
	role: PileImageRole,
): Promise<PickedPicture | null> {
	let busy = false
	try {
		const picked = is_desktop ? await pick_desktop_image() : await pick_web_image()
		if (!picked) return null
		if (picked.size > PILE_IMAGE_INPUT_LIMIT) {
			report_error(store, new Error(t('style.picture_too_large')))
			return null
		}
		begin_pile_image(store.uid, folder_id, role)
		busy = true
		const trace = cloud_trace(`encode ${role}`)
		trace.note('in', picked.size)
		const webp = await trace.step('encode', () => encode_pile_image(picked.bytes, picked.mime))
		trace.note('out', webp.byteLength)
		trace.end()
		const token = pile_image_token(role, await pile_image_hash8(webp))
		// Seeded before anything shows the token: a download for it would make the seed a no-op
		seed_pile_url(pile_cache_key(store.uid, folder_id, token), webp)
		const uploaded = track_unsaved_write()
		const upload = store.file_manager.write_pile_image(folder_id, role, webp).then(
			(written) => {
				if (written !== token) throw new Error(`The picture was stored as ${written}, not ${token}`)
				return true
			},
		).catch((error: unknown) => {
			report_error(store, error)
			return false
		}).finally(uploaded)
		return { token, upload }
	} catch (error) {
		if (busy) end_pile_image(store.uid, folder_id, role)
		report_error(store, error)
		return null
	}
}

/**
 * Picks a picture and puts it in place at once (`apply` shows the token and
 * writes it after the upload). Resolves true once it is on screen, while the
 * upload and the attribute go on in the background with the "uploading" mark
 */
export async function set_pile_image(
	store: WorkspaceStore,
	folder_id: string,
	role: PileImageRole,
	apply: (token: string, after: Promise<boolean>) => Promise<void>,
): Promise<boolean> {
	const picked = await choose_pile_image(store, folder_id, role)
	if (!picked) return false
	void apply(picked.token, picked.upload)
		.catch((error: unknown) => { report_error(store, error) })
		.finally(() => { end_pile_image(store.uid, folder_id, role) })
	return true
}
