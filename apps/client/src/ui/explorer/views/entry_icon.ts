import { is_note_name } from '@/services/ai/naming'
import { get_media_kind } from '@/services/board/media'

/** A file's icon by its kind, as the prototype's file_icon */
const BY_EXTENSION: Record<string, string> = {
	pdf: 'tabler:file-type-pdf',
	json: 'tabler:braces',
	lock: 'tabler:lock',
	pile: 'tabler:file-zip',
	zip: 'tabler:file-zip',
	dmg: 'tabler:package',
	fig: 'tabler:vector',
	ts: 'tabler:file-code',
	js: 'tabler:file-code',
	vue: 'tabler:file-code',
	txt: 'tabler:file-text',
}

export function file_icon(name: string): string {
	if (is_note_name(name)) return 'tabler:file-text'
	const kind = get_media_kind(name)
	if (kind === 'image') return 'tabler:photo'
	if (kind === 'video') return 'tabler:movie'
	if (kind === 'audio') return 'tabler:music'
	const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
	return BY_EXTENSION[ext] ?? 'tabler:file'
}
