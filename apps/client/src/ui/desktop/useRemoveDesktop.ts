import { computed, ref } from 'vue'
import type { Desktop } from '@/domain/Desktop'
import desktops from '@/store/desktops'
import store from '@/store'
import { workspace_registry } from '@/store/workspaceRegistry'
import { is_missing_path_error } from '@/store/helpers/fsErrors'
import { is_desktop } from '@/isDesktop'
import {
	desktop_folder_has_children,
	remove_desktop_folder,
} from '@/services/desktop/desktopFolders'
import {
	browser_desktop_has_children,
	remove_browser_desktop,
} from '@/services/desktop/browserDesktopFolders'
import {
	count_desktop_children,
	remove_desktop_files,
} from '@/services/cloud/desktopRemoval'

// Singleton state: only one remove flow can be active app-wide, triggered
// from the desktop tab menu — the modal lives once in DesktopShell
// (RemoveDesktopModal.vue).
const pending = ref<Desktop | null>(null)
const confirm_open = ref(false)
/** cloud removal consequences shown in the confirm dialog */
const consequences = ref<{ workspaces: number; files: number } | null>(null)

function to_message(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

async function run_remove(desktop: Desktop) {
	// dispose before deleting any data so the fs watcher / realtime stops first
	workspace_registry.dispose_for_desktop(desktop.id)
	if (desktop.backend === 'cloud') {
		// optimistic row delete: child workspaces cascade via the desktop_id FK
		desktops.remove_desktop(desktop.id)
		try {
			await remove_desktop_files(desktop.id)
		} catch (error) {
			store.last_error = to_message(error)
		}
		return
	}
	if (desktop.path) {
		// adopted folder: detach only — the user's files stay on disk
		desktops.remove_desktop(desktop.id)
		return
	}
	if (!is_desktop) {
		// web local desktop: IndexedDB data — permanent delete, no trash
		try {
			await remove_browser_desktop(desktop.id)
		} catch (error) {
			store.last_error = to_message(error)
		}
		desktops.remove_desktop(desktop.id)
		return
	}
	try {
		await remove_desktop_folder(desktop)
	} catch (error) {
		// the folder may not exist (never had children) — that is fine
		if (!is_missing_path_error(error)) {
			store.last_error = to_message(error)
		}
	}
	desktops.remove_desktop(desktop.id)
}

const confirm_text = computed(() => {
	const desktop = pending.value
	if (!desktop) return ''
	if (desktop.backend === 'cloud') {
		const count = consequences.value
		const parts: string[] = []
		// a null count means the check failed — warn about both kinds
		if (!count || count.workspaces > 0) {
			const n = count?.workspaces ?? 0
			parts.push(
				`permanently deletes its ${n > 0 ? `${n} ` : ''}workspace${n === 1 ? '' : 's'} with everything inside`,
			)
		}
		if (!count || count.files > 0) {
			parts.push('moves the board files to the cloud trash')
		}
		return `Removing “${desktop.name}” ${parts.join(' and ')}.`
	}
	if (desktop.path) {
		return `Removing “${desktop.name}” only detaches it from the app. The folder ${desktop.path} and everything inside stays on disk.`
	}
	if (!is_desktop) {
		return `“${desktop.name}” still has files on it. Removing the desktop permanently deletes them from browser storage — there is no undo.`
	}
	return `“${desktop.name}” still has files on it. Removing the desktop moves its folder with everything inside to the Trash.`
})

export function useRemoveDesktop() {
	async function request_remove(desktop: Desktop) {
		if (desktops.desktops.length <= 1) return
		if (desktop.backend === 'cloud') {
			let count: { workspaces: number; files: number }
			try {
				count = await count_desktop_children(desktop.id)
			} catch {
				// unknown consequences — confirm rather than delete silently
				count = { workspaces: 1, files: 1 }
			}
			if (count.workspaces === 0 && count.files === 0) {
				await run_remove(desktop)
				return
			}
			pending.value = desktop
			consequences.value = count
			confirm_open.value = true
			return
		}
		const has_children = is_desktop
			? await desktop_folder_has_children(desktop)
			: await browser_desktop_has_children(desktop.id)
		if (!has_children) {
			await run_remove(desktop)
			return
		}
		pending.value = desktop
		consequences.value = null
		confirm_open.value = true
	}

	async function confirm_remove() {
		const desktop = pending.value
		pending.value = null
		consequences.value = null
		confirm_open.value = false
		if (desktop) await run_remove(desktop)
	}

	function cancel_remove() {
		pending.value = null
		consequences.value = null
		confirm_open.value = false
	}

	return { pending, confirm_open, confirm_text, request_remove, confirm_remove, cancel_remove }
}
