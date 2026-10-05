import { describe, expect, test } from 'vitest'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { PREVIEW_KIND_CONFIG } from './previewKinds'
import { resolvePreviewKind, resolveWidgetRole } from './widgetRegistry'

function file(
	name: string,
	extra: Partial<Extract<FolderContainerWidgetChild, { type: 'file' }>> = {},
): FolderContainerWidgetChild {
	return {
		id: `/ws/${name}`,
		name,
		type: 'file',
		is_preview: true,
		...extra,
	}
}

describe('resolveWidgetRole', () => {
	test('detects note, media, shape, folder preview and default', () => {
		expect(resolveWidgetRole(file('a.txt'))).toBe('note')
		expect(resolveWidgetRole(file('readme.md'))).toBe('note')
		expect(resolveWidgetRole(file('pic.png'))).toBe('image')
		expect(resolveWidgetRole(file('clip.mp4'))).toBe('video')
		expect(resolveWidgetRole(file('track.mp3'))).toBe('audio')
		expect(resolveWidgetRole(file('mesh.glb'))).toBe('model')
		expect(resolveWidgetRole(file('shape.svg'))).toBe('shape')
		expect(resolveWidgetRole({
			id: '/ws/folder',
			name: 'folder',
			type: 'folder_container',
			view: 'list',
			children: [],
		})).toBe('folder_preview')
		expect(resolveWidgetRole(file('readme.md', { is_preview: false }))).toBe('default')
		expect(resolveWidgetRole(file('a.txt', { is_preview: false }))).toBe('default')
	})

	test('non-preview media files fall back to default', () => {
		expect(resolveWidgetRole(file('pic.png', { is_preview: false }))).toBe('default')
		expect(resolveWidgetRole(file('mesh.glb', { is_preview: false }))).toBe('default')
	})
})

describe('resolvePreviewKind', () => {
	test('returns preview kinds only for media/shape widgets', () => {
		expect(resolvePreviewKind(file('a.txt'))).toBeNull()
		expect(resolvePreviewKind(file('pic.png'))).toBe('image')
		expect(resolvePreviewKind(file('clip.mp4'))).toBe('video')
		expect(resolvePreviewKind(file('track.mp3'))).toBe('audio')
		expect(resolvePreviewKind(file('mesh.glb'))).toBe('model')
		expect(resolvePreviewKind(file('shape.svg'))).toBe('shape')
	})
})

describe('PREVIEW_KIND_CONFIG', () => {
	test('defines config for every preview kind', () => {
		for (const kind of ['image', 'video', 'audio', 'model', 'shape'] as const) {
			const config = PREVIEW_KIND_CONFIG[kind]
			expect(config.borderColor).toMatch(/^#/)
			expect(config.boardMinSize.width).toBeGreaterThan(0)
			expect(config.masonryMinSize.height).toBeGreaterThan(0)
			expect(config.stackMinHeight).toMatch(/rem$/)
			expect(config.boardRootClass).toContain(kind === 'shape' ? 'shape' : kind)
		}
	})

	test('borderColor values are defined per preview kind', () => {
		expect(PREVIEW_KIND_CONFIG.image.borderColor).toBe('#10b981')
		expect(PREVIEW_KIND_CONFIG.video.borderColor).toBe('#f59e0b')
		expect(PREVIEW_KIND_CONFIG.audio.borderColor).toBe('#8b5cf6')
		expect(PREVIEW_KIND_CONFIG.model.borderColor).toBe('#0ea5e9')
		expect(PREVIEW_KIND_CONFIG.shape.borderColor).toBe('#6366f1')
	})
})
