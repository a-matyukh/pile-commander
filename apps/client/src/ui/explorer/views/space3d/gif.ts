/**
 * The frame of a GIF that a still card shows. The board plays a GIF; the 3D
 * view draws one frame, and an animation often starts empty (confetti that
 * flies in, a sticker that appears). So the frames are put together as the
 * GIF plays them and the fullest one is kept: the one with most visible
 * pixels, the earliest of equals, so a GIF with no transparency keeps its
 * first frame. Browsers give no frames of their own (WebKit has no
 * ImageDecoder), hence this small decoder.
 */

export type GifFrame = { width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer> }

/** Pixels worked through at most (canvas size times frames): a large, long GIF stops early with the fullest frame so far */
const BUDGET = 6_000_000

/** null: not a GIF, or nothing could be read from it */
export function gif_fullest_frame(bytes: Uint8Array, budget = BUDGET): GifFrame | null {
	const at = (i: number) => bytes[i] ?? 0
	const u16 = (i: number) => at(i) | (at(i + 1) << 8)
	if (bytes.length < 13 || String.fromCharCode(at(0), at(1), at(2), at(3)) !== 'GIF8') return null
	const width = u16(6)
	const height = u16(8)
	if (!width || !height) return null
	let pos = 13
	let global: Uint8Array | null = null
	if (at(10) & 0x80) {
		const size = 3 * (2 << (at(10) & 7))
		global = bytes.subarray(pos, pos + size)
		pos += size
	}

	const canvas = new Uint8ClampedArray(width * height * 4)
	let best: Uint8ClampedArray<ArrayBuffer> | null = null
	let best_shown = -1
	let work = 0
	// the graphic control of the next frame, and how the last frame is cleared before the next is drawn
	let transparent = -1
	let disposal = 0
	let last: { disposal: number; x: number; y: number; w: number; h: number; saved: Uint8ClampedArray<ArrayBuffer> | null } | null = null

	while (pos < bytes.length && work < budget) {
		const block = at(pos)
		if (block === 0x3b) break
		if (block === 0x21) {
			const label = at(pos + 1)
			pos += 2
			if (label === 0xf9 && at(pos) >= 4) {
				const packed = at(pos + 1)
				disposal = (packed >> 2) & 7
				transparent = packed & 1 ? at(pos + 4) : -1
			}
			pos = skip_blocks(bytes, pos)
			continue
		}
		if (block !== 0x2c) return best ? frame(width, height, best) : null

		const x = u16(pos + 1)
		const y = u16(pos + 3)
		const w = u16(pos + 5)
		const h = u16(pos + 7)
		const packed = at(pos + 9)
		pos += 10
		let palette = global
		if (packed & 0x80) {
			const size = 3 * (2 << (packed & 7))
			palette = bytes.subarray(pos, pos + size)
			pos += size
		}
		const min_size = at(pos++)
		const data = collect_blocks(bytes, pos)
		pos = data.end

		// the last frame leaves as it asked: as it is, cleared, or the canvas as it was before it
		if (last?.disposal === 2) clear_rect(canvas, width, height, last)
		else if (last?.disposal === 3 && last.saved) canvas.set(last.saved)
		const saved = disposal === 3 ? canvas.slice() : null

		const indices = new Uint8Array(w * h)
		if (min_size >= 2 && min_size <= 11) lzw_decode(data.bytes, min_size, indices)
		draw(canvas, width, height, { x, y, w, h, interlaced: (packed & 0x40) !== 0, indices, palette, transparent })

		const shown = count_shown(canvas)
		if (shown > best_shown) {
			best_shown = shown
			best = canvas.slice()
		}
		last = { disposal, x, y, w, h, saved }
		transparent = -1
		disposal = 0
		work += width * height + w * h
	}
	return best ? frame(width, height, best) : null
}

function frame(width: number, height: number, rgba: Uint8ClampedArray<ArrayBuffer>): GifFrame {
	return { width, height, rgba }
}

/** Past a run of data sub-blocks, to the byte after their terminator */
function skip_blocks(bytes: Uint8Array, pos: number): number {
	while (pos < bytes.length) {
		const size = bytes[pos]
		pos += 1
		if (!size) break
		pos += size
	}
	return pos
}

/** A frame's compressed data: its sub-blocks joined */
function collect_blocks(bytes: Uint8Array, pos: number): { bytes: Uint8Array; end: number } {
	const end = skip_blocks(bytes, pos)
	const out = new Uint8Array(Math.max(0, end - pos))
	let n = 0
	while (pos < end) {
		const size = bytes[pos]
		pos += 1
		if (!size) break
		out.set(bytes.subarray(pos, Math.min(pos + size, bytes.length)), n)
		n += size
		pos += size
	}
	return { bytes: out.subarray(0, n), end }
}

/** GIF's LZW: codes grow from min_size + 1 to 12 bits; a short or broken stream leaves the rest of `out` at index 0 */
export function lzw_decode(data: Uint8Array, min_size: number, out: Uint8Array) {
	const clear = 1 << min_size
	const end = clear + 1
	const prefix = new Uint16Array(4096)
	const suffix = new Uint8Array(4096)
	const first = new Uint8Array(4096)
	const stack = new Uint8Array(4097)
	for (let i = 0; i < clear; i++) {
		suffix[i] = i
		first[i] = i
	}
	let size = min_size + 1
	let next = end + 1
	let prev = -1
	let acc = 0
	let bits = 0
	let pos = 0
	let op = 0
	while (op < out.length) {
		while (bits < size) {
			if (pos >= data.length) return
			acc |= data[pos++] << bits
			bits += 8
		}
		const code = acc & ((1 << size) - 1)
		acc >>>= size
		bits -= size
		if (code === clear) {
			size = min_size + 1
			next = end + 1
			prev = -1
			continue
		}
		if (code === end) return
		if (prev === -1) {
			if (code >= clear) return
			out[op++] = code
			prev = code
			continue
		}
		let sp = 0
		let c = code
		if (code >= next) {
			// the one code not in the table yet: the previous string and its own first byte
			if (code > next) return
			stack[sp++] = first[prev]
			c = prev
		}
		while (c >= clear) {
			stack[sp++] = suffix[c]
			c = prefix[c]
		}
		stack[sp++] = c
		if (next < 4096) {
			prefix[next] = prev
			suffix[next] = c
			first[next] = first[prev]
			next += 1
			if (next === 1 << size && size < 12) size += 1
		}
		while (sp > 0 && op < out.length) out[op++] = stack[--sp]
		prev = code
	}
}

/** Rows of an interlaced frame come in four passes */
function row_of(i: number, h: number): number {
	const pass1 = Math.ceil(h / 8)
	if (i < pass1) return i * 8
	i -= pass1
	const pass2 = Math.ceil((h - 4) / 8)
	if (i < pass2) return 4 + i * 8
	i -= pass2
	const pass3 = Math.ceil((h - 2) / 4)
	if (i < pass3) return 2 + i * 4
	i -= pass3
	return 1 + i * 2
}

function draw(
	canvas: Uint8ClampedArray,
	width: number,
	height: number,
	f: { x: number; y: number; w: number; h: number; interlaced: boolean; indices: Uint8Array; palette: Uint8Array | null; transparent: number },
) {
	if (!f.palette) return
	for (let row = 0; row < f.h; row++) {
		const cy = f.y + (f.interlaced ? row_of(row, f.h) : row)
		if (cy >= height) continue
		for (let col = 0; col < f.w; col++) {
			const cx = f.x + col
			if (cx >= width) break
			const index = f.indices[row * f.w + col]
			if (index === f.transparent || index * 3 + 2 >= f.palette.length) continue
			const o = (cy * width + cx) * 4
			canvas[o] = f.palette[index * 3]
			canvas[o + 1] = f.palette[index * 3 + 1]
			canvas[o + 2] = f.palette[index * 3 + 2]
			canvas[o + 3] = 255
		}
	}
}

function clear_rect(canvas: Uint8ClampedArray, width: number, height: number, r: { x: number; y: number; w: number; h: number }) {
	for (let y = r.y; y < Math.min(height, r.y + r.h); y++) {
		canvas.fill(0, (y * width + r.x) * 4, (y * width + Math.min(width, r.x + r.w)) * 4)
	}
}

function count_shown(canvas: Uint8ClampedArray): number {
	let n = 0
	for (let i = 3; i < canvas.length; i += 4) if (canvas[i]) n++
	return n
}
