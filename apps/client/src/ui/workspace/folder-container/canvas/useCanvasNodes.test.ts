import { describe, expect, test, vi } from 'vitest'
import { computed, nextTick, ref } from 'vue'
import type { FolderContainerWidget, FolderContainerWidgetChild } from '@/domain/Widget'
import { useCanvasNodes } from './useCanvasNodes'

vi.mock('@/ui/workspace/useWorkspace', () => ({
	useRequireWorkspace: () => () => ({ is_selected: () => false, selection: [], change_size: async () => {} }),
}))

function card(size: { width: number; height: number }): FolderContainerWidgetChild {
	return { id: '/ws/photo.png', name: 'photo.png', type: 'file', position: { x: 0, y: 0 }, size } as FolderContainerWidgetChild
}

function setup() {
	const children = ref([card({ width: 200, height: 300 })])
	const container = computed(() => ({ id: '/ws', children: children.value }) as unknown as FolderContainerWidget)
	const canvas = useCanvasNodes(container, ref(null))
	return { children, canvas }
}

describe('useCanvasNodes', () => {
	test('a size set elsewhere (another tab, a collaborator, folder sync) shows at once', async () => {
		const { children, canvas } = setup()
		expect(canvas.nodes.value[0]!.style).toEqual({ width: '200px', height: '300px' })

		children.value = [card({ width: 400, height: 500 })]
		await nextTick()

		expect(canvas.nodes.value[0]!.style).toEqual({ width: '400px', height: '500px' })
	})

	test('a node under the resize handle keeps its live size', async () => {
		const { children, canvas } = setup()
		canvas.onNodeResizeStart('/ws/photo.png', { width: 200, height: 300 })
		canvas.onNodeResizeLive('/ws/photo.png', { width: 260, height: 340 })

		children.value = [card({ width: 400, height: 500 })]
		await nextTick()

		expect(canvas.nodes.value[0]!.style).toEqual({ width: '260px', height: '340px' })
	})
})
