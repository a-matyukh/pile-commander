import { is_desktop } from '@/isDesktop'

/** A note: what the note editor opens. */
export function is_note_file(file_id: string): boolean {
	return /\.(md|txt)$/i.test(file_id)
}

/**
 * Where a note opens by default (stage 3 of TEXT_EDITING_PLAN.md): in the
 * note editor, except a local file on the desktop, which opens in the
 * system's program as before. The other way is in the file's menu.
 */
export function opens_in_editor(drive_id: string, file_id: string, desktop = is_desktop): boolean {
	if (!is_note_file(file_id)) return false
	return !(desktop && drive_id === 'local')
}
