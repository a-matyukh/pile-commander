import { ref } from 'vue'
import { is_desktop } from '@/isDesktop'
import { normalize_workspace_id } from '@/services/workspace/paths'

/** ~ on the desktop, read once for every header, tree row and bookmark; null on the web or until read */
export const explorer_home = ref<string | null>(null)

let home_read = false
export function read_explorer_home() {
	if (home_read || !is_desktop) return
	home_read = true
	void import('@tauri-apps/api/path')
		.then(({ homeDir }) => homeDir())
		.then((path) => { explorer_home.value = normalize_workspace_id(path) })
		.catch(() => { home_read = false })
}
