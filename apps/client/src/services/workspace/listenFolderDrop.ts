import { getCurrentWindow } from '@tauri-apps/api/window'
import type { Ref } from 'vue'
import type { PhysicalPosition } from '@tauri-apps/api/dpi'
import { applyWorkspaceDropPaths } from './folderRootFromPaths'
import type { Position } from '@/domain/Widget'
import { resolveExternalDropPosition } from '@/ui/workspace/folder-container/externalDropPosition'
import { dropPositionToClient, type ClientPoint } from './dropClientPosition'

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
	/** Cursor in client coordinates while the OS drag is over the window. */
	onDragMove?: (client: ClientPoint) => void
}

export async function listenFolderDrop({
	onFolderDrop,
	onFilesDrop,
	onPileOpen,
	onError,
	dragOver,
	onDragMove,
}: ListenFolderDropOptions): Promise<() => void> {
	let externalFileDragActive = false
	let moveGen = 0

	function track(position: PhysicalPosition) {
		const gen = ++moveGen
		void dropPositionToClient(position).then((client) => {
			if (gen !== moveGen || !externalFileDragActive) return
			onDragMove?.(client)
		}).catch(() => {})
	}

	return getCurrentWindow().onDragDropEvent((event) => {
		if (event.payload.type === 'enter') {
			if (event.payload.paths.length > 0) {
				externalFileDragActive = true
				dragOver.value = true
				track(event.payload.position as PhysicalPosition)
			}
		} else if (event.payload.type === 'over') {
			if (externalFileDragActive) {
				dragOver.value = true
				track(event.payload.position as PhysicalPosition)
			}
		} else if (event.payload.type === 'drop') {
			moveGen++
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
			moveGen++
			externalFileDragActive = false
			dragOver.value = false
		}
	})
}
