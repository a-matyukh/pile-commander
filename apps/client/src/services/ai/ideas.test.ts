import { describe, expect, test } from 'vitest'
import { build_idea_messages, idea_note, IDEA_PROMPT_LIMIT, parse_ideas } from './ideas'
import type { SummarySources } from './summarize'

const sources: SummarySources = {
	names: ['Harbor.jpg', 'Mood.md'],
	notes: [{ name: 'Mood.md', text: 'warm light' }],
	images: [],
	notes_full: 1,
	notes_total: 1,
	images_total: 1,
	images_refused: false,
}

describe('parse_ideas', () => {
	test('## titles with their sentences', () => {
		expect(parse_ideas('## Fog at dawn\nShoot the pier.\n\n## Lighthouse\nUp close.', true)).toEqual({
			ideas: [
				{ title: 'Fog at dawn', body: 'Shoot the pier.' },
				{ title: 'Lighthouse', body: 'Up close.' },
			],
			writing: null,
		})
	})

	test('while streaming, the last idea is still being written', () => {
		expect(parse_ideas('## Fog\nShoot.\n## Light', false)).toEqual({
			ideas: [{ title: 'Fog', body: 'Shoot.' }],
			writing: { title: 'Light', body: '' },
		})
		expect(parse_ideas('Sure! Here', false)).toEqual({ ideas: [], writing: null })
	})

	test('a preamble and a "# Ideas" heading above the ideas are dropped', () => {
		const answer = 'Here are some ideas:\n\n# Ideas for the harbor\n\n## Fog\nA.\n## Rust\nB.'
		expect(parse_ideas(answer, true).ideas.map(idea => idea.title)).toEqual(['Fog', 'Rust'])
	})

	test('reasoning, numbering and bold in titles are cleaned', () => {
		const answer = '<think>## Not an idea</think>## 1. **Fog at dawn**:\nShoot.\n## Idea 2) Rope & rust\nB.'
		expect(parse_ideas(answer, true).ideas.map(idea => idea.title)).toEqual(['Fog at dawn', 'Rope & rust'])
	})

	test('another heading level, or bold lines when there are no headings', () => {
		expect(parse_ideas('### A\nx\n### B\ny', true).ideas.map(idea => idea.title)).toEqual(['A', 'B'])
		expect(parse_ideas('**A**\nx\n\n**B:**\ny', true).ideas).toEqual([
			{ title: 'A', body: 'x' },
			{ title: 'B', body: 'y' },
		])
	})

	test('nothing usable', () => {
		expect(parse_ideas('', true)).toEqual({ ideas: [], writing: null })
		expect(parse_ideas('I cannot help with that.', true)).toEqual({ ideas: [], writing: null })
	})
})

describe('idea_note', () => {
	test('the title names the file and heads the note', () => {
		expect(idea_note({ title: 'Fog at dawn', body: 'Shoot the pier.' })).toEqual({
			name: 'Fog at dawn.md',
			text: '# Fog at dawn\n\nShoot the pier.',
		})
		expect(idea_note({ title: 'Rope / rust?', body: '' }, 'kebab')).toEqual({
			name: 'rope-rust.md',
			text: '# Rope / rust?',
		})
	})
})

describe('build_idea_messages', () => {
	test('the board, the wish and what was already shown', () => {
		const [system, user] = build_idea_messages(sources, 'Harbor', '  sunrise shots  ', ['Fog'])
		expect(system?.role).toBe('system')
		expect(user?.content).toContain('Board "Harbor" holds:')
		expect(user?.content).toContain('- Harbor.jpg')
		expect(user?.content).toContain('## Note "Mood.md"\nwarm light')
		expect(user?.content).toContain('The person asks for ideas about: sunrise shots')
		expect(user?.content).toContain('Already suggested, do not repeat:\n- Fog')
	})

	test('a long wish is cut, an empty one is left out', () => {
		const [, long] = build_idea_messages(sources, 'Harbor', 'x'.repeat(IDEA_PROMPT_LIMIT + 50))
		expect(String(long?.content)).toContain(`about: ${'x'.repeat(IDEA_PROMPT_LIMIT)}\n`.trimEnd())
		expect(String(long?.content)).not.toContain('x'.repeat(IDEA_PROMPT_LIMIT + 1))
		const [, none] = build_idea_messages(sources, 'Harbor', '   ')
		expect(String(none?.content)).not.toContain('asks for ideas')
	})

	test('images go as parts when there are any', () => {
		const [, user] = build_idea_messages({ ...sources, images: [{ name: 'Harbor.jpg', url: 'data:image/jpeg;base64,AA' }] }, 'Harbor', '')
		expect(Array.isArray(user?.content)).toBe(true)
		expect(user?.content).toContainEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA' } })
	})
})
