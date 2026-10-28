import { computed } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import { t } from '@/i18n'
import { normalize_workspace_id } from '@/services/workspace/paths'
import store from '@/store'
import cloud from '@/store/cloud'
import { bookmark_name } from '@/store/explorer/bookmarks'
import { folder_basename, folder_crumbs, folder_title, type CrumbNames } from '@/store/explorer/folder_header'
import { explorer_navigation } from '@/store/explorer/navigation'
import { explorer_settings } from '@/store/explorer/settings'
import { public_roots } from '@/store/explorer/public_roots'
import { explorer_home, read_explorer_home } from '@/store/explorer/home'
import { system_folder_name } from '@/store/explorer/folder_cover'

const home = explorer_home

export function use_home() {
	read_explorer_home()
	return home
}
const read_home = read_explorer_home

/**
 * Where the window is: the open folder (its path, title and store) or a page
 * (settings, account, Hub). The folder header and the top bar both show it,
 * depending on the path settings
 */
export function use_folder_place() {
	read_home()

	const names = computed<CrumbNames>(() => ({
		is_home: root_id => home.value !== null && normalize_workspace_id(root_id) === home.value,
		root_name(ref: FolderRef) {
			if (ref.drive_id === 'local') {
				return home.value !== null && normalize_workspace_id(ref.root_id) === home.value
					? t('source.local')
					: folder_basename(ref.root_id)
			}
			if (ref.drive_id === 'browser') return t('source.browser_disk')
			if (ref.drive_id === 'public') return public_roots.get(ref.root_id)?.name ?? ''
			if (ref.drive_id === 'demo') return 'Demo'
			return bookmark_name(ref)
		},
		folder_name: (ref: FolderRef) => ref.drive_id === 'browser'
			? bookmark_name(ref)
			: system_folder_name(ref, home.value) ?? folder_basename(ref.folder_id),
		cloud_name: t('source.cloud'),
		hub_name: t('page.hub'),
		publication_author: (ref: FolderRef) => public_roots.get(ref.root_id)?.username ?? null,
	}))

	const location = computed(() => {
		const value = explorer_navigation.location
		return value?.kind === 'folder' ? value.ref : null
	})
	const page = computed(() => {
		const value = explorer_navigation.location
		return value?.kind === 'page' ? value.page : null
	})
	const page_arg = computed(() => {
		const value = explorer_navigation.location
		return value?.kind === 'page' ? value.arg ?? null : null
	})
	/** The store on screen, once it has opened the folder the location names */
	const workspace = computed(() => {
		const ref = location.value
		const current = store.workspace
		if (!ref || !current || current.is_disposed) return null
		return current.opened_folder_id === ref.folder_id ? current : null
	})
	/** The parents; none when the settings show the folder name alone */
	const crumbs = computed(() => location.value && explorer_settings.path_full ? folder_crumbs(location.value, names.value) : [])
	const title = computed(() => {
		// An author's page is titled by their name
		if (page.value === 'profile' && page_arg.value) {
			const profile = cloud.profile_view?.profile
			return profile?.username === page_arg.value ? profile.display_name || profile.username || page_arg.value : page_arg.value
		}
		if (page.value) return t(`page.${page.value}`)
		return location.value ? folder_title(location.value, names.value) : ''
	})

	return { location, page, page_arg, workspace, crumbs, title }
}
