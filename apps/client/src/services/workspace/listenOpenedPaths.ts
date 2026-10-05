import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { applyOpenedPaths } from './folderRootFromPaths'

type ListenOpenedPathsOptions = {
	onFolderDrop: (path: string) => void | Promise<void>
	onPileOpen: (path: string) => void | Promise<void>
	onError: (message: string) => void
}

export async function listenOpenedPaths({
	onFolderDrop,
	onPileOpen,
	onError,
}: ListenOpenedPathsOptions): Promise<UnlistenFn> {
	const unlisten = await listen<string[]>('opened-paths', (event) => {
		void applyOpenedPaths(event.payload, { onFolderDrop, onPileOpen, onError })
	})

	const pending = await invoke<string[]>('take_opened_paths')
	if (pending.length > 0) {
		await applyOpenedPaths(pending, { onFolderDrop, onPileOpen, onError })
	}

	return unlisten
}
