import type { FileManager } from '@pile-commander/file-manager'

/**
 * Entries shown before the cloud has them: a folder created or renamed is on
 * screen at once, while its request is still on the way. Until it lands,
 * every call of this file manager that addresses that entry — or anything
 * inside it — waits for it: dragging a new folder, opening it, renaming it
 * again, uploading into it. A call never reaches the cloud ahead of the entry
 * it names. A hold also tells a folder read that runs meanwhile (a watch
 * event, the read behind a kept list) to keep the entry it does not see yet.
 */

type Hold = {
	settled: Promise<unknown>
	/** a rename: the id the entry had, which a read in between may still return */
	replaces?: string
}

const holds = new WeakMap<object, Map<string, Hold>>()

function holds_of(fm: object): Map<string, Hold> {
	let map = holds.get(fm)
	if (!map) {
		map = new Map()
		holds.set(fm, map)
	}
	return map
}

/** `id` and every folder above it (cloud ids are paths) */
function self_and_ancestors(id: string): string[] {
	const ids = [id]
	let at = id
	for (;;) {
		const cut = at.lastIndexOf('/')
		if (cut <= 0) break
		at = at.slice(0, cut)
		ids.push(at)
	}
	return ids
}

/** The entry `id` is on screen before the cloud has it; `settled` is its request */
export function hold_entry(fm: object, id: string, settled: Promise<unknown>, options?: { replaces?: string }) {
	const map = holds_of(fm)
	const hold: Hold = { settled, replaces: options?.replaces }
	map.set(id, hold)
	const release = () => {
		if (map.get(id) === hold) map.delete(id)
	}
	settled.then(release, release)
}

/** The holds a read of this folder must respect: entries it may not see yet, and the ids they replace */
export function held_entries(fm: object): ReadonlyMap<string, { replaces?: string }> {
	return holds_of(fm)
}

/** Waits until no entry named by these ids (or above them) is still on its way */
async function entries_ready(fm: object, ids: string[]) {
	const map = holds.get(fm)
	if (!map || map.size === 0) return
	const waiting: Promise<unknown>[] = []
	for (const id of ids) {
		for (const at of self_and_ancestors(id)) {
			const hold = map.get(at)
			if (hold) waiting.push(hold.settled)
		}
	}
	if (waiting.length > 0) await Promise.allSettled(waiting)
}

/** Methods whose first argument is an entry id (or a folder to create in) */
const BY_FIRST = [
	'FolderChildren', 'open_file', 'create_folder', 'create_text_file', 'read_text_file',
	'get_media_src', 'save_text_file', 'upload_file', 'rename', 'remove', 'entry_size',
	'write_pile_image', 'read_pile_image', 'set_xattr', 'get_xattr', 'remove_xattr',
	'list_xattrs', 'folder_with_children_xattrs',
] as const
/** Methods whose first two arguments are entry ids (the entry and a target folder) */
const BY_FIRST_TWO = ['move', 'copy_file', 'copy_entry'] as const

/** The cloud file manager of a store, with its calls held behind entries still on their way */
export function gate_pending_entries(fm: FileManager): FileManager {
	const methods = fm as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
	const gate = (name: string, ids_of: (args: unknown[]) => string[]) => {
		const original = methods[name]
		if (typeof original !== 'function') return
		methods[name] = async (...args: unknown[]) => {
			await entries_ready(fm, ids_of(args))
			return original.apply(fm, args)
		}
	}
	const strings = (values: unknown[]) => values.filter((value): value is string => typeof value === 'string')
	for (const name of BY_FIRST) gate(name, args => strings([args[0]]))
	for (const name of BY_FIRST_TWO) gate(name, args => strings([args[0], args[1]]))
	gate('set_xattrs', args => strings(((args[0] as { id?: unknown }[] | undefined) ?? []).map(item => item.id)))
	return fm
}
