import type { Position } from '@/domain/Widget'

export type EditorTool =
	| 'pen'
	| 'eraser'
	| 'lasso'
	| 'select'
	| 'hand'
	| 'connect'
	| 'disconnect'

export type Point = Position

export type BoardViewport = {
	x: number
	y: number
	zoom: number
}

export const ZOOM_MIN = 0.2
export const ZOOM_MAX = 4
