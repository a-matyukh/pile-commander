import { describe, expect, test } from 'vitest'
import { build_sort_messages, parse_sort_plan, SORT_GROUP_LIMIT } from './sort'
import type { SummaryEntry, SummarySources } from './summarize'

const children: SummaryEntry[] = [
	{ id: '/f/beach.jpg', name: 'beach.jpg', type: 'file' },
	{ id: '/f/sunset.jpg', name: 'sunset.jpg', type: 'file' },
	{ id: '/f/plan.md', name: 'plan.md', type: 'file' },
	{ id: '/f/Photos', name: 'Photos', type: 'folder' },
	{ id: '/f/Old', name: 'Old', type: 'folder' },
]

const plan = (folders: unknown) => JSON.stringify({ folders })

describe('parse_sort_plan', () => {
	test('existing folders by name without case, new ones made safe, items each once', () => {
		const groups = parse_sort_plan(plan([
			{ name: 'photos/', items: ['beach.jpg', 'sunset.jpg'] },
			{ name: 'Work: plans?', items: ['plan.md', 'beach.jpg'] },
		]), children)
		expect(groups).toEqual([
			{ name: 'Photos', existing_id: '/f/Photos', entry_ids: ['/f/beach.jpg', '/f/sunset.jpg'] },
			{ name: 'Work- plans', existing_id: null, entry_ids: ['/f/plan.md'] },
		])
	})

	test('unknown names go, a folder that receives stays, a folder never goes into itself', () => {
		const groups = parse_sort_plan(plan([
			{ name: 'Photos', items: ['gone.jpg', 'Photos', 'beach.jpg'] },
			{ name: 'Archive', items: ['Photos/', 'Old/'] },
		]), children)
		expect(groups).toEqual([
			{ name: 'Photos', existing_id: '/f/Photos', entry_ids: ['/f/beach.jpg'] },
			{ name: 'Archive', existing_id: null, entry_ids: ['/f/Old'] },
		])
	})

	test('the same folder twice is one group; empty groups go; reasoning and fences around are fine', () => {
		const answer = `<think>hmm</think>Here:\n\`\`\`json\n${plan([
			{ name: 'Notes', items: ['plan.md'] },
			{ name: 'notes', items: ['sunset.jpg'] },
			{ name: 'Empty', items: [] },
		])}\n\`\`\``
		expect(parse_sort_plan(answer, children)).toEqual([
			{ name: 'Notes', existing_id: null, entry_ids: ['/f/plan.md', '/f/sunset.jpg'] },
		])
	})

	test('the naming style applies to new folders', () => {
		expect(parse_sort_plan(plan([{ name: 'Beach Photos', items: ['beach.jpg'] }]), children, 'kebab')[0]?.name).toBe('beach-photos')
	})

	test('not a plan, or too many folders', () => {
		expect(parse_sort_plan('No idea.', children)).toEqual([])
		expect(parse_sort_plan('{"folders": "x"}', children)).toEqual([])
		const many = Array.from({ length: 20 }, (_, index) => ({ id: `/f/i${index}`, name: `i${index}`, type: 'file' as const }))
		const groups = parse_sort_plan(plan(many.map((entry, index) => ({ name: `G${index}`, items: [entry.name] }))), many)
		expect(groups).toHaveLength(SORT_GROUP_LIMIT)
	})
})

describe('build_sort_messages', () => {
	test('the folder, its names with folders marked, the notes', () => {
		const sources: SummarySources = {
			names: ['beach.jpg', 'Photos/'],
			notes: [{ name: 'plan.md', text: 'ship it' }],
			images: [],
			notes_full: 1,
			notes_total: 1,
			images_total: 1,
			images_refused: false,
		}
		const [system, user] = build_sort_messages(sources, 'Pile')
		expect(String(system?.content)).toContain('Answer only JSON')
		expect(user?.content).toContain('Folder "Pile" holds:\n- beach.jpg\n- Photos/')
		expect(user?.content).toContain('## Note "plan.md"\nship it')
	})
})
