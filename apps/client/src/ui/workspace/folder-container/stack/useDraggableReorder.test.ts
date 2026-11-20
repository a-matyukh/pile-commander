import { describe, expect, test } from 'vitest'
import { computed, nextTick, reactive, ref } from 'vue'
import type { FolderContainerWidget, FolderContainerWidgetChild } from '@/domain/Widget'
import { useDraggableReorder } from './useDraggableReorder'

function fileChild(
	id: string,
	overrides: Partial<Extract<FolderContainerWidgetChild, { type: 'file' }>> = {},
): FolderContainerWidgetChild {
	return {
		id,
		name: `${id}.txt`,
		type: 'file',
		is_preview: false,
		...overrides,
	}
}

describe('useDraggableReorder', () => {
	test('syncs local children when is_preview changes without reordering', async () => {
		const folder = reactive<{ children: FolderContainerWidgetChild[] }>({
			children: [fileChild('/ws/a'), fileChild('/ws/b')],
		})

		const folderId = computed(() => '/ws')
		const container = computed(() => folder as FolderContainerWidget)

		const { children } = useDraggableReorder(
			folderId,
			container,
			() => ({ name: 'test' }),
		)

		expect(children.value.map(c => c.is_preview)).toEqual([false, false])

		// Same ids/order — only preview flag flips (context menu → Preview).
		folder.children = [
			fileChild('/ws/a', { is_preview: true }),
			fileChild('/ws/b'),
		]
		await nextTick()

		expect(children.value[0]?.is_preview).toBe(true)
		expect(children.value.map(c => c.id)).toEqual(['/ws/a', '/ws/b'])
	})

	test('does not sync from store while dragging', async () => {
		const folder = reactive<{ children: FolderContainerWidgetChild[] }>({
			children: [fileChild('/ws/a'), fileChild('/ws/b')],
		})

		const folderId = computed(() => '/ws')
		const container = computed(() => folder as FolderContainerWidget)

		const { children, on_start } = useDraggableReorder(
			folderId,
			container,
			() => ({ name: 'test' }),
		)

		on_start()
		folder.children = [
			fileChild('/ws/a', { is_preview: true }),
			fileChild('/ws/b'),
		]
		await nextTick()

		expect(children.value[0]?.is_preview).toBe(false)
	})

	test('resyncs when a child is added', async () => {
		const folder = reactive<{ children: FolderContainerWidgetChild[] }>({
			children: [fileChild('/ws/a')],
		})

		const folderId = ref('/ws')
		const container = computed(() => folder as FolderContainerWidget)

		const { children } = useDraggableReorder(
			computed(() => folderId.value),
			container,
			{ name: 'test' },
		)

		folder.children = [fileChild('/ws/a'), fileChild('/ws/b')]
		await nextTick()

		expect(children.value.map(c => c.id)).toEqual(['/ws/a', '/ws/b'])
	})

	test('the stack a card left lets go: no reorder, and it reads the store again', async () => {
		const folder = reactive<{ children: FolderContainerWidgetChild[] }>({
			children: [fileChild('/ws/a'), fileChild('/ws/b')],
		})
		const container = computed(() => folder as FolderContainerWidget)
		const { children, is_dragging, on_start, on_end } = useDraggableReorder(
			computed(() => '/ws'),
			container,
			{ name: 'test' },
		)

		on_start()
		// Sortable took the card out of this list's array
		children.value.splice(0, 1)
		const from = {} as HTMLElement
		const to = {} as HTMLElement
		await on_end({ from, to })

		expect(is_dragging.value).toBe(false)
		// The store did not change, so the next sync brings the card back
		folder.children = [fileChild('/ws/a'), fileChild('/ws/b', { is_preview: true })]
		await nextTick()
		expect(children.value.map(c => c.id)).toEqual(['/ws/a', '/ws/b'])
	})

	test('a card that came in without a workspace to move it goes back to the store\'s list', async () => {
		const folder = reactive<{ children: FolderContainerWidgetChild[] }>({
			children: [fileChild('/ws/a')],
		})
		const container = computed(() => folder as FolderContainerWidget)
		const { children, on_change } = useDraggableReorder(
			computed(() => '/ws'),
			container,
			{ name: 'test' },
		)

		const stranger = fileChild('/other/x')
		children.value.push(stranger)
		await on_change({ added: { element: stranger, newIndex: 1 } })

		expect(children.value.map(c => c.id)).toEqual(['/ws/a'])
	})
})
