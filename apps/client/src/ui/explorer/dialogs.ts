import { ref } from 'vue'

/** What the shell's dialogs expose: the old interface's Share and Publish */
type WorkspaceDialog = { open(workspace_id: string): void }

/**
 * The Share and Publish dialogs are mounted once, in the Explorer shell.
 * Menus open them through these refs with a cloud top-level folder's id
 */
export const share_dialog = ref<WorkspaceDialog>()
export const publish_dialog = ref<WorkspaceDialog>()

/**
 * A dialog opened from a menu can leave the page without pointer events
 * when it closes (the old window clears them the same way)
 */
export function unlock_pointers() {
	const clear = () => document.body.style.removeProperty('pointer-events')
	clear()
	requestAnimationFrame(clear)
	window.setTimeout(clear, 0)
}
