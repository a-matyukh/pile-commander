import { describe, expect, test } from 'vitest'
import {
	absolute_line_endpoints,
	apply_shape_color,
	build_line_svg,
	constrain_line_angle,
	is_line_shape,
	line_layout_from_endpoints,
	parse_line_meta,
	prepare_svg_for_preview,
	read_shape_color,
	sanitize_svg,
	shape_template_svg,
	SHAPE_DEFAULT_FILL,
	SHAPE_LINE_DEFAULT_STROKE,
	LINE_MIN_EXTENT,
} from './shapes'

describe('shape_template_svg', () => {
	test('filled templates have no stroke', () => {
		for (const template of ['rect', 'ellipse', 'triangle', 'diamond'] as const) {
			const svg = shape_template_svg(template)
			expect(svg).toContain(`fill="${SHAPE_DEFAULT_FILL}"`)
			expect(svg).not.toMatch(/\sstroke=/)
		}
	})

	test('line template is a pc-line with end arrow', () => {
		const svg = shape_template_svg('line')
		expect(is_line_shape(svg)).toBe(true)
		expect(svg).toContain('data-pc-line="1"')
		expect(svg).toContain('data-end-plug="arrow"')
		expect(svg).toContain('data-start-plug="none"')
		expect(svg).toMatch(/\sstroke=/)
		expect(svg).toContain(`stroke="${SHAPE_LINE_DEFAULT_STROKE}"`)
	})

	test('includes an invisible hit stroke for pointer targeting', () => {
		const svg = shape_template_svg('line')
		expect(svg).toContain('class="pc-line-hit"')
		expect(svg).toContain('pointer-events="none"')
		expect(svg).toContain('stroke="transparent"')
		const colored = apply_shape_color(svg, '#00ff00')
		expect(colored).toMatch(/pc-line-hit[^>]*stroke="transparent"/)
		expect(colored).toContain('stroke="#00ff00"')
		expect(read_shape_color(colored)).toBe('#00ff00')
	})
})

describe('line geometry', () => {
	test('build/parse round-trips plugs, flips and axis', () => {
		const svg = build_line_svg({
			width: 200,
			height: 100,
			flipX: true,
			flipY: false,
			axis: 'd',
			startPlug: 'arrow',
			endPlug: 'none',
			color: '#112233',
			strokeWidth: 4,
		})
		const meta = parse_line_meta(svg)
		expect(meta).toEqual({
			width: 200,
			height: 100,
			flipX: true,
			flipY: false,
			axis: 'd',
			startPlug: 'arrow',
			endPlug: 'none',
			color: '#112233',
			strokeWidth: 4,
		})
	})

	test('absolute endpoints follow flips on diagonal', () => {
		const { start, end } = absolute_line_endpoints(
			{ x: 10, y: 20 },
			{ width: 100, height: 50 },
			true,
			false,
			'd',
		)
		expect(start).toEqual({ x: 110, y: 20 })
		expect(end).toEqual({ x: 10, y: 70 })
	})

	test('horizontal layout keeps both endpoints on the same Y', () => {
		const fixed = { x: 100, y: 50 }
		const moved = { x: 0, y: 50 }
		const layout = line_layout_from_endpoints(moved, fixed)
		expect(layout.axis).toBe('h')
		expect(layout.size.height).toBe(LINE_MIN_EXTENT)

		const { start, end } = absolute_line_endpoints(
			layout.position,
			layout.size,
			layout.flipX,
			layout.flipY,
			layout.axis,
		)
		expect(start.y).toBe(50)
		expect(end.y).toBe(50)
		expect(end.x).toBe(100)
		expect(start.x).toBe(0)
	})

	test('layout from endpoints sets flips and min extent', () => {
		const layout = line_layout_from_endpoints({ x: 50, y: 10 }, { x: 10, y: 10 })
		expect(layout.flipX).toBe(true)
		expect(layout.axis).toBe('h')
		expect(layout.size.width).toBe(40)
		expect(layout.size.height).toBe(LINE_MIN_EXTENT)
		expect(layout.position.y).toBe(10 - LINE_MIN_EXTENT / 2)
	})

	test('axis hysteresis: horizontal axis holds until the release epsilon', () => {
		const fixed = { x: 100, y: 50 }
		// Just past the enter epsilon: a fresh layout would go diagonal...
		expect(line_layout_from_endpoints({ x: 0, y: 49 }, fixed).axis).toBe('d')
		// ...but coming from 'h' it stays horizontal (no flip-flop jitter).
		expect(line_layout_from_endpoints({ x: 0, y: 49 }, fixed, 'h').axis).toBe('h')
		// Past the release epsilon it finally leaves 'h'.
		expect(line_layout_from_endpoints({ x: 0, y: 47.5 }, fixed, 'h').axis).toBe('d')
	})

	test('axis hysteresis: diagonal axis keeps the tight enter epsilon', () => {
		const fixed = { x: 100, y: 50 }
		expect(line_layout_from_endpoints({ x: 0, y: 49.7 }, fixed, 'd').axis).toBe('h')
		expect(line_layout_from_endpoints({ x: 0, y: 49 }, fixed, 'd').axis).toBe('d')
	})

	test('axis hysteresis: vertical axis holds until the release epsilon', () => {
		const fixed = { x: 100, y: 50 }
		expect(line_layout_from_endpoints({ x: 101, y: 0 }, fixed).axis).toBe('d')
		expect(line_layout_from_endpoints({ x: 101, y: 0 }, fixed, 'v').axis).toBe('v')
		expect(line_layout_from_endpoints({ x: 102.5, y: 0 }, fixed, 'v').axis).toBe('d')
	})

	test('anchor keeps the fixed endpoint exact on near-horizontal drags', () => {
		const fixed = { x: 100, y: 50 }
		// Endpoint hovers 1px above the fixed one: without an anchor the line
		// centers on midY and shifts the fixed endpoint by half the delta.
		const layout = line_layout_from_endpoints({ x: 0, y: 49 }, fixed, 'h', {
			point: fixed,
			which: 'end',
		})
		expect(layout.axis).toBe('h')
		const { start, end } = absolute_line_endpoints(
			layout.position,
			layout.size,
			layout.flipX,
			layout.flipY,
			layout.axis,
		)
		expect(start.y).toBe(50)
		expect(end.y).toBe(50)
		expect(end).toEqual(fixed)
	})

	test('anchor keeps the fixed endpoint exact on near-vertical drags', () => {
		const fixed = { x: 100, y: 50 }
		const layout = line_layout_from_endpoints({ x: 101, y: 150 }, fixed, 'v', {
			point: fixed,
			which: 'end',
		})
		expect(layout.axis).toBe('v')
		const { start } = absolute_line_endpoints(
			layout.position,
			layout.size,
			layout.flipX,
			layout.flipY,
			layout.axis,
		)
		expect(start.x).toBe(100)
	})

	test('anchor keeps the fixed endpoint exact through diagonal min-extent padding', () => {
		// The core jitter case: dy is sub-pixel (diagonal axis), so the AABB
		// height pads up to LINE_MIN_EXTENT. Symmetric centering would shift
		// the fixed endpoint by (LINE_MIN_EXTENT - dy) / 2.
		const fixed = { x: 0, y: 50 }
		const layout = line_layout_from_endpoints(fixed, { x: 100, y: 50.6 }, 'd', {
			point: fixed,
			which: 'start',
		})
		expect(layout.axis).toBe('d')
		expect(layout.size.height).toBe(LINE_MIN_EXTENT)
		const { start } = absolute_line_endpoints(
			layout.position,
			layout.size,
			layout.flipX,
			layout.flipY,
			layout.axis,
		)
		expect(start).toEqual(fixed)

		// Flipped variant: fixed endpoint is the top-right corner of the box.
		const flipped = line_layout_from_endpoints(
			{ x: 100, y: 50 },
			{ x: 0, y: 49.4 },
			'd',
			{ point: { x: 100, y: 50 }, which: 'start' },
		)
		const flippedStart = absolute_line_endpoints(
			flipped.position,
			flipped.size,
			flipped.flipX,
			flipped.flipY,
			flipped.axis,
		).start
		expect(flippedStart).toEqual({ x: 100, y: 50 })
	})

	test('without anchor the axis-aligned line centers on the midpoint', () => {
		const layout = line_layout_from_endpoints({ x: 0, y: 49 }, { x: 100, y: 50 })
		expect(layout.position.y).toBe(49.5 - LINE_MIN_EXTENT / 2)
	})

	test('constrain_line_angle snaps to horizontal within 22.5 degrees', () => {
		expect(constrain_line_angle({ x: 0, y: 0 }, { x: 100, y: 10 }))
			.toEqual({ x: 100, y: 0 })
		expect(constrain_line_angle({ x: 50, y: 50 }, { x: 0, y: 40 }))
			.toEqual({ x: 0, y: 50 })
	})

	test('constrain_line_angle snaps to vertical within 22.5 degrees', () => {
		expect(constrain_line_angle({ x: 0, y: 0 }, { x: 10, y: 100 }))
			.toEqual({ x: 0, y: 100 })
		expect(constrain_line_angle({ x: 50, y: 50 }, { x: 40, y: 0 }))
			.toEqual({ x: 50, y: 0 })
	})

	test('constrain_line_angle snaps diagonals to exact 45 degrees', () => {
		expect(constrain_line_angle({ x: 0, y: 0 }, { x: 100, y: 60 }))
			.toEqual({ x: 80, y: 80 })
		expect(constrain_line_angle({ x: 100, y: 100 }, { x: 40, y: 0 }))
			.toEqual({ x: 20, y: 20 })
	})

	test('constrain_line_angle keeps a zero-length line at the fixed point', () => {
		expect(constrain_line_angle({ x: 10, y: 20 }, { x: 10, y: 20 }))
			.toEqual({ x: 10, y: 20 })
	})

	test('legacy mid-line svg is detected and parsed', () => {
		const legacy = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><line x1="2" y1="50" x2="98" y2="50" stroke="#4338ca" stroke-width="6" stroke-linecap="round"/></svg>`
		expect(is_line_shape(legacy)).toBe(true)
		const meta = parse_line_meta(legacy, { width: 120, height: 24 })
		expect(meta?.startPlug).toBe('none')
		expect(meta?.endPlug).toBe('none')
		expect(meta?.width).toBe(120)
		expect(meta?.height).toBe(24)
		expect(meta?.axis).toBe('h')
	})
})

describe('read_shape_color', () => {
	test('reads fill from filled shapes', () => {
		const svg = shape_template_svg('ellipse')
		expect(read_shape_color(svg)).toBe(SHAPE_DEFAULT_FILL)
	})

	test('reads stroke from line-only shapes', () => {
		const svg = shape_template_svg('line')
		expect(read_shape_color(svg)).toBe('#4338ca')
	})
})

describe('apply_shape_color', () => {
	test('updates fill on filled shapes', () => {
		const svg = shape_template_svg('triangle')
		const updated = apply_shape_color(svg, '#ff0000')
		expect(updated).toContain('fill="#ff0000"')
		expect(read_shape_color(updated)).toBe('#ff0000')
	})

	test('updates stroke and arrow fills on line shapes', () => {
		const svg = shape_template_svg('line')
		const updated = apply_shape_color(svg, '#00ff00')
		expect(updated).toContain('stroke="#00ff00"')
		expect(updated).toContain('fill="#00ff00"')
		expect(read_shape_color(updated)).toBe('#00ff00')
	})
})

describe('apply_shape_color: imported svg formats', () => {
	test('single-quoted fill attribute', () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill='#8b008b' d='M10 10h80v80H10z'/></svg>`
		expect(read_shape_color(svg)).toBe('#8b008b')
		const updated = apply_shape_color(svg, '#ff0000')
		expect(updated).toContain('fill="#ff0000"')
		expect(read_shape_color(updated)).toBe('#ff0000')
	})

	test('inline style fill', () => {
		const svg = `<svg viewBox="0 0 100 100"><path style="fill:#8b008b;stroke:none" d="M10 10h80v80H10z"/></svg>`
		expect(read_shape_color(svg)).toBe('#8b008b')
		const updated = apply_shape_color(svg, '#00ff00')
		expect(updated).toContain('fill:#00ff00')
		expect(read_shape_color(updated)).toBe('#00ff00')
	})

	test('group fill with bare path', () => {
		const svg = `<svg viewBox="0 0 100 100"><g fill="#8b008b"><path d="M10 10h80v80H10z"/></g></svg>`
		expect(read_shape_color(svg)).toBe('#8b008b')
		const updated = apply_shape_color(svg, '#0000ff')
		expect(updated).toContain('fill="#0000ff"')
		expect(read_shape_color(updated)).toBe('#0000ff')
	})

	test('css class fill in style block', () => {
		const svg = `<svg viewBox="0 0 100 100"><style>.badge{fill:#8b008b}</style><path class="badge" d="M10 10h80v80H10z"/></svg>`
		expect(read_shape_color(svg)).toBe('#8b008b')
		const updated = apply_shape_color(svg, '#ff00ff')
		expect(updated).toContain('fill:#ff00ff')
		expect(read_shape_color(updated)).toBe('#ff00ff')
	})

	test('defs path recolors for use-based icons', () => {
		const svg = `<svg viewBox="0 0 100 100"><defs><path id="p" fill="#8b008b" d="M10 10h80v80H10z"/></defs><use href="#p"/></svg>`
		expect(read_shape_color(svg)).toBe('#8b008b')
		const updated = apply_shape_color(svg, '#123456')
		expect(updated).toContain('fill="#123456"')
		expect(read_shape_color(updated)).toBe('#123456')
	})

	test('skips none and transparent fills', () => {
		const svg = `<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="none"/><path fill="#8b008b" d="M10 10h80v80H10z"/></svg>`
		expect(read_shape_color(svg)).toBe('#8b008b')
		const updated = apply_shape_color(svg, '#ff0000')
		expect(updated).toContain('fill="none"')
		expect(updated).toContain('fill="#ff0000"')
		expect(read_shape_color(updated)).toBe('#ff0000')
	})

	test('single-quoted stroke on imported line', () => {
		const svg = `<svg viewBox='0 0 100 100'><line x1='2' y1='50' x2='98' y2='50' stroke='#4338ca' stroke-width='6'/></svg>`
		expect(is_line_shape(svg)).toBe(true)
		expect(read_shape_color(svg)).toBe('#4338ca')
		const updated = apply_shape_color(svg, '#ff0000')
		expect(read_shape_color(updated)).toBe('#ff0000')
	})
})

describe('sanitize_svg', () => {
	test('strips script tags and event handlers', () => {
		const raw = `<svg><script>alert(1)</script><rect onclick="alert(1)" onload='x' /></svg>`
		const clean = sanitize_svg(raw)
		expect(clean).not.toMatch(/script/i)
		expect(clean).not.toMatch(/onclick/i)
		expect(clean).not.toMatch(/onload/i)
		expect(clean).toContain('<rect')
	})

	test('strips foreignObject and embed-like tags', () => {
		const raw = `<svg><foreignObject><div>x</div></foreignObject><iframe src="x"></iframe></svg>`
		const clean = sanitize_svg(raw)
		expect(clean).not.toMatch(/foreignObject/i)
		expect(clean).not.toMatch(/iframe/i)
	})

	test('strips javascript: and data: urls in href/src', () => {
		const raw = `
			<svg>
				<a href="javascript:alert(1)">x</a>
				<a href="https://example.com">ok</a>
				<image src="data:image/svg+xml;base64,abc" />
			</svg>
		`
		const clean = sanitize_svg(raw)
		expect(clean).not.toMatch(/javascript:/i)
		expect(clean).not.toMatch(/data:image/i)
		expect(clean).toContain('https://example.com')
	})

	test('strips dangerous style urls and expressions', () => {
		const raw = `<svg><rect style="background:url(javascript:alert(1))" /><rect style="width:10px" /></svg>`
		const clean = sanitize_svg(raw)
		expect(clean).not.toMatch(/javascript:/i)
		expect(clean).toContain('style="width:10px"')
	})
})

describe('prepare_svg_for_preview', () => {
	test('stretches non-line svg to widget bounds without preserving aspect ratio', () => {
		const out = prepare_svg_for_preview(
			`<svg width="100" height="50" preserveAspectRatio="xMidYMid" viewBox="0 0 10 10"></svg>`,
		)
		expect(out).toContain('width="100%"')
		expect(out).toContain('height="100%"')
		expect(out).toContain('preserveAspectRatio="none"')
		expect(out).not.toMatch(/width="100"/)
	})

	test('keeps uniform scaling for pc-line shapes', () => {
		const out = prepare_svg_for_preview(shape_template_svg('line'))
		expect(out).toContain('preserveAspectRatio="xMidYMid meet"')
	})

	test('still stretches legacy mid-line shapes', () => {
		const legacy = `<svg viewBox="0 0 100 100"><line x1="2" y1="50" x2="98" y2="50" stroke="#4338ca"/></svg>`
		const out = prepare_svg_for_preview(legacy)
		expect(out).toContain('preserveAspectRatio="none"')
	})
})
