import type { ClipboardStore, WorkspaceStore } from '@/domain/Store'
import { entry_clipboard } from './entryClipboard'

export default function makeClipboard(): Omit<ClipboardStore, 'clipboard' | 'paste' | 'duplicate_entries'> {
	return {
		copy_entries(this: WorkspaceStore, ids: string[]) {
			const entry_ids = unique_ids(ids)
			if (entry_ids.length === 0) return
			entry_clipboard.set({
				mode: 'copy',
				source_store: this,
				source_folder_id: this.opened_folder_id,
				entry_ids,
			})
		},
		cut_entries(this: WorkspaceStore, ids: string[]) {
			const entry_ids = unique_ids(ids)
			if (entry_ids.length === 0) return
			entry_clipboard.set({
				mode: 'cut',
				source_store: this,
				source_folder_id: this.opened_folder_id,
				entry_ids,
			})
		},
		clear_clipboard() {
			entry_clipboard.clear()
		},
		is_cut(this: WorkspaceStore, id: string): boolean {
			const clip = entry_clipboard.current
			// source identity matters: local ids are absolute paths and can
			// collide across stores (a window opened at a desktop subfolder)
			return clip?.mode === 'cut' && clip.source_store === this && clip.entry_ids.includes(id)
		},
	}
}

function unique_ids(ids: string[]): string[] {
	const seen = new Set<string>()
	const out: string[] = []
	for (const id of ids) {
		if (!id || seen.has(id)) continue
		seen.add(id)
		out.push(id)
	}
	return out
}
