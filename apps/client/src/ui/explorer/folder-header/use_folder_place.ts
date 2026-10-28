import { computed, ref } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import { t } from '@/i18n'
import { is_desktop } from '@/isDesktop'
import { normalize_workspace_id } from '@/services/workspace/paths'
import store from '@/store'
import { bookmark_name } from '@/store/explorer/bookmarks'
import { folder_basename, folder_crumbs, folder_title, type CrumbNames } from '@/store/explorer/folder_header'
import { explorer_navigation } from '@/store/explorer/navigation'
import { explorer_settings } from '@/store/explorer/settings'
import { public_roots } from '@/store/explorer/public_roots'

/** ~ on the desktop, read once for every header, top bar and tree row */
const home = ref<string | null>(null)

export function use_home() {
	read_home()
	return home
}
let home_read = false
function read_home() {
	if (home_read || !is_desktop) return
	home_read = true
	void import('@tauri-apps/api/path')
		.then(({ homeDir }) => homeDir())
		.then((path) => { home.value = normalize_workspace_id(path) })
}

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
		folder_name: (ref: FolderRef) => ref.drive_id === 'browser' ? bookmark_name(ref) : folder_basename(ref.folder_id),
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
		if (page.value) return t(`page.${page.value}`)
		return location.value ? folder_title(location.value, names.value) : ''
	})

	return { location, page, workspace, crumbs, title }
}
