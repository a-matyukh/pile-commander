import { getIcon } from '@iconify/vue'
import { CanvasTexture, SRGBColorSpace } from 'three'

/**
 * Card faces are drawn on canvases, in board pixels times a scale. Colors
 * and sizes follow the board (see SpatialView), so a card in 3D reads as
 * the same card.
 */

/** Canvas pixels per board pixel, and the largest canvas side */
const SCALE = 3
const MAX_SIDE = 1024

export const COLORS = {
	card: '#FFFFFF',
	border: 'rgba(0, 0, 0, .10)',
	text: '#2C2C2A',
	secondary: '#5F5E5A',
	muted: '#9A9893',
	accent: '#378ADD',
	danger: '#A32D2D',
	folder: '#E4E1D8',
	folder_flap: '#F1EFE9',
	folder_side: '#CFCBC0',
	floor: '#FFFFFF',
	floor_side: '#E7E5DF',
}

export type Painter = (ctx: CanvasRenderingContext2D, W: number, H: number, s: number) => void

/** The canvas behind one card face */
export class Face {
	readonly texture: CanvasTexture
	/** Canvas pixels per board pixel */
	readonly s: number
	private readonly canvas: HTMLCanvasElement
	private readonly ctx: CanvasRenderingContext2D

	constructor(w: number, h: number, anisotropy: number, scale = SCALE, max_side = MAX_SIDE) {
		this.s = Math.min(scale, max_side / Math.max(w, h, 1))
		this.canvas = document.createElement('canvas')
		this.canvas.width = Math.max(2, Math.round(w * this.s))
		this.canvas.height = Math.max(2, Math.round(h * this.s))
		this.ctx = this.canvas.getContext('2d')!
		this.texture = new CanvasTexture(this.canvas)
		this.texture.colorSpace = SRGBColorSpace
		this.texture.anisotropy = anisotropy
	}

	paint(painter: Painter) {
		const { ctx, canvas } = this
		ctx.save()
		ctx.clearRect(0, 0, canvas.width, canvas.height)
		painter(ctx, canvas.width, canvas.height, this.s)
		ctx.restore()
		this.texture.needsUpdate = true
	}

	dispose() {
		this.texture.dispose()
		this.canvas.width = this.canvas.height = 0
	}
}

// ── Pictures ────────────────────────────────────────────────────────────

const icons = new Map<string, Promise<HTMLImageElement | null>>()

/**
 * An Iconify icon as a picture in one color, from the icons the app already
 * holds (the offline icons plugin adds them); null when it is not there
 */
export function icon_image(name: string, color: string): Promise<HTMLImageElement | null> {
	const key = name + '|' + color
	let image = icons.get(key)
	if (!image) {
		const data = getIcon(name)
		if (!data) image = Promise.resolve(null)
		else {
			const { width: w, height: h, left, top } = data
			const body = data.body.replaceAll('currentColor', to_hex(color))
			const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 8}" height="${h * 8}" viewBox="${left} ${top} ${w} ${h}">${body}</svg>`
			image = load_image('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg))
			// an icon that is not loaded yet may come later: ask again then
			void image.then(found => { if (!found) icons.delete(key) })
		}
		if (data) icons.set(key, image)
	}
	return image
}

const pictures = new Map<string, Promise<HTMLImageElement | null>>()

/** A file's picture, kept for the session */
export function content_image(url: string): Promise<HTMLImageElement | null> {
	let image = pictures.get(url)
	if (!image) {
		image = load_image(url)
		pictures.set(url, image)
	}
	return image
}

function load_image(src: string): Promise<HTMLImageElement | null> {
	const image = new Image()
	image.decoding = 'async'
	image.src = src
	return image.decode().then(
		() => image,
		() => null,
	)
}

/** A soft round shadow, shared by all items */
export function shadow_texture(): CanvasTexture {
	const canvas = document.createElement('canvas')
	canvas.width = canvas.height = 128
	const ctx = canvas.getContext('2d')!
	const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
	g.addColorStop(0, 'rgba(15, 23, 42, .36)')
	g.addColorStop(0.55, 'rgba(15, 23, 42, .15)')
	g.addColorStop(1, 'rgba(15, 23, 42, 0)')
	ctx.fillStyle = g
	ctx.fillRect(0, 0, 128, 128)
	const texture = new CanvasTexture(canvas)
	texture.colorSpace = SRGBColorSpace
	return texture
}

// ── Text ────────────────────────────────────────────────────────────────

/** Lines that fit `max_width`, at most `max_lines`; the last one ends with "…" if cut */
export function wrap(ctx: CanvasRenderingContext2D, text: string, max_width: number, max_lines: number): string[] {
	const words = text.split(/\s+/).filter(Boolean)
	const lines: string[] = []
	let line = ''
	const fits = (s: string) => ctx.measureText(s).width <= max_width
	for (let i = 0; i < words.length; i++) {
		const candidate = line ? line + ' ' + words[i] : words[i]
		if (fits(candidate)) {
			line = candidate
			continue
		}
		if (line) lines.push(line)
		line = words[i]
		// a word longer than the line breaks anywhere
		while (!fits(line) && line.length > 1) {
			let cut = line.length - 1
			while (cut > 1 && !fits(line.slice(0, cut))) cut--
			lines.push(line.slice(0, cut))
			line = line.slice(cut)
		}
		if (lines.length >= max_lines) break
	}
	if (line && lines.length < max_lines) lines.push(line)
	const cut = lines.length > max_lines || lines.join(' ').length < words.join(' ').length
	const out = lines.slice(0, max_lines)
	if (cut && out.length) out[out.length - 1] = ellipsis(ctx, out[out.length - 1], max_width)
	return out
}

function ellipsis(ctx: CanvasRenderingContext2D, line: string, max_width: number): string {
	let s = line
	while (s.length > 1 && ctx.measureText(s + '…').width > max_width) s = s.slice(0, -1)
	return s.trimEnd() + '…'
}

// ── Painters ────────────────────────────────────────────────────────────

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | number[]) {
	ctx.beginPath()
	ctx.roundRect(x, y, w, h, r)
}

/** A sticker, like the board's: title, first lines, file name */
export function paint_note(o: { title: string; text: string; footer: string; paper: string; font: string }): Painter {
	return (ctx, W, H, s) => {
		// the whole canvas: the rounded card cuts the corners
		ctx.fillStyle = o.paper
		ctx.fillRect(0, 0, W, H)
		// the board's sticker is 104×96 with 11/10/9 px type: a larger card scales it up
		const k = Math.max(1, Math.min(W / (104 * s), H / (96 * s))) * s
		const pad_x = 10 * k
		let y = 9 * k
		ctx.textBaseline = 'top'
		ctx.fillStyle = COLORS.text
		ctx.font = `600 ${11.5 * k}px ${o.font}`
		for (const line of wrap(ctx, o.title, W - pad_x * 2, 2)) {
			ctx.fillText(line, pad_x, y)
			y += 14.5 * k
		}
		y += 3 * k
		const footer_h = 16 * k
		const text_lines = Math.max(0, Math.floor((H - y - footer_h - 6 * k) / (13.5 * k)))
		ctx.globalAlpha = 0.75
		ctx.font = `400 ${10 * k}px ${o.font}`
		for (const line of wrap(ctx, o.text, W - pad_x * 2, text_lines)) {
			ctx.fillText(line, pad_x, y)
			y += 13.5 * k
		}
		ctx.globalAlpha = 0.5
		ctx.font = `400 ${9 * k}px ${o.font}`
		ctx.fillText(ellipsis_fit(ctx, o.footer, W - pad_x * 2), pad_x, H - 8 * k - 9 * k)
		ctx.globalAlpha = 1
	}
}

function ellipsis_fit(ctx: CanvasRenderingContext2D, text: string, max_width: number) {
	return ctx.measureText(text).width <= max_width ? text : ellipsis(ctx, text, max_width)
}

/** A photo card: the picture in a thin white frame */
export function paint_image(o: { picture: HTMLImageElement | null; tone: string; icon: HTMLImageElement | null }): Painter {
	return (ctx, W, H, s) => {
		ctx.fillStyle = COLORS.card
		ctx.fillRect(0, 0, W, H)
		const pad = 5 * s
		rounded(ctx, pad, pad, W - pad * 2, H - pad * 2, 5 * s)
		ctx.save()
		ctx.clip()
		const iw = W - pad * 2
		const ih = H - pad * 2
		if (o.picture) {
			// cover: fill the frame, cut the overflow
			const k = Math.max(iw / o.picture.naturalWidth, ih / o.picture.naturalHeight)
			const dw = o.picture.naturalWidth * k
			const dh = o.picture.naturalHeight * k
			ctx.drawImage(o.picture, pad + (iw - dw) / 2, pad + (ih - dh) / 2, dw, dh)
		} else {
			ctx.fillStyle = o.tone
			ctx.fillRect(pad, pad, iw, ih)
			if (o.icon) {
				const size = Math.min(iw, ih) * 0.34
				ctx.globalAlpha = 0.45
				ctx.drawImage(o.icon, pad + (iw - size) / 2, pad + (ih - size) / 2, size, size)
				ctx.globalAlpha = 1
			}
		}
		ctx.restore()
	}
}

/** An icon with a name under it, centered in a box: a file's or a folder's face, as the board's tiles */
function icon_and_name(ctx: CanvasRenderingContext2D, o: { icon: HTMLImageElement | null; name: string; font: string; color: string },
	box: { x: number; y: number; w: number; h: number }, s: number) {
	const side = Math.min(box.w, box.h)
	const size = side * 0.36
	const type = Math.max(10 * s, side * 0.1)
	ctx.font = `500 ${type}px ${o.font}`
	const lines = o.name ? wrap(ctx, o.name, box.w * 0.86, 2) : []
	const text_h = lines.length * type * 1.25
	const gap = lines.length ? side * 0.06 : 0
	const top = box.y + (box.h - size - gap - text_h) / 2
	if (o.icon) ctx.drawImage(o.icon, box.x + (box.w - size) / 2, top, size, size)
	ctx.fillStyle = o.color
	ctx.textAlign = 'center'
	ctx.textBaseline = 'top'
	lines.forEach((line, i) => ctx.fillText(line, box.x + box.w / 2, top + size + gap + i * type * 1.25))
}

/** Any other file: its icon and name on a white card */
export function paint_file(o: { icon: HTMLImageElement | null; name: string; font: string }): Painter {
	return (ctx, W, H, s) => {
		ctx.fillStyle = COLORS.card
		ctx.fillRect(0, 0, W, H)
		rounded(ctx, s, s, W - 2 * s, H - 2 * s, 9 * s)
		ctx.lineWidth = 1.5 * s
		ctx.strokeStyle = COLORS.border
		ctx.stroke()
		icon_and_name(ctx, { ...o, color: COLORS.text }, { x: 0, y: 0, w: W, h: H }, s)
	}
}

/**
 * The face of a folder: its tab and body in the folder's color, a lighter
 * front flap and the folder's icon on it. `tab_h` is the tab's share of H.
 */
export function paint_folder(o: { base: string; flap: string; icon: HTMLImageElement | null; tab_h: number; name: string; font: string }): Painter {
	return (ctx, W, H, s) => {
		ctx.fillStyle = o.base
		ctx.fillRect(0, 0, W, H)
		const top = H * o.tab_h + 4 * s
		rounded(ctx, 0, top, W, H - top, [7 * s, 7 * s, 0, 0])
		ctx.fillStyle = o.flap
		ctx.fill()
		icon_and_name(ctx, { icon: o.icon, name: o.name, font: o.font, color: COLORS.text }, { x: 0, y: top, w: W, h: H - top }, s)
	}
}

/** A model that is still loading, or failed: dashed outline, icon, text, progress */
export function paint_status(o: { icon: HTMLImageElement | null; text: string; share: number | null; failed: boolean; font: string }): Painter {
	return (ctx, W, H, s) => {
		rounded(ctx, 2 * s, 2 * s, W - 4 * s, H - 4 * s, 12 * s)
		ctx.fillStyle = 'rgba(255, 255, 255, .72)'
		ctx.fill()
		ctx.setLineDash([6 * s, 5 * s])
		ctx.lineWidth = 2 * s
		ctx.strokeStyle = o.failed ? 'rgba(163, 45, 45, .45)' : 'rgba(0, 0, 0, .22)'
		ctx.stroke()
		ctx.setLineDash([])
		const size = Math.min(W, H) * 0.26
		const top = H * 0.36 - size / 2
		if (o.icon) ctx.drawImage(o.icon, (W - size) / 2, top, size, size)
		ctx.fillStyle = o.failed ? COLORS.danger : COLORS.secondary
		ctx.font = `500 ${Math.min(W, H) * 0.085}px ${o.font}`
		ctx.textAlign = 'center'
		ctx.textBaseline = 'top'
		const lines = wrap(ctx, o.text, W * 0.8, 2)
		lines.forEach((line, i) => ctx.fillText(line, W / 2, top + size + H * 0.06 + i * Math.min(W, H) * 0.11))
		if (o.share !== null) {
			const bw = W * 0.56
			const bh = Math.max(3 * s, H * 0.025)
			const bx = (W - bw) / 2
			const by = H * 0.8
			rounded(ctx, bx, by, bw, bh, bh / 2)
			ctx.fillStyle = 'rgba(0, 0, 0, .08)'
			ctx.fill()
			rounded(ctx, bx, by, Math.max(bh, bw * o.share), bh, bh / 2)
			ctx.fillStyle = COLORS.accent
			ctx.fill()
		}
	}
}

/** The floor: white with a light grid every `step` board px, aligned with the board's origin */
export function paint_floor(o: { x0: number; y0: number; step: number }): Painter {
	return (ctx, W, H, s) => {
		ctx.fillStyle = COLORS.floor
		ctx.fillRect(0, 0, W, H)
		ctx.strokeStyle = 'rgba(0, 0, 0, .055)'
		ctx.lineWidth = Math.max(1, 1.2 * s)
		ctx.beginPath()
		for (let gx = Math.ceil(o.x0 / o.step) * o.step; (gx - o.x0) * s < W; gx += o.step) {
			const x = Math.round((gx - o.x0) * s) + 0.5
			ctx.moveTo(x, 0)
			ctx.lineTo(x, H)
		}
		for (let gy = Math.ceil(o.y0 / o.step) * o.step; (gy - o.y0) * s < H; gy += o.step) {
			const y = Math.round((gy - o.y0) * s) + 0.5
			ctx.moveTo(0, y)
			ctx.lineTo(W, y)
		}
		ctx.stroke()
	}
}

let probe: CanvasRenderingContext2D | null = null

/** Any CSS color as #rrggbb (a note's color may be "white" or rgb(…)); black when unreadable */
export function to_hex(color: string): string {
	if (/^#[0-9a-f]{6}$/i.test(color)) return color
	probe ??= document.createElement('canvas').getContext('2d')
	if (!probe) return '#000000'
	probe.fillStyle = '#000000'
	probe.fillStyle = color
	const value = probe.fillStyle
	return /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'
}

/** `color` mixed with black: 0 keeps the color, 1 is black */
export function darken(color: string, amount: number): string {
	return mix(color, 0, amount)
}

/** `color` mixed with white: 0 keeps the color, 1 is white */
export function lighten(color: string, amount: number): string {
	return mix(color, 255, amount)
}

function mix(color: string, to: number, amount: number): string {
	const n = parseInt(to_hex(color).slice(1), 16)
	const channel = (v: number) => Math.round(v + (to - v) * amount)
	const r = channel((n >> 16) & 255)
	const g = channel((n >> 8) & 255)
	const b = channel(n & 255)
	return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)
}
