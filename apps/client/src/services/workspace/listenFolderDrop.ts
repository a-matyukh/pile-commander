import { getCurrentWindow } from '@tauri-apps/api/window'
import type { Ref } from 'vue'
import type { PhysicalPosition } from '@tauri-apps/api/dpi'
import { applyWorkspaceDropPaths } from './folderRootFromPaths'
import type { Position } from '@/domain/Widget'
import { resolveExternalDropPosition } from '@/ui/workspace/folder-container/externalDropPosition'
import { dropPositionToClient } from './dropClientPosition'

export type DroppedFilesPayload = {
	paths: string[]
	/** Board/canvas widget position under the cursor, when resolvable. */
	position: Position | null
	/** Webview client coords of the drop (window hit-testing in desktops mode). */
	client: Position | null
}

export type DroppedFolderPayload = {
	path: string
	/** Webview client coords of the drop (window hit-testing in desktops mode). */
	client: Position | null
}

type ListenFolderDropOptions = {
	onFolderDrop: (payload: DroppedFolderPayload) => void | Promise<void>
	onFilesDrop: (payload: DroppedFilesPayload) => void | Promise<void>
	onPileOpen: (path: string) => void | Promise<void>
	onError: (message: string) => void
	dragOver: Ref<boolean>
}

export async function listenFolderDrop({
	onFolderDrop,
	onFilesDrop,
	onPileOpen,
	onError,
	dragOver,
}: ListenFolderDropOptions): Promise<() => void> {
	let externalFileDragActive = false

	return getCurrentWindow().onDragDropEvent((event) => {
		if (event.payload.type === 'enter') {
			if (event.payload.paths.length > 0) {
				externalFileDragActive = true
				dragOver.value = true
			}
		} else if (event.payload.type === 'over') {
			if (externalFileDragActive) {
				dragOver.value = true
			}
		} else if (event.payload.type === 'drop') {
			externalFileDragActive = false
			dragOver.value = false
			const paths = event.payload.paths
			// WKWebView also reports in-webview HTML5 drags (tab/widget reorder)
			// here — with an empty path list; those are not OS file drops
			if (paths.length === 0) return
			const physical = event.payload.position as PhysicalPosition
			void (async () => {
				let client: Position | null = null
				let position: Position | null = null
				try {
					client = await dropPositionToClient(physical)
					position = resolveExternalDropPosition(client.x, client.y)
				} catch {
					client = null
					position = null
				}
				await applyWorkspaceDropPaths(paths, {
					onFolderDrop: (path) => onFolderDrop({ path, client }),
					onFilesDrop: (filePaths) => onFilesDrop({ paths: filePaths, position, client }),
					onPileOpen,
					onError,
				})
			})()
		} else {
			externalFileDragActive = false
			dragOver.value = false
		}
	})
}
