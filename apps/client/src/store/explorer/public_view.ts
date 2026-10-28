import { computed, ref } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import { resolve_public_route } from '@/services/publicRoute'
import store from '@/store'
import cloud, { set_open_invited_workspace } from '@/store/cloud'
import { explorer_enabled } from './enabled'
import type { ExplorerPage } from './navigation'

/**
 * Public addresses in the new interface, until it has folder views (step
 * 3.6). A publication, an author's profile and an invitation show in the
 * current app's screens; from there the Explorer takes over again: "Back to
 * Hub" opens its Hub page, an accepted invitation opens the invited folder
 */
export const explorer_public_open = computed(() => explorer_enabled.value && !!(
	cloud.publication_view
	|| cloud.public_not_found
	|| cloud.profile_view
	|| cloud.profile_not_found
	|| cloud.invite_view
))

/** Where the Explorer opens when it comes back from those screens, instead of the last folder */
export type ExplorerReturn = { kind: 'page'; page: ExplorerPage } | { kind: 'folder'; ref: FolderRef }
export const explorer_return = ref<ExplorerReturn | null>(null)

/** The Explorer has no addresses of its own */
function leave_public_address() {
	if (window.location.pathname !== '/') history.replaceState(null, '', '/')
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
 * Where a fresh Explorer starts: back from those screens, or `/hub` opened
 * directly. Null: the last folder, as at launch
 */
export function take_explorer_start(): ExplorerReturn | null {
	const back = explorer_return.value
	explorer_return.value = null
	if (back) return back
	if (resolve_public_route(window.location.pathname).kind === 'hub') {
		leave_public_address()
		return { kind: 'page', page: 'hub' }
	}
	return null
}

set_open_invited_workspace(async (item) => {
	if (!explorer_enabled.value) {
		await store.load_workspace(item)
		return
	}
	explorer_return.value = { kind: 'folder', ref: { drive_id: 'cloud', root_id: item.id, folder_id: '/' } }
})
