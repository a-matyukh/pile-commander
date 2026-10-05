import { invoke } from '@tauri-apps/api/core'
import { appCacheDir, basename, join } from '@tauri-apps/api/path'
import { mkdir, remove, writeFile } from '@tauri-apps/plugin-fs'
import { makeZip } from 'client-zip'
import {
	PILE_ATTRS_FILE,
	PILE_DIR_NAME,
	applyPileAttrs,
	collectPileAttrs,
	createFileManager,
	parsePileAttrsManifest,
	serializePileAttrsManifest,
	type FileManager,
} from '@pile-commander/file-manager'
import type { ImportProgress } from '@/domain/Store'
import { run_pool } from '@/services/cloud/bridge/pool'
import { read_entry_blob, upload_mime } from './entryBytes'

export async function export_workspace_to_pile(
	fm: FileManager,
	workspace_root: string,
	zip_path: string,
): Promise<void> {
	const manifest = await collectPileAttrs(fm, workspace_root)
	const attrs_json = serializePileAttrsManifest(manifest)
	await invoke('export_workspace_zip', {
		rootPath: workspace_root,
		zipPath: zip_path,
		attrsJson: attrs_json,
	})
}

export async function import_workspace_from_pile(
	zip_path: string,
	dest_parent: string,
): Promise<{ root: string; name: string }> {
	const extracted_root = await invoke<string>('import_workspace_zip', {
		zipPath: zip_path,
		destParent: dest_parent,
	})

	const fm = createFileManager('local')
	const attrs_path = await join(extracted_root, PILE_DIR_NAME, PILE_ATTRS_FILE)
	const attrs_raw = await fm.read_text_file(attrs_path)
	const manifest = parsePileAttrsManifest(JSON.parse(attrs_raw))

	// Drop the manifest sidecar before applying: the strokes import recreates
	// `.pile/strokes.json`, and attrs.json must not survive into the workspace.
	const pile_dir = await join(extracted_root, PILE_DIR_NAME)
	await fm.remove(pile_dir)
	await applyPileAttrs(fm, extracted_root, manifest)

	const name = await basename(extracted_root)
	return { root: extracted_root, name }
}

/** Downloads in flight while a cloud workspace is written out. */
const DOWNLOAD_CONCURRENCY = 4

/** A folder name the local file system accepts for the archive root. */
export function pile_root_name(name: string): string {
	// eslint-disable-next-line no-control-regex
	const cleaned = name.replace(/[/\\:*?"<>|\x00-\x1f\x7f]/g, '_').trim().replace(/^\.+/, '')
	return cleaned || 'workspace'
}

export type PileTreeFile = {
	id: string
	name: string
	/** path below the workspace root, one name per segment */
	segments: string[]
}

/** A cloud workspace laid out for an archive. */
export type PileTree = {
	/** parents before their children */
	folders: string[][]
	files: PileTreeFile[]
}

/**
 * Walks a cloud workspace from its root. `.pile` entries are left out at any
 * depth: the archive carries its own `.pile/attrs.json`, and the desktop zip
 * skips such folders anyway.
 */
export async function list_pile_tree(fm: FileManager): Promise<PileTree> {
	const tree: PileTree = { folders: [], files: [] }
	const queue: { id: string; segments: string[] }[] = [{ id: '/', segments: [] }]
	for (let index = 0; index < queue.length; index++) {
		const folder = queue[index]!
		for (const child of await fm.FolderChildren(folder.id)) {
			if (child.name === PILE_DIR_NAME) continue
			const segments = [...folder.segments, child.name]
			if (child.type === 'folder') {
				tree.folders.push(segments)
				queue.push({ id: child.id, segments })
			} else {
				tree.files.push({ id: child.id, name: child.name, segments })
			}
		}
	}
	return tree
}

// Originals, never a visitor's preview: the backend grants them where the
// author allows forks and downloads, and any refusal stops the whole archive
function read_pile_file(fm: FileManager, file: PileTreeFile): Promise<Blob> {
	return read_entry_blob(fm, file.id, file.name, upload_mime(file.name), { original: true })
}

// progress by files: the overlay reads loaded/total as a fraction
function file_progress(file: PileTreeFile, done: number, total: number): ImportProgress {
	return {
		file_name: file.name,
		file_index: done,
		total_files: total,
		loaded_bytes: done,
		total_bytes: total,
	}
}

/**
 * Cloud → .pile (desktop). The workspace is written into a temporary folder
 * under the app cache — text as text, blobs downloaded as originals — its
 * layout collected from the cloud (xattrs, ink, edges) and zipped by the
 * same command as a local export. The temporary folder goes away either way.
 */
export async function export_cloud_workspace_to_pile(
	fm: FileManager,
	name: string,
	zip_path: string,
	on_progress?: (progress: ImportProgress) => void,
): Promise<void> {
	const scratch = await join(await appCacheDir(), 'pile-export', crypto.randomUUID())
	const root = await join(scratch, pile_root_name(name))
	await mkdir(root, { recursive: true })
	try {
		const tree = await list_pile_tree(fm)
		// parents come first, so each folder's parent exists by its turn
		for (const segments of tree.folders) {
			await mkdir(await join(root, ...segments))
		}

		let done = 0
		await run_pool(tree.files, DOWNLOAD_CONCURRENCY, async (file) => {
			const blob = await read_pile_file(fm, file)
			await writeFile(await join(root, ...file.segments), new Uint8Array(await blob.arrayBuffer()))
			done += 1
			on_progress?.(file_progress(file, done, tree.files.length))
		})

		const manifest = await collectPileAttrs(fm, '/')
		await invoke('export_workspace_zip', {
			rootPath: root,
			zipPath: zip_path,
			attrsJson: serializePileAttrsManifest(manifest),
		})
	} finally {
		await remove(scratch, { recursive: true }).catch((error: unknown) => console.error(error))
	}
}

/** A folder (the name ends with "/") or a file with its bytes. */
export type PileZipEntry = { name: string } | { name: string; input: Blob | string }

/**
 * The archive the desktop import expects: one root folder, explicit folder
 * entries (empty folders survive), the files, and `.pile/attrs.json` last.
 */
export function pile_zip_entries(
	root: string,
	tree: PileTree,
	blobs: ReadonlyMap<string, Blob>,
	attrs_json: string,
): PileZipEntry[] {
	const entries: PileZipEntry[] = tree.folders.map(segments => ({ name: `${root}/${segments.join('/')}/` }))
	for (const file of tree.files) {
		const blob = blobs.get(file.id)
		if (!blob) throw new Error(`${file.name}: not downloaded`)
		entries.push({ name: `${root}/${file.segments.join('/')}`, input: blob })
	}
	entries.push({ name: `${root}/${PILE_DIR_NAME}/${PILE_ATTRS_FILE}`, input: attrs_json })
	return entries
}

/**
 * Cloud → .pile (web). The same archive as the desktop export, built in
 * memory with client-zip — stored, not deflated: media is compressed already —
 * and handed back for the browser to download. Every file is held until the
 * zip is written: fine at today's quotas, a huge workspace is the desktop
 * app's job.
 */
export async function build_cloud_workspace_pile(
	fm: FileManager,
	name: string,
	on_progress?: (progress: ImportProgress) => void,
): Promise<Blob> {
	const tree = await list_pile_tree(fm)
	const blobs = new Map<string, Blob>()
	let done = 0
	await run_pool(tree.files, DOWNLOAD_CONCURRENCY, async (file) => {
		blobs.set(file.id, await read_pile_file(fm, file))
		done += 1
		on_progress?.(file_progress(file, done, tree.files.length))
	})
	const attrs_json = serializePileAttrsManifest(await collectPileAttrs(fm, '/'))
	return new Response(makeZip(pile_zip_entries(pile_root_name(name), tree, blobs, attrs_json))).blob()
}

/**
 * Desktop: a .pile goes to the cloud through a local extraction under the
 * app cache (the regular import, layout applied). `dispose` removes it.
 */
export async function extract_pile_to_cache(
	zip_path: string,
): Promise<{ root: string; name: string; dispose: () => Promise<void> }> {
	const scratch = await join(await appCacheDir(), 'pile-import', crypto.randomUUID())
	await mkdir(scratch, { recursive: true })
	const dispose = () => remove(scratch, { recursive: true })
	try {
		const { root, name } = await import_workspace_from_pile(zip_path, scratch)
		return { root, name, dispose }
	} catch (error) {
		await dispose().catch(() => {})
		throw error
	}
}
