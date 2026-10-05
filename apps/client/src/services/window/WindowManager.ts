import type { PickFolderOptions, WindowManager } from '@/domain/WindowManager'
import { open, save } from '@tauri-apps/plugin-dialog'
import { basename } from '@tauri-apps/api/path'
import { getCurrentWindow } from '@tauri-apps/api/window'

const PILE_FILTER = {
	name: 'Pile workspace',
	extensions: ['pile'],
}

export function create_window_manager(): WindowManager {
	return {
		pick_folder: async (options?: PickFolderOptions) => {
			const path = await open({
				directory: true,
				multiple: false,
				title: options?.title,
			})
			if (!path) return null
			const name = await basename(path)
			return {
				folder_id: path,
				name,
			}
		},
		save_pile_file: async (default_name) => {
			const path = await save({
				defaultPath: default_name.endsWith('.pile')
					? default_name
					: `${default_name}.pile`,
				filters: [PILE_FILTER],
			})
			return path ?? null
		},
		pick_pile_file: async () => {
			const path = await open({
				multiple: false,
				filters: [PILE_FILTER],
			})
			if (!path || Array.isArray(path)) return null
			return path
		},
		close: async () => {
			await getCurrentWindow().close()
		},
		minimize: async () => {
			await getCurrentWindow().minimize()
		},
		hide: async () => {
			await getCurrentWindow().hide()
		},
	}
}
