import { computed, ref, watch } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import { resolve_public_route } from '@/services/publicRoute'
import store from '@/store'
import { report_error } from '@/store/helpers/reportError'
import cloud, { set_open_workspace, type PublicationView } from '@/store/cloud'
import { explorer_enabled } from './enabled'
import { explorer_navigation, type ExplorerPage } from './navigation'
import { DEMO_ROOT, public_roots, type PublicRoot } from './public_roots'

/**
 * Public addresses and cloud flows in the new interface. A publication opens
 * as a read-only folder of the "public" drive; a fork, "Edit" of one's own
 * publication and an accepted invitation open their cloud folder; /demo opens
 * the demo. An author's profile, an invitation still being accepted and a
 * publication that is gone show in the current app's screens until the
 * Explorer has its own (from there "Back to Hub" comes back to its Hub page)
 */
export const explorer_public_open = computed(() => explorer_enabled.value && !!(
	cloud.public_not_found
	|| cloud.profile_view
	|| cloud.profile_not_found
	|| cloud.invite_view
))

/** The Explorer is on screen: a flow navigates in it, otherwise it starts there */
export const explorer_mounted = ref(false)

/** Where the Explorer opens when it comes back from those screens, instead of the last folder */
export type ExplorerReturn = { kind: 'page'; page: ExplorerPage } | { kind: 'folder'; ref: FolderRef }
export const explorer_return = ref<ExplorerReturn | null>(null)

/** The Explorer has no addresses of its own */
function leave_public_address() {
	if (window.location.pathname !== '/') history.replaceState(null, '', '/')
}

/**
 * True once the folder is open (or will be, when the Explorer mounts). A
 * fork or "Edit" waits for it, so its button stays busy until the copy is on
 * screen and a second click cannot make a second copy
 */
async function go_to(target: FolderRef): Promise<boolean> {
	if (!explorer_mounted.value) {
		explorer_return.value = { kind: 'folder', ref: target }
		return true
	}
	try {
		await explorer_navigation.open_folder(target)
	} catch (error) {
		report_error(store, error)
		return false
	}
	const location = explorer_navigation.location
	return location?.kind === 'folder'
		&& location.ref.drive_id === target.drive_id
		&& location.ref.root_id === target.root_id
}

export function back_to_explorer_hub(): void {
	cloud.publication_view = null
	cloud.public_not_found = null
	cloud.profile_view = null
	cloud.profile_not_found = null
	explorer_return.value = { kind: 'page', page: 'hub' }
	leave_public_address()
}

/**
 * Where a fresh Explorer starts: back from those screens, or /hub or /demo
 * opened directly. Null: the last folder, as at launch
 */
export function take_explorer_start(): ExplorerReturn | null {
	const back = explorer_return.value
	explorer_return.value = null
	if (back) return back
	const route = resolve_public_route(window.location.pathname).kind
	if (route === 'hub') {
		leave_public_address()
		return { kind: 'page', page: 'hub' }
	}
	if (route === 'demo') {
		leave_public_address()
		return { kind: 'folder', ref: { drive_id: 'demo', root_id: DEMO_ROOT, folder_id: DEMO_ROOT } }
	}
	return null
}

/** What `cloud.fork()` reads, from a publication shown in the Explorer */
export function publication_view_of(root: PublicRoot): PublicationView {
	return {
		username: root.username,
		slug: root.slug,
		workspace_id: root.id,
		can_edit_source: root.can_edit_source,
		can_fork: root.can_fork,
		fork_count: 0,
	}
}

set_open_workspace(async (item, opts) => {
	if (!explorer_enabled.value) {
		await store.load_workspace(item, opts)
		return !!store.workspace
	}
	const view = cloud.publication_view
	if (opts?.public_readonly && view?.workspace_id === item.id) {
		public_roots.set(item.id, {
			id: item.id,
			name: item.name,
			username: view.username,
			slug: view.slug,
			can_fork: view.can_fork,
			can_edit_source: view.can_edit_source,
		})
		const opened = await go_to({ drive_id: 'public', root_id: item.id, folder_id: '/' })
		if (opened) leave_public_address()
		return opened
	}
	const opened = await go_to({ drive_id: 'cloud', root_id: item.id, folder_id: '/' })
	if (opened) leave_public_address()
	return opened
})

// Owner or editor of the source: learned after the publication opened
watch(() => [cloud.publication_view?.workspace_id, cloud.publication_view?.can_edit_source] as const, ([id, can_edit]) => {
	const root = id ? public_roots.get(id) : undefined
	if (root && can_edit !== undefined) root.can_edit_source = can_edit
})
