import { describe, expect, test, vi } from 'vitest'
import { computed, nextTick, ref } from 'vue'
import type { FolderContainerWidget, FolderContainerWidgetChild } from '@/domain/Widget'
import { useCanvasNodes } from './useCanvasNodes'

const writes = vi.hoisted(() => [] as unknown[][])

vi.mock('@/ui/workspace/useWorkspace', () => ({
	useRequireWorkspace: () => () => ({
		is_selected: () => false,
		selection: [],
		change_size: async (...args: unknown[]) => { writes.push(['size', ...args.slice(0, 2)]) },
		change_position: async (...args: unknown[]) => { writes.push(['position', ...args.slice(0, 2)]) },
	}),
}))

vi.mock('@/store/history', () => ({
	record_action: async (_ws: unknown, _scope: unknown, _label: string, fn: (tx: object) => Promise<void>) => fn({}),
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
		canvas.onNodeResizeLive('/ws/photo.png', { x: 0, y: 0, width: 260, height: 340 })

		children.value = [card({ width: 400, height: 500 })]
		await nextTick()

		expect(canvas.nodes.value[0]!.style).toEqual({ width: '260px', height: '340px' })
	})

	test('the top-left handle moves the top-left corner; the bottom-right one stays put', async () => {
		writes.length = 0
		const { canvas } = setup()
		canvas.onNodeResizeStart('/ws/photo.png', { width: 200, height: 300 })
		canvas.onNodeResizeLive('/ws/photo.png', { x: -40, y: -60, width: 240, height: 360 })

		expect(canvas.nodes.value[0]!.position).toEqual({ x: -40, y: -60 })
		expect(canvas.nodes.value[0]!.style).toEqual({ width: '240px', height: '360px' })

		await canvas.onNodeResizeEnd('/ws/photo.png', { x: -40, y: -60, width: 240, height: 360 })
		expect(writes).toEqual([
			['size', '/ws/photo.png', { width: 240, height: 360 }],
			['position', '/ws/photo.png', { x: -40, y: -60 }],
		])
	})

	test('the bottom-right handle stores no new place', async () => {
		writes.length = 0
		const { canvas } = setup()
		canvas.onNodeResizeStart('/ws/photo.png', { width: 200, height: 300 })
		await canvas.onNodeResizeEnd('/ws/photo.png', { x: 0, y: 0, width: 260, height: 340 })
		expect(writes).toEqual([['size', '/ws/photo.png', { width: 260, height: 340 }]])
	})
})
