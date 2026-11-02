import type { Size } from '@/domain/Widget'

export type PreviewKind = 'image' | 'video' | 'audio' | 'model' | 'shape'

export type PreviewKindConfig = {
	borderColor: string
	boardMinSize: Size
	dashboardMinSize: Size
	stackMinHeight: string
	boardRootClass: string
	dashboardRootClass: string
	stackRowClass: string
}

export const PREVIEW_KIND_CONFIG: Record<PreviewKind, PreviewKindConfig> = {
	image: {
		borderColor: '#10b981',
		boardMinSize: { width: 80, height: 80 },
		dashboardMinSize: { width: 80, height: 80 },
		stackMinHeight: '6rem',
		boardRootClass: 'image-widget',
		dashboardRootClass: 'dashboard-image-widget',
		stackRowClass: 'stack-image-row',
	},
	video: {
		borderColor: '#f59e0b',
		boardMinSize: { width: 160, height: 120 },
		dashboardMinSize: { width: 160, height: 120 },
		stackMinHeight: '8rem',
		boardRootClass: 'video-widget',
		dashboardRootClass: 'dashboard-video-widget',
		stackRowClass: 'stack-video-row',
	},
	audio: {
		borderColor: '#8b5cf6',
		boardMinSize: { width: 160, height: 88 },
		dashboardMinSize: { width: 160, height: 88 },
		stackMinHeight: '5rem',
		boardRootClass: 'audio-widget',
		dashboardRootClass: 'dashboard-audio-widget',
		stackRowClass: 'stack-audio-row',
	},
	model: {
		borderColor: '#0ea5e9',
		boardMinSize: { width: 160, height: 160 },
		dashboardMinSize: { width: 160, height: 160 },
		stackMinHeight: '10rem',
		boardRootClass: 'model-widget',
		dashboardRootClass: 'dashboard-model-widget',
		stackRowClass: 'stack-model-row',
	},
	shape: {
		borderColor: '#6366f1',
		boardMinSize: { width: 40, height: 24 },
		dashboardMinSize: { width: 80, height: 80 },
		stackMinHeight: '3rem',
		boardRootClass: 'shape-widget',
		dashboardRootClass: 'dashboard-shape-widget',
		stackRowClass: 'stack-shape-row',
	},
}
