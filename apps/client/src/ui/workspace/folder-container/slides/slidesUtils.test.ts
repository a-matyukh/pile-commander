import { describe, expect, it } from 'vitest'
import type { FolderContainerWidget } from '@/domain/Widget'
import { resolve_slide_index, set_local_slide_index } from './slidesUtils'

function container(count: number, selected_slide_index?: number): FolderContainerWidget {
	return {
		id: 'folder',
		name: 'Slides',
		type: 'folder_container',
		view: 'slides',
		selected_slide_index,
		children: Array.from({ length: count }, (_, index) => ({
			id: `slide-${index}`,
			name: `Slide ${index}`,
			type: 'file',
		})),
	} as FolderContainerWidget
}

describe('resolve_slide_index', () => {
	it('uses the saved index when the viewer has not chosen a slide', () => {
		expect(resolve_slide_index(container(4, 1), { workspace_id: 'pub-saved', folder_id: '/' })).toBe(1)
	})

	it('uses the viewer’s slide and leaves another workspace on the saved index', () => {
		set_local_slide_index('pub-a', '/', 2)
		const slides = container(4, 0)
		expect(resolve_slide_index(slides, { workspace_id: 'pub-a', folder_id: '/' })).toBe(2)
		expect(resolve_slide_index(slides, { workspace_id: 'pub-b', folder_id: '/' })).toBe(0)
		expect(resolve_slide_index(slides)).toBe(0)
	})

	it('clamps both the saved index and the viewer’s choice to the slides that exist', () => {
		expect(resolve_slide_index(container(3, 10))).toBe(2)
		expect(resolve_slide_index(container(3, -4))).toBe(0)
		set_local_slide_index('pub-a', '/deck', 99)
		expect(resolve_slide_index(container(3, 0), { workspace_id: 'pub-a', folder_id: '/deck' })).toBe(2)
		set_local_slide_index('pub-a', '/empty-choice', 0)
		expect(resolve_slide_index(container(3, 2), { workspace_id: 'pub-a', folder_id: '/empty-choice' })).toBe(0)
	})
})
