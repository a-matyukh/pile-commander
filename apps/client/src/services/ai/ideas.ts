import { sanitize_suggested_name, type NameStyle } from './naming'
import type { SummarySources } from './summarize'
import { strip_think } from './text'
import type { AiContentPart, AiMessage } from './types'

/**
 * "Generate ideas" with the app's own model: the board is read the way a
 * summary reads it, the model answers ideas in Markdown, and each idea
 * becomes a new note through the same preview and write as an agent's.
 */

/** Ideas per request; "More" asks for as many again. */
export const IDEAS_PER_ASK = 5
/** Characters of the person's wish that go into the request. */
export const IDEA_PROMPT_LIMIT = 500
/** Titles already shown that a "More" request must not repeat. */
const REPEAT_LIMIT = 40

export type Idea = { title: string; body: string }

const SYSTEM_PROMPT = [
	'You suggest ideas for a board in a visual file manager, from what the board holds.',
	`Suggest ${IDEAS_PER_ASK} new ideas that would fit next to it: things to make, try, add or explore.`,
	'Write each idea as Markdown: a line "## " and a short title of a few words, then one to three sentences.',
	'No preamble, no numbering, no closing remarks.',
	'Write in the language of the person\'s request when there is one, otherwise in the language of the content.',
].join(' ')

export function build_idea_messages(
	sources: SummarySources,
	board_name: string,
	prompt: string,
	shown_titles: readonly string[] = [],
): AiMessage[] {
	const wish = prompt.trim().slice(0, IDEA_PROMPT_LIMIT)
	const text = [
		`Board "${board_name}" holds:`,
		sources.names.map(name => `- ${name}`).join('\n') || '(nothing)',
		...sources.notes.map(note => `\n## Note "${note.name}"\n${note.text}`),
		...(wish ? [`\nThe person asks for ideas about: ${wish}`] : []),
		...(shown_titles.length
			? [`\nAlready suggested, do not repeat:\n${shown_titles.slice(-REPEAT_LIMIT).map(title => `- ${title}`).join('\n')}`]
			: []),
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

const HEADING = /^(#{1,4})\s+(.+?)\s*#*$/
const BOLD_LINE = /^\*\*(.+?)\*\*:?$/

/**
 * The ideas in a model's answer, which may still be streaming: every idea
 * whose next title has begun is whole; the last one is whole only when the
 * answer is `done`, otherwise it comes back as `writing`. Titles are the
 * `##` headings the prompt asks for, else the first heading level used,
 * else lines that are all bold; a `# Ideas for…` above `##` ideas and any
 * preamble are dropped.
 */
export function parse_ideas(text: string, done: boolean): { ideas: Idea[]; writing: Idea | null } {
	const lines = strip_think(text).split('\n').map(line => line.trim())
	const levels = lines.map(line => HEADING.exec(line)?.[1]?.length ?? 0)
	const level = levels.includes(2) ? 2 : (levels.find(found => found > 0) ?? 0)
	const title_of = (line: string, index: number): string | null => {
		if (level) return levels[index] === level ? HEADING.exec(line)![2]! : null
		return BOLD_LINE.exec(line)?.[1] ?? null
	}
	const ideas: Idea[] = []
	let current: { title: string; lines: string[] } | null = null
	const finish = () => {
		if (!current) return
		const title = clean_title(current.title)
		if (title) ideas.push({ title, body: current.lines.join('\n').trim() })
	}
	lines.forEach((line, index) => {
		const title = title_of(line, index)
		if (title !== null) {
			finish()
			current = { title, lines: [] }
		} else if (current) {
			current.lines.push(line)
		}
	})
	if (done) {
		finish()
		return { ideas, writing: null }
	}
	const writing = current ? { title: clean_title(current.title), body: current.lines.join('\n').trim() } : null
	return { ideas, writing }
}

/** "1. **Fog at dawn**:" → "Fog at dawn" */
function clean_title(raw: string): string {
	return raw
		.replace(/^\s*(?:idea\s*)?\d+\s*[.):-]\s*/i, '')
		.replace(/[*_`]/g, '')
		.replace(/[\s:–—-]+$/u, '')
		.trim()
}

/** The note an idea becomes: its title as the file name and as the first heading. */
export function idea_note(idea: Idea, style?: NameStyle): { name: string; text: string } {
	const name = sanitize_suggested_name(idea.title, 'idea.md', 'file', style) ?? 'Idea.md'
	const text = idea.body ? `# ${idea.title}\n\n${idea.body}` : `# ${idea.title}`
	return { name, text }
}
