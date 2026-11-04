import {
	active_step,
	createFileManager,
	createBrowserFileManager,
	get_workspace_access,
	type FileManager,
	type FolderWithChildrenXattrs,
} from '@pile-commander/file-manager'
import { create_app_cloud_file_manager } from '@/services/cloud/cloudFileManager'
import { create_demo_file_manager } from '@/services/demoPack'
import type { LoadWorkspaceOptions, WorkspaceStore } from '@/domain/Store'
import type { WorkspacesListItem } from '@/domain/WorkspacesList'
import {
	CLOUD_WORKSPACE_OFFLINE,
	cloud_failure_message,
	require_supabase,
} from '@/services/cloud/client'
import { require_browser_storage } from '@/services/workspace/browserStorage'
import { createWorkspaceStore } from '../createWorkspaceStore'

/** Reads started before the store exists; a rejection is kept for whoever awaits it */
function start_reads(fm: FileManager, also_read: string | undefined) {
	const quiet = <T>(promise: Promise<T>) => {
		promise.catch(() => {})
		return promise
	}
	const initial_root = quiet(fm.folder_with_children_xattrs('/'))
	const prefetched = new Map<string, Promise<FolderWithChildrenXattrs>>()
	if (also_read && also_read !== '/') prefetched.set(also_read, quiet(fm.folder_with_children_xattrs(also_read)))
	return { initial_root, prefetched }
}

/**
 * Builds a live workspace store for the given list item: file manager,
 * access check, read-only gating.
 */
export async function open_workspace_store(
	item: WorkspacesListItem,
	opts?: LoadWorkspaceOptions,
): Promise<WorkspaceStore> {
	// cloud workspaces need the shared supabase client; their root
	// folder id is "/" while item.id stays the workspace UUID (uid)
	const fm = item.type === 'cloud'
		? create_app_cloud_file_manager(item.id)
		: item.type === 'browser'
			// web desktops: item.id is the virtual root path; no access check
			? createBrowserFileManager(require_browser_storage())
			: item.type === 'demo'
				? await create_demo_file_manager()
				: createFileManager(item.type)

	// A cloud root is read while its access is checked, not after it: the
	// check still decides "offline" / "no access" (a quick failed read does
	// not win), and the read's own failure surfaces only once access is fine.
	// The folder the navigation goes to is read alongside too
	const reads = item.type === 'cloud' ? start_reads(fm, opts?.also_read) : undefined

	// viewer role gets a read-only store: UI gates mutations and every
	// store mutation refuses with a clear error (RLS is the final boundary).
	// Realtime is for members only (owner, editor, invited viewer): a
	// public-link visitor without membership — anon, or signed in and coming
	// from the Hub — reads the board once and opens no channel, hence no
	// realtime connection at all
	let can_write = true
	let live = true
	if (item.type === 'cloud' && opts?.public_readonly) {
		// public-URL visitor view is read-only; owner/editor reopen the same
		// id without this flag to write. Anon has no session, so the check
		// answers null without a request; a failed check must not break the
		// public page — it only leaves the view static
		can_write = false
		const access = await get_workspace_access(require_supabase(), item.id).catch(() => null)
		live = access !== null
	} else if (item.type === 'cloud') {
		let access: Awaited<ReturnType<typeof get_workspace_access>>
		try {
			access = await active_step('access', () => get_workspace_access(require_supabase(), item.id))
		} catch (error) {
			throw new Error(cloud_failure_message(error, CLOUD_WORKSPACE_OFFLINE))
		}
		if (!access) {
			// no session (offline refresh) and no membership both come back null
			const { data } = await require_supabase().auth.getSession()
			if (!data.session) throw new Error(CLOUD_WORKSPACE_OFFLINE)
			throw new Error(`No access to workspace “${item.name}”`)
		}
		can_write = access !== 'viewer'
	}

	let workspace: WorkspaceStore | null
	try {
		workspace = await active_step('create_store', () => createWorkspaceStore(item, fm, {
			root_folder_id: item.type === 'cloud' ? '/' : item.id,
			can_write,
			live,
			...reads,
		}))
	} catch (error) {
		if (item.type !== 'cloud') throw error
		throw new Error(cloud_failure_message(error, CLOUD_WORKSPACE_OFFLINE))
	}
	if (!workspace) {
		throw new Error(`Failed to open workspace “${item.name}”`)
	}
	return workspace
}

