import { relative_of } from './paths'

export type SyncFolderDeps = {
	/** The home folder: the app may only write below it (Tauri fs scope). */
	home: string
	/** Suggested parent, created if missing: `~/Pile Commander`. */
	suggested_parent: string
	/** Asks for the parent folder; null when the person cancels. */
	pick_parent(default_path: string): Promise<string | null>
	join(...parts: string[]): Promise<string>
	/** The folder is missing or empty: a new link may start in it. */
	is_free(path: string): Promise<boolean>
	mkdir(path: string): Promise<void>
}

/**
 * Picks the folder a cloud workspace downloads into on this computer: a new
 * folder named after the workspace inside the chosen parent, "Name (2)" and
 * on when that name holds something. Never a folder with files in it — a
 * first pass would adopt same-size files there without comparing bytes.
 * Returns null when the person cancels.
 */
export async function choose_sync_folder(deps: SyncFolderDeps, folder_name: string): Promise<string | null> {
	await deps.mkdir(deps.suggested_parent).catch(() => {})
	const parent = await deps.pick_parent(deps.suggested_parent)
	if (!parent) return null
	if (relative_of(deps.home, parent) === null) {
		throw new Error('Choose a folder inside your home folder.')
	}
	for (let n = 1; ; n++) {
		const candidate = await deps.join(parent, n === 1 ? folder_name : `${folder_name} (${n})`)
		if (await deps.is_free(candidate)) {
			await deps.mkdir(candidate)
			return candidate
		}
	}
}
