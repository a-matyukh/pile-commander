type PickedFolder = { folder_id: string; name: string }

export type PickFolderOptions = {
	title?: string
}

export
interface WindowManager {
	pick_folder(options?: PickFolderOptions): Promise<PickedFolder | null>  // null = user canceled
	/** Save dialog for a `.pile` workspace pack. Null = canceled. */
	save_pile_file(default_name: string): Promise<string | null>
	/** Open dialog for a `.pile` workspace pack. Null = canceled. */
	pick_pile_file(): Promise<string | null>
	close(): Promise<void>
	minimize(): Promise<void>
	hide(): Promise<void>
}
