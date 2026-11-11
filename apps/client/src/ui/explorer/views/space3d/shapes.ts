import { ExtrudeGeometry, Shape, ShapeGeometry } from 'three'

/**
 * Flat shapes lie on the floor: drawn in XY around the origin, then turned
 * so +Y of the shape points to −Z, the far side. The far side is the top of
 * the board, so a card's picture is upright when seen from the front.
 */

export function rounded_rect(w: number, h: number, r: number): Shape {
	const s = new Shape()
	const x = -w / 2
	const y = -h / 2
	r = Math.min(r, w / 2, h / 2)
	s.moveTo(x + r, y)
	s.lineTo(x + w - r, y)
	s.quadraticCurveTo(x + w, y, x + w, y + r)
	s.lineTo(x + w, y + h - r)
	s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
	s.lineTo(x + r, y + h)
	s.quadraticCurveTo(x, y + h, x, y + h - r)
	s.lineTo(x, y + r)
	s.quadraticCurveTo(x, y, x + r, y)
	return s
}

/**
 * A folder seen from above: the body and a tab on the far left. `tab_h` is
 * the tab's share of the depth.
 */
export function folder_shape(w: number, h: number, r: number, tab_h: number): Shape {
	const s = new Shape()
	const x0 = -w / 2
	const x1 = w / 2
	const y0 = -h / 2
	const y1 = h / 2
	const body = y1 - h * tab_h
	const tab_w = w * 0.42
	r = Math.min(r, w / 6, h * tab_h)
	s.moveTo(x0 + r, y0)
	s.lineTo(x1 - r, y0)
	s.quadraticCurveTo(x1, y0, x1, y0 + r)
	s.lineTo(x1, body - r)
	s.quadraticCurveTo(x1, body, x1 - r, body)
	// a slanted step up to the tab
	s.lineTo(x0 + tab_w + r * 1.6, body)
	s.quadraticCurveTo(x0 + tab_w, body, x0 + tab_w - r * 0.6, y1 - r * 0.6)
	s.quadraticCurveTo(x0 + tab_w - r * 1.2, y1, x0 + tab_w - r * 2.4, y1)
	s.lineTo(x0 + r, y1)
	s.quadraticCurveTo(x0, y1, x0, y1 - r)
	s.lineTo(x0, y0 + r)
	s.quadraticCurveTo(x0, y0, x0 + r, y0)
	return s
}

/**
 * The shape extruded upward by `depth`: top face at y = depth. Both faces
 * get 0..1 UVs over the w×h box, so a w×h picture covers the top.
 */
export function slab(shape: Shape, w: number, h: number, depth: number): ExtrudeGeometry {
	const geo = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 })
	const pos = geo.getAttribute('position')
	const uv = geo.getAttribute('uv')
	const caps = geo.groups[0]
	if (caps) {
		for (let i = caps.start; i < caps.start + caps.count; i++) {
			const v = geo.index ? geo.index.getX(i) : i
			uv.setXY(v, (pos.getX(v) + w / 2) / w, (pos.getY(v) + h / 2) / h)
		}
	}
	uv.needsUpdate = true
	geo.rotateX(-Math.PI / 2)
	return geo
}

/** An outline around a w×h box, lying flat: the selection ring */
export function ring_geometry(w: number, h: number, r: number, pad: number, width: number): ShapeGeometry {
	const outer = rounded_rect(w + (pad + width) * 2, h + (pad + width) * 2, r + pad + width)
	outer.holes.push(rounded_rect(w + pad * 2, h + pad * 2, r + pad))
	const geo = new ShapeGeometry(outer, 10)
	geo.rotateX(-Math.PI / 2)
	return geo
}
