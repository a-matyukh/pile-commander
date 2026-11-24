// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { prepare_svg_for_preview, sanitize_svg, shape_template_svg } from './shapes'

/** Every event-handler attribute a browser reads from this markup. */
function handlers(markup: string): string[] {
	const host = document.createElement('div')
	host.innerHTML = markup
	const found: string[] = []
	for (const element of host.querySelectorAll('*')) {
		for (const attr of Array.from(element.attributes)) {
			if (/^on/i.test(attr.name)) found.push(`${element.localName} ${attr.name}`)
		}
	}
	return found
}

function root_svg(markup: string): SVGSVGElement {
	const host = document.createElement('div')
	host.innerHTML = markup
	const svg = host.querySelector('svg')
	if (!svg) throw new Error('no svg in the output')
	return svg
}

// The path that ships: DOMPurify on a real DOM. shapes.test.ts covers the
// regex fallback the node environment gets.
describe('SVG shapes from other people, under DOMPurify', () => {
	test('runs DOMPurify, not the regex fallback', () => {
		// Only DOMPurify removes SMIL <animate>; the regex pass keeps it
		expect(sanitize_svg('<svg><animate attributeName="x" to="1"/></svg>')).not.toContain('animate')
	})

	test('a handler pattern inside an attribute value never becomes an event attribute', () => {
		const inputs = [
			'<svg xmlns="http://www.w3.org/2000/svg" data-a="1 onx=b" data-b="/onload=alert(document.domain)//"><rect width="1" height="1"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg" aria-label="1 onx=b" data-b="/onload=alert(1)//"><rect/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><rect data-a="x onfocus=y" data-b="/onclick=alert(1)//" width="1" height="1"/></svg>',
			"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\" data-a='1 onx=b' data-b='/onload=alert(1)//'></svg>",
		]
		for (const input of inputs) {
			expect(handlers(prepare_svg_for_preview(input)), input).toEqual([])
			expect(handlers(sanitize_svg(input)), input).toEqual([])
		}
	})

	test('drops plain handlers, scripts and foreign content', () => {
		const out = prepare_svg_for_preview(
			'<svg onload="alert(1)"><script>alert(1)</script><foreignObject><div>x</div></foreignObject><rect onclick="alert(1)"/></svg>',
		)
		expect(handlers(out)).toEqual([])
		expect(out).not.toMatch(/script|foreignObject/i)
		expect(out).toContain('<rect')
	})

	test('drops javascript: and data: urls and dangerous styles, entities included', () => {
		const out = prepare_svg_for_preview(`<svg>
			<a href="&#106;avascript:alert(1)"><rect/></a>
			<image href="data:image/png;base64,AAAA"/>
			<rect style="fill:url(javascript:alert(1))"/>
			<rect style="fill:#f00"/>
		</svg>`)
		expect(out).not.toMatch(/javascript:|data:/i)
		expect(out).toContain('style="fill:#f00"')
	})

	test('fits the root svg to the widget', () => {
		const svg = root_svg(prepare_svg_for_preview(
			'<svg width="100" height="50" preserveAspectRatio="xMidYMid" viewBox="0 0 10 10"><svg width="5" height="5"/></svg>',
		))
		expect(svg.getAttribute('width')).toBe('100%')
		expect(svg.getAttribute('height')).toBe('100%')
		expect(svg.getAttribute('preserveAspectRatio')).toBe('none')
		expect(svg.getAttribute('viewBox')).toBe('0 0 10 10')
		// only the root: a nested svg keeps its own size
		expect(svg.querySelector('svg')?.getAttribute('width')).toBe('5')
	})

	test('keeps uniform scaling for lines and arrows', () => {
		const svg = root_svg(prepare_svg_for_preview(shape_template_svg('line')))
		expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet')
	})

	test("keeps a shape's own style block, which recoloring edits", () => {
		const out = prepare_svg_for_preview(
			'<svg><style>.cls-1{fill:#f00}</style><rect class="cls-1" width="1" height="1"/></svg>',
		)
		expect(out).toContain('<style>.cls-1{fill:#f00}</style>')
	})

	test('a link around a shape loses its address and keeps the drawing', () => {
		const html = sanitize_svg(
			'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">'
			+ '<a href="https://evil.example/login"><rect width="10" height="10"/></a>'
			+ '<a xlink:href="https://evil.example/x"><circle r="2"/></a></svg>',
		)
		expect(html).toContain('<rect')
		expect(html).toContain('<circle')
		expect(html).not.toContain('evil.example')
	})
})
