import {
	createBrowserFileManager,
	createFileManager,
	workspace_root_info,
	type FileManager,
	type WorkspaceRootInfo,
} from '@pile-commander/file-manager'
import type { Drive, DriveRoot } from '@/domain/Drive'
import type { LoadWorkspaceOptions, WorkspaceStore } from '@/domain/Store'
import type { WorkspacesListItem } from '@/domain/WorkspacesList'
import { t } from '@/i18n'
import { is_desktop } from '@/isDesktop'
import { require_browser_storage } from '@/services/workspace/browserStorage'
import { normalize_workspace_id, path_separator } from '@/services/workspace/paths'
import cloud from '@/store/cloud'
import { require_supabase } from '@/services/cloud/client'
import { cloud_workspaces_ready } from './cloud_list'
import { DEMO_ROOT, public_roots } from './public_roots'
import { createWorkspaceStore } from '@/store/createWorkspaceStore'
import { adopt_workspace } from '@/store/index'
import { open_workspace_store } from '@/store/helpers/openWorkspaceStore'

/** Passed only to the Explorer's local file manager. The old UI does not use it. */
export const explorer_local_file_manager_options = { remove_to_trash: true } as const

export function create_explorer_local_file_manager(): FileManager {
	return createFileManager('local', explorer_local_file_manager_options)
}

export const BROWSER_ROOT = '/browser-desktops'

export type ExplorerDriveDeps = {
	is_desktop: boolean
	home_path(): Promise<string>
	local_file_manager(): FileManager
	open_cloud(item: WorkspacesListItem, opts?: LoadWorkspaceOptions): Promise<WorkspaceStore>
	/** The demo pack, in memory: changes are not saved */
	open_demo?(): Promise<WorkspaceStore>
	cloud_roots(): Promise<DriveRoot[]>
	browser_file_manager(): Promise<FileManager>
	adopt(workspace: WorkspaceStore | null): void
}

export type ExplorerDrives = {
	/** The sources the user picks: this Mac or browser storage, and the cloud */
	drives(): Drive[]
	/** Any drive by id, also the ones that are not sources: a publication ("public"), the demo */
	drive(id: string): Drive | null
	/** Opens the root's store and shows it, without disposing stores Drive still holds. */
	open(drive_id: string, root_id: string, still_current?: () => boolean): Promise<WorkspaceStore>
	/** A path under ~ uses the home store. Anything else becomes its own local root. */
	open_local_path(path: string, still_current?: () => boolean): Promise<WorkspaceStore>
	/** Desktop opens ~. The web app opens the browser-storage root. */
	open_default(): Promise<WorkspaceStore>
	/** Roots the tree currently has expanded. Unlisted open stores are disposed. */
	set_expanded(root_ids: Iterable<string>, drive_id?: string | null): void
	/**
	 * Keeps a root's store open while an operation uses it (a transfer into a
	 * collapsed root). The release lets the next sweep close it, and sweeps
	 */
	hold(root_id: string): () => void
	/** Closes every store Drive holds and forgets outside roots. Does not close a store it does not hold. */
	dispose_all(): void
}

const store_key = (drive_id: string, root_id: string) => `${drive_id}\0${root_id}`

export function is_within(path: string, root: string): boolean {
	const id = normalize_workspace_id(path)
	const base = normalize_workspace_id(root)
	if (id === base) return true
	const sep = path_separator(base)
	const prefix = base === sep ? sep : base + sep
	return id.startsWith(prefix)
}

function basename_of(path: string): string {
	const trimmed = normalize_workspace_id(path)
	const sep = path_separator(trimmed)
	const index = trimmed.lastIndexOf(sep)
	return index === -1 ? trimmed : trimmed.slice(index + 1)
}

async function ensure_browser_root(): Promise<void> {
	const storage = require_browser_storage()
	if (await storage.has(BROWSER_ROOT)) return
	await storage.apply({
		entries: [{ path: BROWSER_ROOT, type: 'folder', xattrs: {} }],
	})
}

export function create_explorer_drives(deps: ExplorerDriveDeps): ExplorerDrives {
	const stores = new Map<string, WorkspaceStore>()
	const opening = new Map<string, Promise<WorkspaceStore>>()
	const outside = new Set<string>()
	const expanded = new Set<string>()
	const holds = new Map<string, number>()
	let home: string | null = null
	let current_root_id: string | null = null
	/** The drive of the store on screen: another drive's expanded roots are not kept */
	let current_drive_id: string | null = null
	/** The drive whose tree reported `expanded` */
	let expanded_drive_id: string | null = null
	let epoch = 0

	const home_id = async () => {
		home ??= normalize_workspace_id(await deps.home_path())
		return home
	}

	const kept = (root_id: string) => root_id === current_root_id || expanded.has(root_id) || holds.has(root_id)

	/**
	 * A store stays while it is on screen, held by an operation, or expanded in
	 * the tree of the drive on screen. Leaving a publication or the demo for
	 * another drive closes their stores (and a publication's live channel)
	 */
	const kept_store = (key: string) => {
		const drive_id = key.slice(0, key.indexOf('\0'))
		const root_id = key.slice(key.indexOf('\0') + 1)
		if (holds.has(root_id)) return true
		if (drive_id === current_drive_id && root_id === current_root_id) return true
		return drive_id === expanded_drive_id && expanded.has(root_id)
	}

	const sweep = () => {
		for (const [key, store] of stores) {
			const root_id = key.slice(key.indexOf('\0') + 1)
			if (kept_store(key)) continue
			store.dispose()
			stores.delete(key)
			outside.delete(root_id)
		}
	}

	async function local_store(root_id: string, name: string): Promise<WorkspaceStore> {
		const workspace = await createWorkspaceStore(
			{ id: root_id, type: 'local', name },
			deps.local_file_manager(),
			{ root_folder_id: root_id, shallow_root: true },
		)
		if (!workspace) throw new Error(`Failed to open “${name}”`)
		return workspace
	}

	async function load_store(drive_id: string, root_id: string): Promise<WorkspaceStore> {
		if (drive_id === 'local') {
			const home_path = await home_id()
			const name = root_id === home_path ? t('source.local') : basename_of(root_id)
			return local_store(root_id, name)
		}
		if (drive_id === 'browser') {
			const fm = await deps.browser_file_manager()
			const workspace = await createWorkspaceStore(
				{ id: root_id, type: 'browser', name: t('source.browser_disk') },
				fm,
				{ root_folder_id: root_id },
			)
			if (!workspace) throw new Error('Failed to open browser storage')
			return workspace
		}
		if (drive_id === 'cloud') {
			const root = (await deps.cloud_roots()).find(item => item.id === root_id)
			return deps.open_cloud({
				id: root_id,
				type: 'cloud',
				name: root?.name ?? root_id,
			})
		}
		if (drive_id === 'public') {
			// Someone's publication: read-only, as the old public viewer
			return deps.open_cloud(
				{ id: root_id, type: 'cloud', name: public_roots.get(root_id)?.name ?? root_id },
				{ public_readonly: true },
			)
		}
		if (drive_id === 'demo' && deps.open_demo) return deps.open_demo()
		throw new Error(`Unknown drive “${drive_id}”`)
	}

	async function store_for(drive_id: string, root_id: string): Promise<WorkspaceStore> {
		const key = store_key(drive_id, root_id)
		const existing = stores.get(key)
		if (existing && !existing.is_disposed) return existing
		stores.delete(key)
		const pending = opening.get(key)
		if (pending) return pending
		const epoch_at_start = epoch
		const job = load_store(drive_id, root_id).then(
			(store) => {
				opening.delete(key)
				if (epoch_at_start !== epoch) {
					store.dispose()
					throw new Error('Drive was closed')
				}
				stores.set(key, store)
				return store
			},
			(error: unknown) => {
				opening.delete(key)
				throw error
			},
		)
		opening.set(key, job)
		return job
	}

	async function open(
		drive_id: string,
		root_id: string,
		still_current?: () => boolean,
	): Promise<WorkspaceStore> {
		const epoch_at_start = epoch
		const store = await store_for(drive_id, root_id)
		if (epoch_at_start !== epoch || store.is_disposed) return store
		// A lost transition must not adopt, and must not dispose: it often
		// shares this store with the winner (two folders of one root). The
		// next successful open sweeps a root nobody kept; dispose_all does too.
		if (still_current && !still_current()) return store
		current_root_id = root_id
		current_drive_id = drive_id
		deps.adopt(store)
		sweep()
		return store
	}

	function dispose_all() {
		epoch += 1
		for (const store of stores.values()) store.dispose()
		stores.clear()
		opening.clear()
		outside.clear()
		expanded.clear()
		holds.clear()
		current_root_id = null
		current_drive_id = null
		expanded_drive_id = null
	}

	const local_drive = (): Drive => ({
		id: 'local',
		kind: 'local',
		name: t('source.this_mac'),
		icon: 'tabler:device-desktop',
		trash: 'system',
		async roots() {
			const id = await home_id()
			const roots: DriveRoot[] = [{ id, name: t('source.local'), can_write: true }]
			for (const outside_id of outside) {
				if (!kept(outside_id)) continue
				roots.push({ id: outside_id, name: basename_of(outside_id), can_write: true })
			}
			return roots
		},
		store_for: (root_id) => store_for('local', root_id),
	})

	const browser_drive = (): Drive => ({
		id: 'browser',
		kind: 'browser',
		name: t('source.browser_disk'),
		icon: 'tabler:database',
		trash: null,
		async roots() {
			return [{ id: BROWSER_ROOT, name: t('source.browser_disk'), can_write: true }]
		},
		store_for: (root_id) => store_for('browser', root_id),
	})

	const cloud_drive = (): Drive => ({
		id: 'cloud',
		kind: 'cloud',
		name: t('source.cloud'),
		icon: 'tabler:cloud',
		trash: 'page',
		async roots() {
			return deps.cloud_roots()
		},
		store_for: (root_id) => store_for('cloud', root_id),
	})

	const public_drive = (): Drive => ({
		id: 'public',
		// a cloud workspace underneath: its folders start at "/"
		kind: 'cloud',
		name: t('source.hub'),
		icon: 'tabler:world',
		trash: null,
		async roots() {
			return [...public_roots.values()].map(root => ({ id: root.id, name: root.name, can_write: false }))
		},
		store_for: (root_id) => store_for('public', root_id),
	})

	const demo_drive = (): Drive => ({
		id: 'demo',
		kind: 'demo',
		name: 'Demo',
		icon: 'tabler:sparkles',
		trash: null,
		async roots() {
			return [{ id: DEMO_ROOT, name: 'Demo', can_write: true }]
		},
		store_for: (root_id) => store_for('demo', root_id),
	})

	const drives = () => deps.is_desktop
		? [local_drive(), cloud_drive()]
		: [browser_drive(), cloud_drive()]

	return {
		drives,
		drive(id: string) {
			if (id === 'public') return public_drive()
			if (id === 'demo') return demo_drive()
			return drives().find(item => item.id === id) ?? null
		},
		open,
		async open_local_path(path: string, still_current?: () => boolean) {
			const id = normalize_workspace_id(path)
			const home_path = await home_id()
			if (!is_within(id, home_path)) outside.add(id)
			return open('local', is_within(id, home_path) ? home_path : id, still_current)
		},
		open_default: () => deps.is_desktop
			? home_id().then(id => open('local', id))
			: open('browser', BROWSER_ROOT),
		hold(root_id: string) {
			holds.set(root_id, (holds.get(root_id) ?? 0) + 1)
			let released = false
			return () => {
				if (released) return
				released = true
				const left = (holds.get(root_id) ?? 1) - 1
				if (left > 0) holds.set(root_id, left)
				else holds.delete(root_id)
				sweep()
			}
		},
		set_expanded(root_ids: Iterable<string>, drive_id: string | null = current_drive_id) {
			expanded_drive_id = drive_id
			expanded.clear()
			for (const id of root_ids) expanded.add(id)
			sweep()
		},
		dispose_all,
	}
}

export const explorer_drives = create_explorer_drives({
	is_desktop,
	async home_path() {
		const { homeDir } = await import('@tauri-apps/api/path')
		return homeDir()
	},
	local_file_manager: create_explorer_local_file_manager,
	open_cloud: (item, opts) => open_workspace_store(item, opts),
	open_demo: () => open_workspace_store({ type: 'demo', id: DEMO_ROOT, name: 'Demo' }),
	async cloud_roots() {
		await cloud_workspaces_ready()
		const roots: DriveRoot[] = cloud.workspaces.map(ws => ({
			id: ws.id,
			name: ws.name,
			can_write: cloud.role_of(ws.id) !== 'viewer',
		}))
		// Each top-level folder's own view and subfolders, so the tree shows its
		// icon and chevron before it is opened. Without them: a plain folder
		// with a chevron
		const info: Record<string, WorkspaceRootInfo> = await workspace_root_info(require_supabase(), roots.map(root => root.id))
			.catch(() => ({}))
		return roots.map(root => ({ ...root, view: info[root.id]?.view, subfolders: info[root.id]?.subfolders }))
	},
	async browser_file_manager() {
		await ensure_browser_root()
		return createBrowserFileManager(require_browser_storage())
	},
	adopt: adopt_workspace,
})
