import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ai_settings, ai_vision, record_vision } from '@/store/ai'
import { new_row } from './bulkRename'
import { suggest_batch } from './bulkSuggest'
import { AiError, type AiMessage, type AiTransport } from './types'

vi.mock('./imageInput', () => ({
	image_to_data_url: vi.fn(async (_: unknown, id: string) => (id.endsWith('.heic') ? null : 'data:image/jpeg;base64,AA')),
}))

const base_url = 'http://localhost:11434/v1'
const model = 'qwen2.5vl'

const notes: Record<string, string> = {
	'/f/Note 1.md': 'Groceries',
	'/f/Note 2.md': 'Trip to Rome',
	'/f/Note 3.md': 'Budget',
}
const workspace = {
	read_note_content: async (id: string) => notes[id] ?? '',
	get_media_src: vi.fn(),
	ensure_preview_folder: async () => {},
	resolve_folder_data: () => null,
}

const entry = (name: string) => ({ id: `/f/${name}`, name, type: 'file' as const })

function has_image(messages: AiMessage[]) {
	return messages.some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image_url'))
}

function transport(answer: (messages: AiMessage[]) => Promise<string>): AiTransport & { calls: number } {
	const self = {
		calls: 0,
		chat: async (_: string, request: { messages: AiMessage[] }) => {
			self.calls++
			return { text: await answer(request.messages), truncated: false }
		},
		list_models: async () => [],
		has_key: async () => true,
		set_key: async () => {},
		delete_key: async () => {},
	}
	return self
}

function run(rows: ReturnType<typeof new_row>[], t: AiTransport, confirm = vi.fn(async () => true), signal = new AbortController().signal) {
	return { confirm, done: suggest_batch({ workspace, rows, concurrency: 1, signal, confirm, transport: t }) }
}

beforeEach(() => {
	ai_settings.value = { preset: 'ollama', base_url, model, name_style: 'kebab' }
	ai_vision.value = {}
})

describe('suggest_batch', () => {
	test('asks consent once for the whole batch, with images when there are any', async () => {
		const rows = [entry('Note 1.md'), entry('IMG_1.jpg'), entry('IMG_2.jpg')].map(new_row)
		const { confirm, done } = run(rows, transport(async messages => (has_image(messages) ? 'beach' : 'groceries')))
		await done
		expect(confirm).toHaveBeenCalledTimes(1)
		expect(confirm).toHaveBeenCalledWith(true)
		expect(rows.map(r => [r.status, r.suggestion, r.checked])).toEqual([
			['ready', 'groceries.md', true],
			['ready', 'beach.jpg', true],
			['ready', 'beach.jpg', true],
		])
	})

	test('reads everything before asking: an undecodable image never reaches the consent', async () => {
		const rows = [entry('Note 1.md'), { id: '/f/p.heic', name: 'p.jpg', type: 'file' as const }].map(new_row)
		const { confirm, done } = run(rows, transport(async () => 'groceries'))
		await done
		expect(confirm).toHaveBeenCalledWith(false)
		expect(rows[1]!.status).toBe('skipped')
	})

	test('a declined consent sends nothing', async () => {
		const rows = [entry('Note 1.md'), entry('Note 2.md')].map(new_row)
		const t = transport(async () => 'x')
		const outcome = await run(rows, t, vi.fn(async () => false)).done
		expect(outcome.consented).toBe(false)
		expect(t.calls).toBe(0)
		expect(rows.every(r => r.status === 'stopped')).toBe(true)
	})

	test('a server that is down stops the batch after the first row', async () => {
		const rows = [entry('Note 1.md'), entry('Note 2.md'), entry('Note 3.md')].map(new_row)
		const t = transport(async () => {
			throw new AiError({ kind: 'connect', status: null, message: 'refused' })
		})
		const outcome = await run(rows, t).done
		expect(t.calls).toBe(1)
		expect(outcome.stop_reason).toContain('ollama serve')
		expect(rows.map(r => r.status)).toEqual(['failed', 'stopped', 'stopped'])
	})

	test('a model without vision skips the images and still names the notes', async () => {
		const rows = [entry('IMG_1.jpg'), entry('IMG_2.jpg'), entry('Note 1.md')].map(new_row)
		const t = transport(async (messages) => {
			if (has_image(messages)) throw new AiError({ kind: 'bad_request', status: 400, message: 'Model does not support images' })
			return 'groceries'
		})
		await run(rows, t).done
		expect(rows.map(r => r.status)).toEqual(['skipped', 'skipped', 'ready'])
		expect(t.calls).toBe(2)
	})

	test('a model already known to refuse images is not asked about them', async () => {
		record_vision(base_url, model, false)
		const rows = [entry('IMG_1.jpg'), entry('Note 1.md')].map(new_row)
		const t = transport(async () => 'groceries')
		const { confirm, done } = run(rows, t)
		await done
		expect(rows[0]!.status).toBe('skipped')
		expect(confirm).toHaveBeenCalledWith(false)
		expect(t.calls).toBe(1)
	})

	test('a name the model kept is not offered for renaming', async () => {
		const rows = [entry('groceries.md')].map(new_row)
		notes['/f/groceries.md'] = 'milk'
		await run(rows, transport(async () => 'groceries')).done
		expect(rows[0]).toMatchObject({ status: 'same', checked: false })
	})

	test('a stop marks the rows not asked yet', async () => {
		const controller = new AbortController()
		const rows = [entry('Note 1.md'), entry('Note 2.md'), entry('Note 3.md')].map(new_row)
		const t = transport(async () => {
			controller.abort()
			return 'first'
		})
		await run(rows, t, vi.fn(async () => true), controller.signal).done
		expect(rows.map(r => r.status)).toEqual(['ready', 'stopped', 'stopped'])
	})
})
