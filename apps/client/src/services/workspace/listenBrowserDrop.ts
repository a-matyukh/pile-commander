import type { Ref } from 'vue'

export type BrowserDroppedFiles = {
	files: File[]
	/** Webview client coords of the drop. */
	client: { x: number, y: number }
	/** Folders in the drop: the browser gives no way to copy them, so they are left out. */
	skipped_folders: number
}

type ListenBrowserDropOptions = {
	onFilesDrop: (payload: BrowserDroppedFiles) => void
	dragOver: Ref<boolean>
}

/** Only drags from the system carry files; the app's own drags (tabs, cards) do not. */
function carries_files(event: DragEvent): boolean {
	return event.dataTransfer?.types.includes('Files') ?? false
}

/** Files of the drop, without folders (a folder comes through as an empty "file"). */
export function dropped_files(data: DataTransfer): { files: File[], skipped_folders: number } {
	const files: File[] = []
	let skipped_folders = 0
	const items = [...data.items].filter(item => item.kind === 'file')
	if (items.length === 0) return { files: [...data.files], skipped_folders }
	for (const item of items) {
		const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
		if (entry?.isDirectory) {
			skipped_folders += 1
			continue
		}
		const file = item.getAsFile()
		if (file) files.push(file)
	}
	return { files, skipped_folders }
}

/**
 * The browser build's file drop: files dragged from the system onto the
 * window go into the folder on screen, the way the desktop takes them through
 * Tauri (listenFolderDrop). Returns the function that stops listening.
 */
export function listenBrowserDrop({ onFilesDrop, dragOver }: ListenBrowserDropOptions): () => void {
	// dragenter and dragleave fire for every child the cursor crosses
	let depth = 0

	const on_enter = (event: DragEvent) => {
		if (!carries_files(event)) return
		event.preventDefault()
		depth += 1
		dragOver.value = true
	}
	const on_over = (event: DragEvent) => {
		if (!carries_files(event)) return
		// Without this the browser opens the file in the tab instead of dropping it
		event.preventDefault()
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
		dragOver.value = true
	}
	const on_leave = (event: DragEvent) => {
		if (!carries_files(event)) return
		depth = Math.max(0, depth - 1)
		if (depth === 0) dragOver.value = false
	}
	const on_drop = (event: DragEvent) => {
		if (!carries_files(event) || !event.dataTransfer) return
		event.preventDefault()
		depth = 0
		dragOver.value = false
		const { files, skipped_folders } = dropped_files(event.dataTransfer)
		onFilesDrop({ files, client: { x: event.clientX, y: event.clientY }, skipped_folders })
	}

	window.addEventListener('dragenter', on_enter)
	window.addEventListener('dragover', on_over)
	window.addEventListener('dragleave', on_leave)
	window.addEventListener('drop', on_drop)
	return () => {
		window.removeEventListener('dragenter', on_enter)
		window.removeEventListener('dragover', on_over)
		window.removeEventListener('dragleave', on_leave)
		window.removeEventListener('drop', on_drop)
	}
}
