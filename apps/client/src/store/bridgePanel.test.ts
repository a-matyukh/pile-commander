import { afterEach, describe, expect, test } from 'vitest'
import type { BridgePreflight } from '@/services/cloud/bridge/preflight'
import { explorer_language } from '@/store/explorer/language'
import {
	bridge_hidden_tip,
	bridge_panel_text,
	bridge_panel_view,
	type BridgePanelInput,
} from './bridgePanel'
import type { BridgeDoor, BridgeStep } from './bridge'

afterEach(() => {
	explorer_language.value = 'system'
})

function file(partial: Partial<BridgePreflight['files'][number]> & { relative: string; size_bytes: number }): BridgePreflight['files'][number] {
	return {
		id: `/${partial.relative}`,
		name: partial.relative,
		mime: 'text/plain',
		kind: 'text',
		over_file_limit: false,
		bad_name: false,
		text_as_blob: false,
		...partial,
	}
}

function measured(files: BridgePreflight['files'], extra: Partial<BridgePreflight> = {}): BridgePreflight {
	const blocked = files.filter(item => item.over_file_limit || item.bad_name)
	return {
		folders: ['board'],
		files,
		total_bytes: files.reduce((sum, item) => sum + item.size_bytes, 0),
		largest: files[0] ?? null,
		bytes_by_kind: { image: 0, video: 0, audio: 0, text: 10, other: 0 },
		limits: { quota_bytes: 1_000_000, used_bytes: 0, max_file_bytes: 500_000 },
		free_bytes: 1_000_000,
		blocked,
		over_quota: false,
		suggested_exclude: blocked.map(item => item.relative),
		...extra,
	}
}

function input(patch: Partial<BridgePanelInput> = {}): BridgePanelInput {
	return {
		door: 'device',
		step: 'summary',
		source_name: 'Notes',
		preflight: measured([file({ relative: 'a.txt', size_bytes: 10 })]),
		exclude: [],
		pro: null,
		pro_step: 'idle',
		resumable: false,
		copied: false,
		progress: null,
		error: null,
		plan: 'free',
		...patch,
	}
}

const doors: BridgeDoor[] = ['share', 'publish', 'device', 'sync']

describe('bridge panel copy', () => {
	test('each door has its own title on every early step', () => {
		explorer_language.value = 'en'
		const steps: BridgeStep[] = ['auth', 'measuring', 'error']
		for (const door of doors) {
			for (const step of steps) {
				const view = bridge_panel_view(input({ door, step, error: 'disk full', preflight: null }))
				expect(view.title.length).toBeGreaterThan(0)
				expect(view.source_name).toBe('Notes')
				if (step === 'auth') expect(view.lead.length).toBeGreaterThan(0)
				if (step === 'measuring') expect(view.track).toBe('slide')
				if (step === 'error') expect(view.note).toBe('disk full')
			}
		}
		expect(bridge_panel_view(input({ door: 'share', step: 'auth' })).title).toBe('Share this folder')
		expect(bridge_panel_view(input({ door: 'publish', step: 'auth' })).title).toBe('Publish this folder')
		expect(bridge_panel_view(input({ door: 'device', step: 'auth' })).title).toBe('Copy to cloud')
		expect(bridge_panel_view(input({ door: 'sync', step: 'auth' })).title).toBe('Sync with the cloud')
	})

	test('summary counts files, names the plan, and offers the door action', () => {
		explorer_language.value = 'en'
		const sync = bridge_panel_view(input({ door: 'sync' }))
		expect(sync.summary).toContain('1 file')
		expect(sync.summary).toContain('largest')
		expect(sync.plan_line).toContain('Free')
		expect(sync.primary).toBe('Start sync')
		expect(sync.primary_disabled).toBe(false)

		explorer_language.value = 'ru'
		const ru = bridge_panel_view(input({
			door: 'device',
			preflight: measured([
				file({ relative: 'a.txt', size_bytes: 10 }),
				file({ relative: 'b.txt', size_bytes: 10 }),
				file({ relative: 'c.txt', size_bytes: 10 }),
			]),
		}))
		expect(ru.summary).toContain('3 файла')
		expect(bridge_panel_view(input({
			preflight: measured(Array.from({ length: 5 }, (_, i) => file({ relative: `${i}.txt`, size_bytes: 10 }))),
		})).summary).toContain('5 файлов')
	})

	test('a quota wall lists heavy files, disables blocked ones, and stops the copy', () => {
		explorer_language.value = 'ru'
		const blocked = file({
			relative: 'movie.mov',
			size_bytes: 9_000_000,
			kind: 'video',
			over_file_limit: true,
		})
		const heavy = file({ relative: 'photo.png', size_bytes: 2_000_000, kind: 'image' })
		const kept = file({ relative: 'notes.txt', size_bytes: 500 })
		const view = bridge_panel_view(input({
			door: 'device',
			exclude: ['movie.mov', 'photo.png'],
			pro: { quota_bytes: 50_000_000_000, max_file_bytes: 2_000_000_000 },
			preflight: measured([blocked, heavy, kept], {
				over_quota: true,
				free_bytes: 100,
				blocked: [blocked],
				suggested_exclude: ['movie.mov', 'photo.png'],
			}),
		}))
		expect(view.fit_line).toContain('Не хватает')
		expect(view.primary).toBe('Скопировать без тяжёлых')
		expect(view.primary_disabled).toBe(true)
		expect(view.show_pro).toBe(true)
		expect(view.plan_line).toContain('Pro')
		const movie = view.files.find(item => item.relative === 'movie.mov')
		expect(movie?.disabled).toBe(true)
		expect(movie?.included).toBe(false)
		expect(movie?.label).toContain('на файл')
		const photo = view.files.find(item => item.relative === 'photo.png')
		expect(photo?.disabled).toBe(false)
		expect(photo?.included).toBe(false)
	})

	test('an unfinished copy asks to resume or delete it', () => {
		explorer_language.value = 'ru'
		const view = bridge_panel_view(input({ door: 'sync', resumable: true }))
		expect(view.resumable_note).toContain('не закончилась')
		expect(view.primary).toBe('Продолжить загрузку')
		expect(bridge_panel_text(view)).toContain('Продолжить загрузку')
	})

	test('copying names folders, then files, and hides a name until the upload starts', () => {
		explorer_language.value = 'ru'
		const folders = bridge_panel_view(input({
			step: 'copying',
			progress: {
				phase: 'folders',
				folders_done: 2,
				total_folders: 5,
				loaded_bytes: 0,
				total_bytes: 100,
				files_done: 0,
				total_files: 13,
				current: 'photo.png',
			},
		}))
		expect(folders.note).toBe('Создаю папки: 2 из 5')
		expect(folders.file_name).toBeNull()
		expect(bridge_panel_text(folders)).not.toContain('photo.png')

		const waiting = bridge_panel_view(input({
			step: 'copying',
			progress: {
				phase: 'files',
				folders_done: 5,
				total_folders: 5,
				loaded_bytes: 0,
				total_bytes: 100,
				files_done: 0,
				total_files: 13,
				current: null,
			},
		}))
		expect(waiting.note).toBe('Загружаю файлы: 0 из 13')
		expect(waiting.file_name).toBeNull()
		expect(bridge_panel_text(waiting)).not.toContain('photo.png')

		const uploading = bridge_panel_view(input({
			step: 'copying',
			progress: {
				phase: 'files',
				folders_done: 5,
				total_folders: 5,
				loaded_bytes: 40,
				total_bytes: 100,
				files_done: 1,
				total_files: 13,
				current: 'photo.png',
			},
		}))
		expect(uploading.note).toBe('Загружаю файлы: 1 из 13')
		expect(uploading.file_name).toBe('photo.png')
		expect(uploading.fraction).toBeCloseTo(0.4)
	})

	test('sync and device finish on their own line; share keeps no done sentence of its own in the store', () => {
		explorer_language.value = 'ru'
		expect(bridge_panel_view(input({ door: 'sync', step: 'done', preflight: null })).note).toBe('Синк включён')
		expect(bridge_panel_view(input({ door: 'sync', step: 'done', preflight: null })).primary).toBe('Открыть облачную копию')
		expect(bridge_panel_view(input({ door: 'device', step: 'done', preflight: null })).note).toBe('Скопировано')
		expect(bridge_panel_view(input({ door: 'device', step: 'done', preflight: null })).primary).toBe('Открыть')
	})
})

describe('hidden copy indicator', () => {
	const progress = {
		phase: 'files' as const,
		folders_done: 1,
		total_folders: 1,
		loaded_bytes: 0,
		total_bytes: 10,
		files_done: 2,
		total_files: 13,
		current: null,
	}

	test('a hidden sync or share copy shows the count, and an open panel does not', () => {
		explorer_language.value = 'ru'
		const hidden = {
			open: false,
			step: 'copying' as const,
			door: 'sync' as const,
			source_id: '/notes',
			progress,
		}
		expect(bridge_hidden_tip(hidden, '/notes', 'sync')).toBe('Загружаю в облако: 2 из 13')
		expect(bridge_hidden_tip(hidden, '/notes', 'share')).toBeNull()
		expect(bridge_hidden_tip({ ...hidden, open: true }, '/notes', 'sync')).toBeNull()
		expect(bridge_hidden_tip({ ...hidden, source_id: '/other' }, '/notes', 'sync')).toBeNull()
		expect(bridge_hidden_tip({ ...hidden, door: 'share' }, '/notes', 'share')).toBe('Загружаю в облако: 2 из 13')
		expect(bridge_hidden_tip({ ...hidden, door: 'publish' }, '/notes', 'share')).toBe('Загружаю в облако: 2 из 13')
		expect(bridge_hidden_tip({ ...hidden, step: 'summary' }, '/notes', 'sync')).toBeNull()
	})
})
