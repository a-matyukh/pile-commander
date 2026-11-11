import { is_pile_image_token } from '@pile-commander/file-manager'
import type { FolderContainerWidgetChild, ModelCameraState } from '@/domain/Widget'
import { board_position, board_size, image_shows_preview, is_note_widget } from '@/services/board/layout'
import { get_media_kind } from '@/services/board/media'
import { isImageBackground, resolveWidgetBackground } from '@/ui/workspace/folder-container/widgets/resolveBackground'
import type { NoteLine, NoteRun, SceneItem } from './types'

/**
 * What the scene draws for the open folder's items. Places and sizes are the
 * board's (`board_position`, `board_size`), so an item stands where it stands
 * on the board and the canvas; what a card shows follows the board's rules.
 */

/** What the view knows about an item beyond its widget */
export type ItemLook = {
	/** Its icon and color, as the Explorer draws them */
	glyph: { icon: string; color?: string }
	/** A picture's or a model's content: a URL, null while unknown, false when it could not be had */
	url: string | null | false
	/** A note's text once read; null until then */
	note: string | null
	/** A folder's cover: a color, or a picture (not drawn in 3D yet) */
	cover?: string
	/** The name on its card: a system folder's own name; the file name otherwise */
	name?: string
}

/** Placeholder colors of pictures whose content is not there */
const TONES = ['#E6F1FB', '#FAECE7', '#E1F5EE', '#EEEDFE', '#FAEEDA', '#FBEAF0']

const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)

/** Inline markdown as plain text: no emphasis or code marks, links and pictures as their text */
function plain_inline(text: string): string {
	return text
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/(\*\*|__|\*|_|~~|`)/g, '')
		.trim()
}

/** A line of markdown as plain text: no heading, quote or list marks, no emphasis, links as their text */
export function plain_line(line: string): string {
	return plain_inline(line.replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, ''))
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

/** A safe CSS color from a note's own markup, or nothing */
function color_of(style: string, prop: string): string | undefined {
	const match = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(style)
	const value = match?.[1].trim()
	return value && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-z]+)$/i.test(value) ? value : undefined
}

/**
 * A line's styled pieces, as the board draws its markdown and the colors
 * the editor writes as HTML (<span style="color">, <mark>, <b>, <i>, <s>,
 * <code>); other tags go, entities are read, links keep their text
 */
export function note_runs(line: string): NoteRun[] {
	const runs: NoteRun[] = []
	const stack: { tag: string; style: Partial<NoteRun> }[] = []
	const md = { bold: false, italic: false, strike: false, code: false }
	let buffer = ''
	const style = (): Partial<NoteRun> => {
		const out: Partial<NoteRun> = {}
		for (const frame of stack) Object.assign(out, frame.style)
		if (md.bold) out.bold = true
		if (md.italic) out.italic = true
		if (md.strike) out.strike = true
		if (md.code) out.code = true
		return out
	}
	const flush = () => {
		if (!buffer) return
		const s = style()
		const last = runs[runs.length - 1]
		const same = last && last.bold === s.bold && last.italic === s.italic && last.strike === s.strike && last.code === s.code && last.color === s.color && last.mark === s.mark
		if (same) last.text += buffer
		else runs.push({ text: buffer, ...s })
		buffer = ''
	}
	const text = line.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
	let i = 0
	while (i < text.length) {
		const rest = text.slice(i)
		const tag = /^<(\/?)([a-z0-9]+)([^>]*)>/i.exec(rest)
		if (tag) {
			flush()
			const [whole, closing, raw_name, attrs] = tag
			const name = raw_name.toLowerCase()
			if (closing) {
				const at = stack.map(f => f.tag).lastIndexOf(name)
				if (at >= 0) stack.splice(at)
			} else if (!/\/\s*$/.test(attrs) && name !== 'br' && name !== 'img') {
				const css = /style\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? ''
				const s: Partial<NoteRun> = {}
				if (name === 'b' || name === 'strong') s.bold = true
				if (name === 'i' || name === 'em') s.italic = true
				if (name === 's' || name === 'del' || name === 'strike') s.strike = true
				if (name === 'code') s.code = true
				if (name === 'mark') s.mark = color_of(css, 'background-color') ?? color_of(css, 'background') ?? '#FFF3A3'
				const color = color_of(css, 'color')
				if (color) s.color = color
				const background = name === 'mark' ? undefined : color_of(css, 'background-color')
				if (background) s.mark = background
				stack.push({ tag: name, style: s })
			}
			i += whole.length
			continue
		}
		const entity = /^&(#?[a-z0-9]+);/i.exec(rest)
		if (entity) {
			const name = entity[1].toLowerCase()
			buffer += ENTITIES[name] ?? (name.startsWith('#') ? String.fromCodePoint(Number(name.startsWith('#x') ? '0' + name.slice(1) : name.slice(1)) || 32) : entity[0])
			i += entity[0].length
			continue
		}
		if (!md.code && (rest.startsWith('**') || rest.startsWith('__'))) {
			flush(); md.bold = !md.bold; i += 2; continue
		}
		if (!md.code && rest.startsWith('~~')) {
			flush(); md.strike = !md.strike; i += 2; continue
		}
		if (rest[0] === '`') {
			flush(); md.code = !md.code; i += 1; continue
		}
		const before = text[i - 1] ?? ' '
		const after = text[i + 1] ?? ' '
		// * or _ around words, not inside them (snake_case stays as it is)
		if (!md.code && (rest[0] === '*' || rest[0] === '_') && (md.italic ? /\S/.test(before) && !/\w/.test(after) : !/\w/.test(before) && /\S/.test(after))) {
			flush(); md.italic = !md.italic; i += 1; continue
		}
		buffer += text[i]
		i += 1
	}
	flush()
	return runs
}

const runs_line = (runs: NoteRun[], level: number): NoteLine => ({ text: runs.map(r => r.text).join('').trim(), level, runs })

/**
 * A note's card, as the board shows the note: its lines as they are, a
 * heading larger, a list item with its mark, an empty line a gap. No title
 * is made up and no file name added: an empty note is an empty card
 */
export function note_lines(text: string | null, max = 40): NoteLine[] {
	const out: NoteLine[] = []
	for (const raw of (text ?? '').split('\n')) {
		if (out.length >= max) break
		if (!raw.trim()) {
			if (out.length && !out[out.length - 1].gap) out.push({ text: '', level: 0, gap: true })
			continue
		}
		const heading = /^\s*(#{1,6})\s+(.*)$/.exec(raw)
		if (heading) {
			out.push(runs_line(note_runs(heading[2]), Math.min(3, heading[1].length)))
			continue
		}
		const task = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(raw)
		const bullet = /^\s*[-*+]\s+(.*)$/.exec(raw)
		const ordered = /^\s*(\d+)[.)]\s+(.*)$/.exec(raw)
		const quote = /^\s*>\s?(.*)$/.exec(raw)
		const [mark, body] = task ? [`${task[1] === ' ' ? '☐' : '☑'} `, task[2]]
			: bullet ? ['• ', bullet[1]]
			: ordered ? [`${ordered[1]}. `, ordered[2]]
			: quote ? ['', quote[1]]
			: ['', raw]
		const runs = note_runs(body)
		if (mark) runs.unshift({ text: mark })
		const line = runs_line(runs, 0)
		if (line.text) out.push(line)
	}
	while (out.length && out[out.length - 1].gap) out.pop()
	return out
}

/** A folder cover's or a note's color; null for none or for a picture (a URL, a pile: token) */
export function cover_color(cover: string | undefined): string | null {
	if (!cover || cover === 'none' || isImageBackground(cover) || is_pile_image_token(cover)) return null
	// whatever else names a place, not a color
	if (/[:/]/.test(cover.replace(/^(rgb|hsl)a?\(.*\)$/i, ''))) return null
	return cover
}

/** A note's paper: its own color, white when it has none or a picture */
function paper(child: FolderContainerWidgetChild): string {
	const background = child.type === 'file' ? child.background : undefined
	return cover_color(background) ?? resolveWidgetBackground(undefined, '#FFFFFF')
}

/**
 * The angle the board's viewer looks at a model from, radians (the first
 * value of model-viewer's camera orbit, "0.52rad 1.2rad 4m" or "30deg …");
 * null when none is kept
 */
export function orbit_theta(orbit: string | undefined): number | null {
	const match = /^\s*(-?[\d.]+)(rad|deg)?/.exec(orbit ?? '')
	if (!match) return null
	const value = Number(match[1])
	if (!Number.isFinite(value)) return null
	return match[2] === 'deg' ? (value * Math.PI) / 180 : value
}

/** The model's kept view with the board's camera turned to `theta` radians; the rest as it was, or the viewer's defaults */
export function with_theta(state: ModelCameraState | undefined, theta: number): ModelCameraState {
	const angle = `${Number(theta.toFixed(4))}rad`
	if (!state) return { orbit: `${angle} 75deg 105%`, target: 'auto auto auto', fieldOfView: 'auto' }
	const rest = state.orbit.trim().split(/\s+/).slice(1)
	return { ...state, orbit: [angle, ...(rest.length ? rest : ['75deg', '105%'])].join(' ') }
}

export function to_scene_items(
	children: readonly FolderContainerWidgetChild[],
	look: (child: FolderContainerWidgetChild) => ItemLook,
): SceneItem[] {
	return children.map((child, index) => {
		const { x, y } = board_position(child, index)
		const { width: w, height: h } = board_size(child)
		const z = typeof child.z === 'number' && Number.isFinite(child.z) ? child.z : null
		const base = { key: child.id, x, y, w, h, z }
		const { glyph, url, note, cover, name } = look(child)
		const label = name ?? child.name
		if (child.type !== 'file') return { ...base, kind: 'folder', tint: glyph.color ?? null, fill: cover_color(cover), icon: glyph.icon, label }
		if (is_note_widget(child)) {
			return { ...base, kind: 'note', lines: note_lines(note), paper: paper(child) }
		}
		if (image_shows_preview(child)) {
			return { ...base, kind: 'image', url: url || null, tone: TONES[hash(child.name) % TONES.length], gif: /\.gif$/i.test(child.name) }
		}
		// a model is always itself in 3D, in its card's size
		if (get_media_kind(child.name) === 'model') {
			// it faces the camera as it faces the board's viewer: the model turns the other way
			const theta = orbit_theta(child.model_camera?.orbit)
			return { ...base, kind: 'model', url: url === false ? null : url, failed: url === false, yaw: theta === null ? 0 : -theta }
		}
		return { ...base, kind: 'file', icon: glyph.icon, tint: glyph.color ?? null, label }
	})
}
