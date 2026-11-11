import { is_pile_image_token } from '@pile-commander/file-manager'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { board_position, board_size, image_shows_preview, is_note_widget } from '@/services/board/layout'
import { get_media_kind } from '@/services/board/media'
import { isImageBackground, resolveWidgetBackground } from '@/ui/workspace/folder-container/widgets/resolveBackground'
import type { NoteLine, SceneItem } from './types'

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
			out.push({ text: plain_inline(heading[2]), level: Math.min(3, heading[1].length) })
			continue
		}
		const task = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(raw)
		const bullet = /^\s*[-*+]\s+(.*)$/.exec(raw)
		const ordered = /^\s*(\d+)[.)]\s+(.*)$/.exec(raw)
		const quote = /^\s*>\s?(.*)$/.exec(raw)
		const line = task ? `${task[1] === ' ' ? '☐' : '☑'} ${plain_inline(task[2])}`
			: bullet ? `• ${plain_inline(bullet[1])}`
			: ordered ? `${ordered[1]}. ${plain_inline(ordered[2])}`
			: quote ? plain_inline(quote[1])
			: plain_inline(raw)
		out.push({ text: line, level: 0 })
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
		if (get_media_kind(child.name) === 'model') return { ...base, kind: 'model', url: url === false ? null : url, failed: url === false }
		return { ...base, kind: 'file', icon: glyph.icon, tint: glyph.color ?? null, label }
	})
}
