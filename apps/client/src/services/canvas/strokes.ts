import type { Position, StrokeNode } from '@/domain/Widget'
import type { FolderStroke } from '@pile-commander/file-manager'

export type StrokeNodeData = {
	points: Position[]
	color: string
	strokeWidth: number
	width: number
	height: number
	/** Precomputed SVG path for the (immutable) points, filled in by the UI layer. */
	pathD?: string
}

export type FlowStrokeNode = {
	id: string
	type: 'stroke'
	/** Render/persist order — mirrors `StrokeNode.z`. */
	z: number
	position: Position
	selected?: boolean
	data: StrokeNodeData
	style?: Record<string, string>
	zIndex?: number
	/** Explicit size so Vue Flow initializes the node without waiting on measure. */
	width: number
	height: number
	dimensions: { width: number; height: number }
}

/** Storage record → UI stroke. */
export function folder_stroke_to_node(stroke: FolderStroke): StrokeNode {
	return {
		id: stroke.id,
		type: 'stroke',
		z: stroke.z,
		position: { ...stroke.position },
		points: stroke.points.map(p => ({ ...p })),
		color: stroke.color,
		stroke_width: stroke.stroke_width,
		width: stroke.width,
		height: stroke.height,
	}
}

/** UI stroke → storage record. */
export function node_to_folder_stroke(node: StrokeNode): FolderStroke {
	return {
		id: node.id,
		z: node.z,
		position: { ...node.position },
		points: node.points.map(p => ({ ...p })),
		color: node.color,
		stroke_width: node.stroke_width,
		width: node.width,
		height: node.height,
	}
}

export function stroke_to_flow_node(stroke: StrokeNode): FlowStrokeNode {
	return {
		id: stroke.id,
		type: 'stroke',
		z: stroke.z,
		position: { ...stroke.position },
		width: stroke.width,
		height: stroke.height,
		dimensions: { width: stroke.width, height: stroke.height },
		data: {
			points: stroke.points.map(p => ({ ...p })),
			color: stroke.color,
			strokeWidth: stroke.stroke_width,
			width: stroke.width,
			height: stroke.height,
		},
		style: {
			width: `${stroke.width}px`,
			height: `${stroke.height}px`,
		},
		zIndex: 1,
	}
}

export function flow_node_to_stroke(node: FlowStrokeNode): StrokeNode {
	return {
		id: node.id,
		type: 'stroke',
		z: node.z,
		position: { ...node.position },
		points: node.data.points.map(p => ({ ...p })),
		color: node.data.color,
		stroke_width: node.data.strokeWidth,
		width: node.data.width,
		height: node.data.height,
	}
}

export function strokes_to_flow_nodes(strokes: StrokeNode[]): FlowStrokeNode[] {
	return strokes.map(stroke_to_flow_node)
}

export function flow_nodes_to_strokes(nodes: FlowStrokeNode[]): StrokeNode[] {
	return nodes.map(flow_node_to_stroke)
}
