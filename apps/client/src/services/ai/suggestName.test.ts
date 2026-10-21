import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { FolderWithChildrenXattrs } from '@pile-commander/file-manager'
import { ai_settings, ai_vision, vision_support } from '@/store/ai'
import { collect_name_target, NameSkipped, suggest_name } from './suggestName'
import type { AiMessage, AiTransport } from './types'

vi.mock('./imageInput', () => ({
	image_to_data_url: vi.fn(async (_: unknown, id: string) => (id.endsWith('.heic') ? null : 'data:image/jpeg;base64,AA')),
}))

function workspace(notes: Record<string, string> = {}, folders: Record<string, FolderWithChildrenXattrs> = {}) {
	return {
		read_note_content: vi.fn(async (id: string) => notes[id] ?? ''),
		get_media_src: vi.fn(),
		ensure_preview_folder: vi.fn(async () => {}),
		resolve_folder_data: (id: string) => folders[id] ?? null,
	}
}

function answering(text: string, seen: AiMessage[][] = []): AiTransport {
	return {
		chat: async (_, request) => {
			seen.push(request.messages)
			return { text, truncated: false }
		},
		list_models: async () => [],
		has_key: async () => false,
		set_key: async () => {},
		delete_key: async () => {},
	}
}

beforeEach(() => {
	ai_settings.value = { preset: 'ollama', base_url: 'http://localhost:11434/v1', model: 'qwen2.5vl', name_style: 'kebab' }
	ai_vision.value = {}
})

describe('collect_name_target', () => {
	test('a folder lists children and reads only its notes', async () => {
		const ws = workspace({ '/w/a/plan.md': '# Trip to Rome\nday 1' }, {
			'/w/a': {
				id: '/w/a',
				name: 'a',
				type: 'folder',
				xattrs: [],
				children: [
					{ id: '/w/a/plan.md', name: 'plan.md', type: 'file', xattrs: [] },
					{ id: '/w/a/IMG_1.jpg', name: 'IMG_1.jpg', type: 'file', xattrs: [] },
				],
			},
		})
		const target = await collect_name_target(ws, { id: '/w/a', name: 'a', type: 'folder' })
		expect(target).toEqual({
			kind: 'folder',
			name: 'a',
			children: [{ name: 'plan.md', first_line: 'Trip to Rome' }, { name: 'IMG_1.jpg', first_line: null }],
		})
		expect(ws.ensure_preview_folder).toHaveBeenCalledWith('/w/a')
		expect(ws.read_note_content).toHaveBeenCalledTimes(1)
	})

	test('an empty note, an empty folder, an undecodable image and other files are skipped', async () => {
		const ws = workspace()
		await expect(collect_name_target(ws, { id: '/w/n.md', name: 'n.md', type: 'file' })).rejects.toBeInstanceOf(NameSkipped)
		await expect(collect_name_target(ws, { id: '/w/f', name: 'f', type: 'folder' })).rejects.toBeInstanceOf(NameSkipped)
		await expect(collect_name_target(ws, { id: '/w/p.heic', name: 'p.jpg', type: 'file' })).rejects.toBeInstanceOf(NameSkipped)
		await expect(collect_name_target(ws, { id: '/w/c.mp4', name: 'c.mp4', type: 'file' })).rejects.toBeInstanceOf(NameSkipped)
	})
})

describe('suggest_name', () => {
	test('names an image through an image part and keeps its extension', async () => {
		const seen: AiMessage[][] = []
		const name = await suggest_name(
			workspace(),
			{ id: '/w/IMG_4823.jpg', name: 'IMG_4823.jpg', type: 'file' },
			{ transport: answering('<think>a bag</think>orange-bag-on-concrete-pillar', seen) },
		)
		expect(name).toBe('orange-bag-on-concrete-pillar.jpg')
		const content = seen[0]![1]!.content
		expect(Array.isArray(content) && content.some(part => part.type === 'image_url')).toBe(true)
		expect(vision_support('http://localhost:11434/v1', 'qwen2.5vl')).toBe(true)
	})

	test('names a note from its text', async () => {
		const name = await suggest_name(
			workspace({ '/w/Note 1.md': 'Groceries: milk, eggs' }),
			{ id: '/w/Note 1.md', name: 'Note 1.md', type: 'file' },
			{ transport: answering('grocery-list') },
		)
		expect(name).toBe('grocery-list.md')
	})

	test('follows the name style from the settings', async () => {
		ai_settings.value = { ...ai_settings.value, name_style: 'spaces' }
		const seen: AiMessage[][] = []
		const name = await suggest_name(
			workspace({ '/w/Note 1.md': 'Groceries: milk, eggs' }),
			{ id: '/w/Note 1.md', name: 'Note 1.md', type: 'file' },
			{ transport: answering('grocery-list', seen) },
		)
		expect(name).toBe('Grocery list.md')
		expect(seen[0]![0]!.content).toContain('separated by spaces')
	})

	test('an unusable answer is reported, not applied', async () => {
		await expect(suggest_name(
			workspace({ '/w/n.md': 'text' }),
			{ id: '/w/n.md', name: 'n.md', type: 'file' },
			{ transport: answering('<think>never finished') },
		)).rejects.toBeInstanceOf(NameSkipped)
	})
})
