import { describe, expect, test } from 'vitest'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { board_position, DEFAULT_SIZE, IMAGE_DEFAULT_SIZE, NOTE_DEFAULT_SIZE } from '@/services/board/layout'
import { note_lines, plain_line, to_scene_items, type ItemLook } from './scene_items'

type FileChild = Extract<FolderContainerWidgetChild, { type: 'file' }>

const file = (name: string, extra: Partial<FileChild> = {}): FolderContainerWidgetChild =>
	({ id: `/ws/${name}`, name, type: 'file', ...extra }) as FolderContainerWidgetChild

const folder = (name: string): FolderContainerWidgetChild =>
	({ id: `/ws/${name}`, name, type: 'folder_cover' }) as FolderContainerWidgetChild

const look = (extra: Partial<ItemLook> = {}) => (): ItemLook => ({ glyph: { icon: 'tabler:file' }, url: null, note: null, ...extra })

describe('what the 3D scene draws for a folder', () => {
	test('an item stands where the board puts it, at the board size', () => {
		const placed = file('a.pdf', { position: { x: 300, y: -40 }, size: { width: 150, height: 90 } })
		const loose = file('b.pdf')
		const [a, b] = to_scene_items([placed, loose], look())
		expect(a).toMatchObject({ key: placed.id, x: 300, y: -40, w: 150, h: 90, z: null })
		expect({ x: b.x, y: b.y }).toEqual(board_position(loose, 1))
		expect({ w: b.w, h: b.h }).toEqual({ w: DEFAULT_SIZE.width, h: DEFAULT_SIZE.height })
	})

	test('a height set in 3D is the scene\'s; without one the scene picks the default', () => {
		const [lifted, plain, odd] = to_scene_items(
			[file('a.pdf', { z: 120 }), file('b.pdf'), file('c.pdf', { z: Number.NaN })],
			look(),
		)
		expect(lifted.z).toBe(120)
		expect(plain.z).toBeNull()
		expect(odd.z).toBeNull()
	})

	test('a folder takes its icon and color from the Explorer', () => {
		const [item] = to_scene_items([folder('Trips')], look({ glyph: { icon: 'tabler:plane', color: '#D85A30' } }))
		expect(item).toMatchObject({ kind: 'folder', icon: 'tabler:plane', tint: '#D85A30', label: 'Trips' })
		const [plain] = to_scene_items([folder('Docs')], look({ glyph: { icon: 'tabler:folder' } }))
		expect(plain.tint).toBeNull()
	})

	test("a folder's cover color fills it, as on the board; a picture cover does not", () => {
		const [colored] = to_scene_items([folder('Trips')], look({ glyph: { icon: 'tabler:template', color: '#534AB7' }, cover: '#C4D9F7' }))
		expect(colored).toMatchObject({ kind: 'folder', fill: '#C4D9F7', tint: '#534AB7' })
		const [pictured] = to_scene_items([folder('Cats')], look({ cover: 'blob:cats' }))
		expect(pictured.fill).toBeNull()
		const [none] = to_scene_items([folder('Docs')], look({ cover: 'none' }))
		expect(none.fill).toBeNull()
		const [rgb] = to_scene_items([folder('Old')], look({ cover: 'rgb(196, 217, 247)' }))
		expect(rgb.fill).toBe('rgb(196, 217, 247)')
		const [odd] = to_scene_items([folder('Odd')], look({ cover: 'pile:cover-bad' }))
		expect(odd.fill).toBeNull()
	})

	test('a note shown on the board is a card with its text as the board shows it, on its own color', () => {
		const note = file('Plan.md', { is_preview: true, background: '#FFF1B8' })
		const [item] = to_scene_items([note], look({ note: '# Plan for the week\n- buy a lamp\n- call **Anna**' }))
		expect(item).toMatchObject({ kind: 'note', paper: '#FFF1B8' })
		expect(item.lines).toEqual([
			{ text: 'Plan for the week', level: 1 },
			{ text: '• buy a lamp', level: 0 },
			{ text: '• call Anna', level: 0 },
		])
		expect({ w: item.w, h: item.h }).toEqual({ w: NOTE_DEFAULT_SIZE.width, h: NOTE_DEFAULT_SIZE.height })
	})

	test('a note without a color, or with a picture behind it, is white', () => {
		const plain = file('a.md', { is_preview: true })
		const pictured = file('b.md', { is_preview: true, background: 'blob:abc' })
		const kept = file('c.md', { is_preview: true, background: 'pile:background-0a1b2c3d.webp' })
		const [a, b, c] = to_scene_items([plain, pictured, kept], look())
		expect(a.paper).toBe('#FFFFFF')
		expect(b.paper).toBe('#FFFFFF')
		expect(c.paper).toBe('#FFFFFF')
	})

	test('a .md the board shows as a file is a file card here too', () => {
		const [item] = to_scene_items([file('Readme.md')], look())
		expect(item).toMatchObject({ kind: 'file', label: 'Readme.md' })
	})

	test('a picture shows itself unless it was turned into a file', () => {
		const [shown, hidden] = to_scene_items([file('sea.jpg'), file('cat.png', { is_preview: false })], look({ url: 'blob:sea' }))
		expect(shown).toMatchObject({ kind: 'image', url: 'blob:sea' })
		expect({ w: shown.w, h: shown.h }).toEqual({ w: IMAGE_DEFAULT_SIZE.width, h: IMAGE_DEFAULT_SIZE.height })
		expect(shown.tone).toMatch(/^#[0-9A-F]{6}$/i)
		expect(hidden).toMatchObject({ kind: 'file', label: 'cat.png' })
		expect(shown.gif).toBe(false)
		const [gif] = to_scene_items([file('Celebration.GIF')], look({ url: 'blob:party' }))
		expect(gif).toMatchObject({ kind: 'image', gif: true })
	})

	test('a picture whose content could not be had keeps its placeholder', () => {
		const [item] = to_scene_items([file('sea.jpg')], look({ url: false }))
		expect(item).toMatchObject({ kind: 'image', url: null })
	})

	test('a 3D model is always a model, in its card size, and says so when it cannot be had', () => {
		const [loading, ready, failed] = to_scene_items(
			[file('chair.glb'), file('duck.gltf', { is_preview: true }), file('bird.glb')],
			child => ({ glyph: { icon: 'tabler:file' }, url: child.name === 'duck.gltf' ? 'blob:duck' : child.name === 'bird.glb' ? false : null, note: null }),
		)
		expect(loading).toMatchObject({ kind: 'model', url: null, failed: false, w: DEFAULT_SIZE.width })
		expect(ready).toMatchObject({ kind: 'model', url: 'blob:duck', failed: false })
		expect(failed).toMatchObject({ kind: 'model', url: null, failed: true })
	})

	test('any other file is a card with its icon and name', () => {
		const [item] = to_scene_items([file('Budget.pdf')], look({ glyph: { icon: 'tabler:file-type-pdf', color: '#1D9E75' } }))
		expect(item).toMatchObject({ kind: 'file', icon: 'tabler:file-type-pdf', tint: '#1D9E75', label: 'Budget.pdf' })
	})

	test("a system folder's card shows its own name, as the Explorer does", () => {
		const [item] = to_scene_items([folder('Downloads')], look({ name: 'Загрузки' }))
		expect(item.label).toBe('Загрузки')
	})
})

describe('a note card read from markdown', () => {
	test('lines stay lines: a heading larger, list marks kept, an empty line a gap', () => {
		expect(note_lines('## Trip\nTbilisi, Kazbegi\n\n\nBatumi\n1. pack\n- [x] tickets\n- [ ] hotel\n> quiet')).toEqual([
			{ text: 'Trip', level: 2 },
			{ text: 'Tbilisi, Kazbegi', level: 0 },
			{ text: '', level: 0, gap: true },
			{ text: 'Batumi', level: 0 },
			{ text: '1. pack', level: 0 },
			{ text: '☑ tickets', level: 0 },
			{ text: '☐ hotel', level: 0 },
			{ text: 'quiet', level: 0 },
		])
	})

	test('an empty or unread note is an empty card: no title made from its name', () => {
		expect(note_lines(null)).toEqual([])
		expect(note_lines('\n  \n')).toEqual([])
	})

	test('markdown marks go, links and pictures keep their text', () => {
		expect(plain_line('> quote')).toBe('quote')
		expect(plain_line('- [x] done')).toBe('done')
		expect(plain_line('1. first')).toBe('first')
		expect(plain_line('see [the plan](https://x.y) and ![cover](c.png)')).toBe('see the plan and cover')
		expect(plain_line('**bold** _it_ ~~old~~ `code`')).toBe('bold it old code')
	})
})
