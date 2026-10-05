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
})
