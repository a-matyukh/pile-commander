import { describe, expect, test } from 'vitest'
import { apply_name_style, build_name_messages, name_target_kind, sanitize_suggested_name } from './naming'
import { strip_think } from './text'
import { fit_within } from './imageInput'

describe('strip_think', () => {
	test('drops closed and unfinished reasoning blocks', () => {
		expect(strip_think('<think>the user wants a name…\nmaybe x</think>\norange-bag')).toBe('orange-bag')
		expect(strip_think('<THINKING>a</THINKING>b<think>c</think>d')).toBe('bd')
		expect(strip_think('answer <think>still going')).toBe('answer')
		expect(strip_think('<think>cut off by the token limit')).toBe('')
	})
})

describe('sanitize_suggested_name', () => {
	const file = (raw: string, original = 'IMG_4823.jpg') => sanitize_suggested_name(raw, original, 'file')

	test('keeps the original extension', () => {
		expect(file('orange-bag-on-concrete-pillar')).toBe('orange-bag-on-concrete-pillar.jpg')
		expect(file('orange-bag', 'IMG_1.JPEG')).toBe('orange-bag.JPEG')
		expect(file('meeting-notes', 'Note 3.md')).toBe('meeting-notes.md')
	})

	test('drops an extension the model added', () => {
		expect(file('orange-bag.png')).toBe('orange-bag.jpg')
		expect(file('meeting-notes.md', 'Note 3.md')).toBe('meeting-notes.md')
	})

	test('takes the first line, without reasoning, labels, quotes or markdown', () => {
		expect(file('<think>hmm, a bag</think>\n\n"orange-bag"\nThis name describes…')).toBe('orange-bag.jpg')
		expect(file('Name: **orange-bag**')).toBe('orange-bag.jpg')
		expect(file('File name: `orange-bag`')).toBe('orange-bag.jpg')
		expect(file('«оранжевая-сумка»')).toBe('оранжевая-сумка.jpg')
	})

	test('removes characters file systems refuse and caps the length', () => {
		expect(file('a/b\\c:d?e<f|g')).toBe('a-b-c-d-e-f-g.jpg')
		expect(file('a*b>c')).toBe('ab-c.jpg')
		expect(file('tab\there\u0007')).toBe('tab here.jpg')
		expect(file(`${'x'.repeat(200)}`)).toBe(`${'x'.repeat(80)}.jpg`)
		expect(file('...hidden-')).toBe('hidden.jpg')
	})

	test('a name that starts with "name-" is not a label', () => {
		expect(file('name-tags-on-table')).toBe('name-tags-on-table.jpg')
		expect(file('Name: name-tags')).toBe('name-tags.jpg')
		expect(file('Имя: бейджи')).toBe('Имя- бейджи.jpg')
	})

	test('underscores inside words stay, markers around the answer go', () => {
		expect(file('beach_sunset')).toBe('beach_sunset.jpg')
		expect(file('__beach_sunset__')).toBe('beach_sunset.jpg')
		expect(file('_beach_')).toBe('beach.jpg')
		expect(file('**`beach_sunset`**')).toBe('beach_sunset.jpg')
		expect(file('# beach-sunset')).toBe('beach-sunset.jpg')
	})

	test('only a known extension is dropped, a version number stays', () => {
		expect(file('release-v2.0', 'notes.md')).toBe('release-v2.0.md')
		expect(file('scan.v3', 'IMG_1.jpg')).toBe('scan.v3.jpg')
		expect(file('orange-bag.jpeg')).toBe('orange-bag.jpg')
		expect(file('orange-bag.HEIC')).toBe('orange-bag.jpg')
		expect(file('plan.txt', 'Note 1.md')).toBe('plan.md')
	})

	test('nothing usable is null', () => {
		expect(file('')).toBeNull()
		expect(file('<think>only thinking</think>')).toBeNull()
		expect(file('"" ')).toBeNull()
		expect(file('.png')).toBeNull()
	})

	test('a folder gets no extension and keeps dots inside', () => {
		expect(sanitize_suggested_name('trip-to-rome', 'New folder 2', 'folder')).toBe('trip-to-rome')
		expect(sanitize_suggested_name('release-2.1', 'stuff', 'folder')).toBe('release-2.1')
	})
})

describe('name styles', () => {
	test('the default reads like a person wrote it', () => {
		expect(apply_name_style('orange-bag-on-pillar', 'spaces')).toBe('Orange bag on pillar')
		expect(apply_name_style('meeting_notes', 'spaces')).toBe('Meeting notes')
		expect(apply_name_style('встреча с клиентом', 'spaces')).toBe('Встреча с клиентом')
		expect(apply_name_style('iPhone photos', 'spaces')).toBe('iPhone photos')
		expect(apply_name_style('Trip to Rome', 'spaces')).toBe('Trip to Rome')
	})

	test('kebab and snake case', () => {
		expect(apply_name_style('Meeting Notes 2024', 'kebab')).toBe('meeting-notes-2024')
		expect(apply_name_style('beach_sunset', 'kebab')).toBe('beach-sunset')
		expect(apply_name_style('Meeting notes', 'snake')).toBe('meeting_notes')
		expect(apply_name_style('orange-bag', 'snake')).toBe('orange_bag')
	})

	test('the style reaches the answer and keeps the extension', () => {
		expect(sanitize_suggested_name('orange-bag-on-pillar', 'IMG_1.jpg', 'file', 'spaces')).toBe('Orange bag on pillar.jpg')
		expect(sanitize_suggested_name('Trip to Rome', 'New folder', 'folder', 'kebab')).toBe('trip-to-rome')
	})

	test('the prompt asks for the chosen style', () => {
		const prompt = (style: 'spaces' | 'kebab' | 'snake') =>
			build_name_messages({ kind: 'note', name: 'n.md', text: 't' }, style)[0]!.content as string
		expect(prompt('spaces')).toContain('separated by spaces')
		expect(prompt('kebab')).toContain('joined by hyphens')
		expect(prompt('snake')).toContain('joined by underscores')
	})
})

describe('name_target_kind', () => {
	test('notes, folders and images only', () => {
		expect(name_target_kind({ name: 'Note 1.md', type: 'file' })).toBe('note')
		expect(name_target_kind({ name: 'todo.TXT', type: 'file' })).toBe('note')
		expect(name_target_kind({ name: 'IMG_1.jpg', type: 'file' })).toBe('image')
		expect(name_target_kind({ name: 'Stuff', type: 'folder' })).toBe('folder')
		expect(name_target_kind({ name: 'clip.mp4', type: 'file' })).toBeNull()
		expect(name_target_kind({ name: 'shape.svg', type: 'file' })).toBeNull()
	})
})

describe('build_name_messages', () => {
	test('an image goes as an image_url part', () => {
		const [, user] = build_name_messages({ kind: 'image', name: 'IMG_1.jpg', image_url: 'data:image/jpeg;base64,AA' })
		expect(user!.content).toEqual([
			{ type: 'text', text: expect.stringContaining('IMG_1.jpg') },
			{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA' } },
		])
	})

	test('a folder lists its children with the first lines of notes', () => {
		const [, user] = build_name_messages({
			kind: 'folder',
			name: 'New folder',
			children: [{ name: 'plan.md', first_line: 'Trip to Rome' }, { name: 'IMG_2.jpg', first_line: null }],
		})
		expect(user!.content).toContain('- plan.md: Trip to Rome\n- IMG_2.jpg')
	})

	test('a long note is cut', () => {
		const [, user] = build_name_messages({ kind: 'note', name: 'n.md', text: 'x'.repeat(10_000) })
		expect((user!.content as string).length).toBeLessThan(4200)
	})
})

describe('fit_within', () => {
	test('reduces the longest side to 512 and never enlarges', () => {
		expect(fit_within(4000, 3000)).toEqual({ width: 512, height: 384 })
		expect(fit_within(1000, 4000)).toEqual({ width: 128, height: 512 })
		expect(fit_within(300, 200)).toEqual({ width: 300, height: 200 })
	})
})
