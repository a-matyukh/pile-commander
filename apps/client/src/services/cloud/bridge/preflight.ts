import type { FileManager } from '@pile-commander/file-manager'
import { MAX_TEXT_CONTENT_BYTES, PILE_DIR_NAME, is_text_mime } from '@pile-commander/file-manager'
import { get_file_extension, get_media_kind } from '@/services/board/media'
import { upload_mime } from '@/services/workspace/entryBytes'
import { run_pool } from './pool'

export type BridgeFileKind = 'image' | 'video' | 'audio' | 'text' | 'other'

export type BridgeFile = {
	/** Source id: the source file manager's absolute path. */
	id: string
	/** Path under the source root, '/'-separated; the cloud path is '/' + this. */
	relative: string
	name: string
	size_bytes: number
	mime: string
	kind: BridgeFileKind
	/** Over the plan's per-file limit: cannot be copied on this plan. */
	over_file_limit: boolean
	/** The cloud refuses the name (or a parent folder's name). */
	bad_name: boolean
	/** Text over the cloud text column limit: uploaded as a binary file. */
	text_as_blob: boolean
}

export type BridgeLimits = {
	quota_bytes: number
	used_bytes: number
	max_file_bytes: number
}

export type BridgePreflight = {
	/** Folders under the root, parents before children ('/'-separated relative paths). */
	folders: string[]
	files: BridgeFile[]
	total_bytes: number
	largest: BridgeFile | null
	bytes_by_kind: Record<BridgeFileKind, number>
	limits: BridgeLimits
	/** Quota left before the copy. */
	free_bytes: number
	/** Files that cannot go up on this plan whatever else is left out. */
	blocked: BridgeFile[]
	/** Everything together does not fit into the free quota. */
	over_quota: boolean
	/** Default exclusion: blocked files, then the largest until the rest fits. */
	suggested_exclude: string[]
}

/** OS litter that never belongs in a workspace. */
const JUNK_NAMES = new Set(['.DS_Store', 'Thumbs.db'])

const TEXT_EXTENSIONS = new Set([
	'.md',
	'.markdown',
	'.txt',
	'.json',
	'.csv',
	'.svg',
	'.html',
	'.htm',
	'.css',
	'.js',
	'.ts',
	'.yaml',
	'.yml',
	'.xml',
])

/** Entry sizes read at once: a local stat is one IPC call each. */
const SIZE_CONCURRENCY = 8

export function file_kind(name: string): BridgeFileKind {
	const media = get_media_kind(name)
	if (media === 'image' || media === 'video' || media === 'audio') return media
	return TEXT_EXTENSIONS.has(get_file_extension(name)) ? 'text' : 'other'
}

/** Mirrors entries_name_check (schema.sql): no control characters, at most 255 characters. */
export function is_cloud_name(name: string): boolean {
	return name !== ''
		&& name !== '.'
		&& name !== '..'
		&& !name.includes('/')
		// eslint-disable-next-line no-control-regex
		&& !/[\x01-\x1f\x7f]/.test(name)
		&& [...name].length <= 255
}

export function is_blocked(file: BridgeFile): boolean {
	return file.over_file_limit || file.bad_name
}

/** Bytes that go up when the `exclude` paths are left out. */
export function selected_bytes(files: readonly BridgeFile[], exclude: ReadonlySet<string>): number {
	let bytes = 0
	for (const file of files) {
		if (!exclude.has(file.relative)) bytes += file.size_bytes
	}
	return bytes
}

/**
 * Walks a local workspace and measures what a cloud copy takes: sizes, kinds,
 * the files the plan or the cloud refuses, and a default set to leave out.
 * `.pile` sidecars and OS litter are skipped.
 */
export async function preflight_tree(
	fm: FileManager,
	root: string,
	limits: BridgeLimits,
): Promise<BridgePreflight> {
	const folders: string[] = []
	const found: { id: string; relative: string; name: string; bad_name: boolean }[] = []

	// breadth-first, so folders come out parents before children. A folder
	// the cloud cannot name takes its whole subtree out with it
	const queue: { id: string; relative: string; bad_name: boolean }[] = [
		{ id: root, relative: '', bad_name: false },
	]
	for (let index = 0; index < queue.length; index++) {
		const folder = queue[index]!
		for (const child of await fm.FolderChildren(folder.id)) {
			if (child.name === PILE_DIR_NAME || JUNK_NAMES.has(child.name)) continue
			const relative = folder.relative ? `${folder.relative}/${child.name}` : child.name
			const bad_name = folder.bad_name || !is_cloud_name(child.name)
			if (child.type === 'folder') {
				if (!bad_name) folders.push(relative)
				queue.push({ id: child.id, relative, bad_name })
			} else {
				found.push({ id: child.id, relative, name: child.name, bad_name })
			}
		}
	}

	const sizes = new Map<string, number>()
	await run_pool(found, SIZE_CONCURRENCY, async (file) => {
		sizes.set(file.id, await fm.entry_size(file.id))
	})

	const files = found.map((file): BridgeFile => {
		const size_bytes = sizes.get(file.id) ?? 0
		const mime = upload_mime(file.name)
		return {
			id: file.id,
			relative: file.relative,
			name: file.name,
			size_bytes,
			mime,
			kind: file_kind(file.name),
			over_file_limit: size_bytes > limits.max_file_bytes,
			bad_name: file.bad_name,
			text_as_blob: is_text_mime(mime) && size_bytes > MAX_TEXT_CONTENT_BYTES,
		}
	})

	const bytes_by_kind: Record<BridgeFileKind, number> = { image: 0, video: 0, audio: 0, text: 0, other: 0 }
	let total_bytes = 0
	let largest: BridgeFile | null = null
	for (const file of files) {
		total_bytes += file.size_bytes
		bytes_by_kind[file.kind] += file.size_bytes
		if (!largest || file.size_bytes > largest.size_bytes) largest = file
	}

	const free_bytes = Math.max(0, limits.quota_bytes - limits.used_bytes)
	return {
		folders,
		files,
		total_bytes,
		largest,
		bytes_by_kind,
		limits,
		free_bytes,
		blocked: files.filter(is_blocked),
		over_quota: total_bytes > free_bytes,
		suggested_exclude: suggest_exclude(files, free_bytes),
	}
}

/** Blocked files first, then the largest of the rest until what remains fits. */
export function suggest_exclude(files: readonly BridgeFile[], free_bytes: number): string[] {
	const excluded = new Set<string>()
	let remaining = 0
	for (const file of files) {
		if (is_blocked(file)) excluded.add(file.relative)
		else remaining += file.size_bytes
	}
	const by_size = files
		.filter(file => !excluded.has(file.relative))
		.sort((a, b) => b.size_bytes - a.size_bytes)
	for (const file of by_size) {
		if (remaining <= free_bytes) break
		excluded.add(file.relative)
		remaining -= file.size_bytes
	}
	return files.filter(file => excluded.has(file.relative)).map(file => file.relative)
}
