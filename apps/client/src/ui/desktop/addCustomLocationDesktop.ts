import desktops from '@/store/desktops'
import store from '@/store'
import { pick_desktop_folder } from '@/services/desktop/desktopFolders'

/**
 * "Local desktop at custom location…": adopts the picked user folder as
 * the desktop root (Desktop.path), named after the folder. Validation
 * failures surface through the app-level error display.
 */
export async function add_custom_location_desktop(): Promise<void> {
	const taken = desktops.desktops
		.map(d => d.path)
		.filter((path): path is string => Boolean(path))
	const result = await pick_desktop_folder(taken)
	if (result.status === 'canceled') return
	if (result.status === 'error') {
		store.last_error = result.message
		return
	}
	desktops.add_desktop(result.name, 'local', result.path)
}
