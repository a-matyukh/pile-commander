import type { WorkspaceStore } from '@/domain/Store'
import { ai_settings } from '@/store/ai'
import { ai_chat } from './client'
import { image_to_data_url } from './imageInput'
import {
	build_name_messages,
	first_line,
	is_note_name,
	name_target_kind,
	NAME_FOLDER_CHILD_LIMIT,
	NAME_FOLDER_NOTE_LIMIT,
	NAME_NOTE_CHAR_LIMIT,
	sanitize_suggested_name,
	type NameTarget,
} from './naming'
import type { AiTransport } from './types'

export type NameEntry = { id: string; name: string; type: 'file' | 'folder' }

type NameSources = Pick<WorkspaceStore, 'read_note_content' | 'get_media_src' | 'ensure_preview_folder' | 'resolve_folder_data'>

/** Raised for a file that cannot be read for naming; its message is shown as is. */
export class NameSkipped extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'NameSkipped'
	}
}

export async function collect_name_target(workspace: NameSources, entry: NameEntry): Promise<NameTarget> {
	const kind = name_target_kind(entry)
	if (kind === 'note') {
		const text = (await workspace.read_note_content(entry.id)).slice(0, NAME_NOTE_CHAR_LIMIT)
		if (!text.trim()) throw new NameSkipped('The note is empty')
		return { kind, name: entry.name, text }
	}
	if (kind === 'image') {
		const image_url = await image_to_data_url(workspace, entry.id, entry.name)
		if (!image_url) throw new NameSkipped('This image format can\'t be sent to a model')
		return { kind, name: entry.name, image_url }
	}
	if (kind === 'folder') {
		await workspace.ensure_preview_folder(entry.id)
		const children = (workspace.resolve_folder_data(entry.id)?.children ?? []).slice(0, NAME_FOLDER_CHILD_LIMIT)
		if (!children.length) throw new NameSkipped('The folder is empty')
		let notes_read = 0
		const listed = []
		for (const child of children) {
			let line: string | null = null
			if (child.type === 'file' && is_note_name(child.name) && notes_read < NAME_FOLDER_NOTE_LIMIT) {
				notes_read++
				line = first_line(await workspace.read_note_content(child.id))
			}
			listed.push({ name: child.name, first_line: line })
		}
		return { kind, name: entry.name, children: listed }
	}
	throw new NameSkipped('A name can be suggested for notes, folders and images')
}

type AskOptions = { signal?: AbortSignal; transport?: AiTransport }

/**
 * Asks the configured model to name a collected target. Collecting comes
 * first and separately, so consent is asked only for what can actually go.
 */
export async function ask_name(target: NameTarget, entry: NameEntry, options: AskOptions = {}): Promise<string> {
	const style = ai_settings.value.name_style
	const result = await ai_chat(build_name_messages(target, style), { signal: options.signal, temperature: 0.3 }, options.transport)
	const name = sanitize_suggested_name(result.text, entry.name, entry.type, style)
	if (!name) throw new NameSkipped('The model didn\'t suggest a usable name')
	return name
}

/** Collects and asks in one go, for callers that have consent already. */
export async function suggest_name(workspace: NameSources, entry: NameEntry, options: AskOptions = {}): Promise<string> {
	return ask_name(await collect_name_target(workspace, entry), entry, options)
}
