import { sanitize_suggested_name, type NameStyle } from './naming'
import type { SummaryEntry, SummarySources } from './summarize'
import { extract_json } from './text'
import type { AiContentPart, AiMessage } from './types'

/**
 * "Sort into folders" with the app's own model: the folder is read the way
 * a summary reads it, the model answers a plan in JSON, and the plan goes
 * through the same preview and write as an agent's moves.
 */

/** More folders than this in one plan are left out. */
export const SORT_GROUP_LIMIT = 12

const SYSTEM_PROMPT = [
	'You sort the items of one folder in a visual file manager into folders inside it.',
	'Answer only JSON: {"folders":[{"name":"Folder name","items":["exact item name"]}]}.',
	'Use 2 to 8 folders. Items that end with "/" are folders already there: put things into one when it fits, by its name without "/".',
	'Leave out items that fit nowhere; they stay where they are. Never put a folder into itself or into a folder that goes into it.',
	'Copy item names exactly as listed. Name new folders in the language of the content, a few words each.',
].join(' ')

export function build_sort_messages(sources: SummarySources, folder_name: string): AiMessage[] {
	const text = [
		`Folder "${folder_name}" holds:`,
		sources.names.map(name => `- ${name}`).join('\n') || '(nothing)',
		...sources.notes.map(note => `\n## Note "${note.name}"\n${note.text}`),
	].join('\n')
	const content: AiContentPart[] = [{ type: 'text', text }]
	for (const image of sources.images) {
		content.push({ type: 'text', text: `Image "${image.name}":` })
		content.push({ type: 'image_url', image_url: { url: image.url } })
	}
	return [
		{ role: 'system', content: SYSTEM_PROMPT },
		{ role: 'user', content: sources.images.length ? content : text },
	]
}

export type SortPlanGroup = {
	/** A new folder's name, or the existing folder's own. */
	name: string
	existing_id: string | null
	entry_ids: string[]
}

const key = (name: string) => name.normalize('NFC').toLowerCase()
const bare = (name: string) => name.trim().replace(/\/+$/, '').trim()

/**
 * The model's plan, checked against what the folder holds: only items that
 * are there, each once; an existing folder is found by name without case; a
 * folder that receives items stays where it is; a new folder's name is made
 * safe in the naming style. Empty folders go; at most `SORT_GROUP_LIMIT`.
 */
export function parse_sort_plan(text: string, children: readonly SummaryEntry[], style?: NameStyle): SortPlanGroup[] {
	const answer = extract_json(text) as { folders?: unknown } | null
	if (!answer || !Array.isArray(answer.folders)) return []
	const by_name = new Map(children.map(child => [child.name, child]))
	const by_key = new Map(children.map(child => [key(child.name), child]))
	const find = (raw: string) => by_name.get(bare(raw)) ?? by_key.get(key(bare(raw)))

	// The folders first: an existing one is a target, so it does not move
	const groups = new Map<string, SortPlanGroup & { raw: unknown[] }>()
	for (const folder of answer.folders as unknown[]) {
		if (!folder || typeof folder !== 'object') continue
		const { name, items } = folder as { name?: unknown; items?: unknown }
		if (typeof name !== 'string' || !Array.isArray(items)) continue
		// A file's name is no target: the new folder is numbered when it is written
		const existing = find(name)
		const target = existing?.type === 'folder' ? existing : null
		const clean = target ? target.name : sanitize_suggested_name(bare(name), bare(name), 'folder', style)
		if (!clean) continue
		const group_key = key(clean)
		const group = groups.get(group_key)
		if (group) group.raw.push(...items)
		else groups.set(group_key, { name: clean, existing_id: target?.id ?? null, entry_ids: [], raw: [...items] })
	}
	const targets = new Set([...groups.values()].map(group => group.existing_id).filter(Boolean))
	const used = new Set<string>()
	for (const group of groups.values()) {
		for (const raw of group.raw) {
			if (typeof raw !== 'string') continue
			const child = find(raw)
			if (!child || used.has(child.id) || targets.has(child.id)) continue
			used.add(child.id)
			group.entry_ids.push(child.id)
		}
	}
	return [...groups.values()]
		.filter(group => group.entry_ids.length > 0)
		.slice(0, SORT_GROUP_LIMIT)
		.map(({ name, existing_id, entry_ids }) => ({ name, existing_id, entry_ids }))
}
