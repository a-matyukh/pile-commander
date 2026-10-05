export const SHAPE_TEMPLATES = [
	'rect',
	'ellipse',
	'triangle',
	'diamond',
	'line',
] as const

export type ShapeTemplate = (typeof SHAPE_TEMPLATES)[number]

export const SHAPE_TEMPLATE_LABELS: Record<ShapeTemplate, string> = {
	rect: 'Rectangle',
	ellipse: 'Circle',
	triangle: 'Triangle',
	diamond: 'Diamond',
	line: 'Line / Arrow',
}
