import type { FileManager, PlanLimitInfo } from '@pile-commander/file-manager'
import { PlanLimitError } from '@pile-commander/file-manager'
import { read_entry_blob } from '@/services/workspace/entryBytes'
import type { BridgePreflight } from './preflight'
import { run_pool } from './pool'

export type CopyTreeProgress = {
	/** Folders are all created before the first file starts uploading. */
	phase: 'folders' | 'files'
	folders_done: number
	total_folders: number
	loaded_bytes: number
	total_bytes: number
	files_done: number
	total_files: number
	/** Relative path of the latest file that started uploading. */
	current: string | null
}

export type CopyTreeOptions = {
	/** Relative paths of files to leave out. */
	exclude: ReadonlySet<string>
	on_progress?: (progress: CopyTreeProgress) => void
	signal?: AbortSignal
	/** Files uploading at once. */
	concurrency?: number
}

export type CopyTreeResult =
	| { kind: 'done'; uploaded: number; skipped: number }
	| { kind: 'plan_limit'; info: PlanLimitInfo; file: string }
	| { kind: 'aborted' }

// A few uploads in flight: the backend's per-user presign/finalize budget is
// the real ceiling (apps/backend/src/ratelimit.ts), the cloud FM waits out 429s
const UPLOAD_CONCURRENCY = 3

// Folder creation is one round trip after another, and most of it is network
// wait (the insert holds the workspace tree lock for milliseconds), so the
// siblings of a level go several at once
const FOLDER_CONCURRENCY = 6

function join_relative(root: string, relative: string): string {
	if (!relative) return root
	const sep = root.includes('\\') ? '\\' : '/'
	const base = root.endsWith(sep) ? root.slice(0, -sep.length) : root
	return `${base}${sep}${relative.split('/').join(sep)}`
}

/** Breadth-first folders grouped by depth: every parent sits in an earlier level. */
function folder_levels(folders: readonly string[]): string[][] {
	const levels: string[][] = []
	for (const relative of folders) {
		const depth = relative.split('/').length - 1
		;(levels[depth] ??= []).push(relative)
	}
	return levels.filter(level => level !== undefined)
}

function parent_relative(relative: string): string {
	const index = relative.lastIndexOf('/')
	return index < 0 ? '' : relative.slice(0, index)
}

/**
 * Copies a measured tree into `dst_root` of another file manager: folders
 * first (parents before children), then files a few at a time. Names that
 * already exist at the destination are skipped, so a rerun after a crash is a
 * resume — a cloud upload is atomic (the row appears only after finalize),
 * nothing half-written passes for a copy.
 */
export async function copy_tree(
	src_fm: FileManager,
	dst_fm: FileManager,
	dst_root: string,
	tree: Pick<BridgePreflight, 'folders' | 'files'>,
	options: CopyTreeOptions,
): Promise<CopyTreeResult> {
	const { exclude, signal } = options

	// destination names per folder, listed once; folders created here start empty
	const listings = new Map<string, Promise<Set<string>>>()
	const names_in = (folder_id: string): Promise<Set<string>> => {
		let listing = listings.get(folder_id)
		if (!listing) {
			listing = dst_fm.FolderChildren(folder_id).then(children => new Set(children.map(child => child.name)))
			listings.set(folder_id, listing)
		}
		return listing
	}

	const files = tree.files.filter(file => !exclude.has(file.relative))
	const total_bytes = files.reduce((sum, file) => sum + file.size_bytes, 0)
	const in_flight = new Map<string, number>()
	let settled_bytes = 0
	let files_done = 0
	let uploaded = 0
	let skipped = 0
	let current: string | null = null
	let phase: CopyTreeProgress['phase'] = 'folders'
	let folders_done = 0
	const stops: { info: PlanLimitInfo; file: string }[] = []

	const report = () => {
		let loaded_bytes = settled_bytes
		for (const bytes of in_flight.values()) loaded_bytes += bytes
		options.on_progress?.({
			phase,
			folders_done,
			total_folders: tree.folders.length,
			loaded_bytes,
			total_bytes,
			files_done,
			total_files: files.length,
			current,
		})
	}
	const settle = (bytes: number) => {
		settled_bytes += bytes
		files_done += 1
		report()
	}

	report()
	for (const level of folder_levels(tree.folders)) {
		await run_pool(
			level,
			FOLDER_CONCURRENCY,
			async (relative) => {
				const parent_id = join_relative(dst_root, parent_relative(relative))
				const names = await names_in(parent_id)
				const name = relative.slice(relative.lastIndexOf('/') + 1)
				if (!names.has(name)) {
					await dst_fm.create_folder(parent_id, name)
					names.add(name)
					listings.set(join_relative(dst_root, relative), Promise.resolve(new Set()))
				}
				folders_done += 1
				report()
			},
			() => !!signal?.aborted,
		)
		if (signal?.aborted) return { kind: 'aborted' }
	}

	phase = 'files'
	report()
	await run_pool(
		files,
		options.concurrency ?? UPLOAD_CONCURRENCY,
		async (file) => {
			const parent_id = join_relative(dst_root, parent_relative(file.relative))
			const names = await names_in(parent_id)
			if (names.has(file.name)) {
				skipped += 1
				settle(file.size_bytes)
				return
			}
			current = file.relative
			in_flight.set(file.relative, 0)
			report()
			try {
				const blob = await read_entry_blob(src_fm, file.id, file.name, file.mime)
				await dst_fm.upload_file(
					parent_id,
					file.name,
					blob,
					file.text_as_blob ? 'application/octet-stream' : file.mime,
					(loaded) => {
						in_flight.set(file.relative, Math.min(loaded, file.size_bytes))
						report()
					},
				)
			} catch (error) {
				if (error instanceof PlanLimitError) {
					stops.push({ info: error.to_info(), file: file.relative })
					return
				}
				throw error
			} finally {
				in_flight.delete(file.relative)
			}
			names.add(file.name)
			uploaded += 1
			settle(file.size_bytes)
		},
		() => stops.length > 0 || !!signal?.aborted,
	)

	if (stops.length > 0) return { kind: 'plan_limit', ...stops[0]! }
	if (signal?.aborted) return { kind: 'aborted' }
	return { kind: 'done', uploaded, skipped }
}
