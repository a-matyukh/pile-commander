import { useStorage } from '@vueuse/core'
import type { FolderRef } from '@/domain/Drive'
import { t } from '@/i18n'
import { path_separator } from '@/services/workspace/paths'
import cloud from '@/store/cloud'
import { BROWSER_ROOT, is_within } from './drives'
import { system_folder_name } from './folder_cover'
import { explorer_home, read_explorer_home } from './home'

read_explorer_home()

export const EXPLORER_BOOKMARKS_KEY = 'pile_commander_explorer_bookmarks'
export const EXPLORER_LAST_OPENED_KEY = 'pile_commander_explorer_last_opened'

function is_folder_ref(value: unknown): value is FolderRef {
	if (!value || typeof value !== 'object') return false
	const ref = value as FolderRef
	return typeof ref.drive_id === 'string' && ref.drive_id !== ''
		&& typeof ref.root_id === 'string' && ref.root_id !== ''
		&& typeof ref.folder_id === 'string' && ref.folder_id !== ''
}

export function read_folder_refs(raw: string): FolderRef[] {
	try {
		const value = JSON.parse(raw) as unknown
		if (!Array.isArray(value)) return []
		return dedupe(value.filter(is_folder_ref).map(ref => ({ ...ref })))
	} catch {
		return []
	}
}

const folder_refs_serializer = {
	read: read_folder_refs,
	write: (value: FolderRef[]) => JSON.stringify(dedupe(value)),
}

export const explorer_bookmarks = useStorage<FolderRef[]>(
	EXPLORER_BOOKMARKS_KEY,
	[],
	undefined,
	{ serializer: folder_refs_serializer },
)

export const explorer_last_opened = useStorage<FolderRef[]>(
	EXPLORER_LAST_OPENED_KEY,
	[],
	undefined,
	{ serializer: folder_refs_serializer },
)

function same_ref(a: FolderRef, b: FolderRef): boolean {
	return a.drive_id === b.drive_id && a.root_id === b.root_id && a.folder_id === b.folder_id
}

function dedupe(refs: FolderRef[]): FolderRef[] {
	const seen = new Set<string>()
	const result: FolderRef[] = []
	for (const ref of refs) {
		const key = `${ref.drive_id}\0${ref.root_id}\0${ref.folder_id}`
		if (seen.has(key)) continue
		seen.add(key)
		result.push(ref)
	}
	return result
}

export function is_bookmarked(ref: FolderRef): boolean {
	return explorer_bookmarks.value.some(item => same_ref(item, ref))
}

export function folder_ref_key(ref: FolderRef): string {
	return `${ref.drive_id}\0${ref.root_id}\0${ref.folder_id}`
}

function basename(id: string): string {
	const sep = path_separator(id)
	const index = id.lastIndexOf(sep)
	const name = index === -1 ? id : id.slice(index + 1)
	return name || id
}

/** Label for a bookmark pill. A cloud folder with no loaded name stays generic, never its id. */
export function bookmark_name(ref: FolderRef): string {
	if (ref.drive_id === 'cloud') {
		return cloud.workspaces.find(ws => ws.id === ref.root_id)?.name
			?? t('bookmarks.cloud_folder')
	}
	if (ref.drive_id === 'browser') {
		if (ref.folder_id === BROWSER_ROOT) return t('source.browser_disk')
		return basename(ref.folder_id)
	}
	return system_folder_name(ref, explorer_home.value) ?? basename(ref.folder_id)
}

export function move_bookmark(key: string, target_key: string, after: boolean) {
	const item = explorer_bookmarks.value.find(entry => folder_ref_key(entry) === key)
	if (!item || key === target_key) return
	const rest = explorer_bookmarks.value.filter(entry => folder_ref_key(entry) !== key)
	const target = rest.findIndex(entry => folder_ref_key(entry) === target_key)
	if (target < 0) return
	rest.splice(target + (after ? 1 : 0), 0, item)
	explorer_bookmarks.value = rest
}

export function add_bookmark(ref: FolderRef): void {
	const next = { ...ref }
	explorer_bookmarks.value = [
		next,
		...explorer_bookmarks.value.filter(item => !same_ref(item, next)),
	]
	explorer_last_opened.value = explorer_last_opened.value.filter(item => !same_ref(item, next))
}

export function remove_bookmark(ref: FolderRef): void {
	explorer_bookmarks.value = explorer_bookmarks.value.filter(item => !same_ref(item, ref))
}

/**
 * A folder was renamed or moved: bookmarks (and remembered places) at it or
 * inside it follow to the new address, so they keep their name and still open
 */
export function retarget_bookmarks(from: FolderRef, to: FolderRef): void {
	const follow = (list: FolderRef[]) => {
		let changed = false
		const next = list.map(ref => {
			if (ref.drive_id !== from.drive_id || ref.root_id !== from.root_id) return ref
			if (!is_within(ref.folder_id, from.folder_id)) return ref
			changed = true
			return { drive_id: to.drive_id, root_id: to.root_id, folder_id: to.folder_id + ref.folder_id.slice(from.folder_id.length) }
		})
		return changed ? next : list
	}
	explorer_bookmarks.value = follow(explorer_bookmarks.value)
	explorer_last_opened.value = follow(explorer_last_opened.value)
}

/**
 * A folder was trashed or ungrouped in the app: bookmarks (and remembered
 * places) at it or inside it go away instead of pointing at nothing
 */
export function forget_bookmarks(gone: FolderRef): void {
	const keep = (list: FolderRef[]) => {
		const next = list.filter(ref => ref.drive_id !== gone.drive_id
			|| ref.root_id !== gone.root_id
			|| !is_within(ref.folder_id, gone.folder_id))
		return next.length === list.length ? list : next
	}
	explorer_bookmarks.value = keep(explorer_bookmarks.value)
	explorer_last_opened.value = keep(explorer_last_opened.value)
}

/** Remembers a folder that is not already bookmarked. The list is not shown yet. */
export function remember_opened(ref: FolderRef): void {
	const next = { ...ref }
	if (explorer_bookmarks.value.some(item => same_ref(item, next))) return
	explorer_last_opened.value = [
		next,
		...explorer_last_opened.value.filter(item => !same_ref(item, next)),
	]
}
