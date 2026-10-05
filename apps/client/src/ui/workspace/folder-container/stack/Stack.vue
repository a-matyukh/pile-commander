<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useFolderContainerScope } from '../useFolderContainerScope'
import { provideEditingNoteId } from '../widgets/useEditingNoteId'
import { useClickOutsideEditingNote } from '../widgets/useClickOutsideEditingNote'
import { registerPaneEditingNoteSetter } from '../panePosition'
import { useDraggableReorder } from './useDraggableReorder'
import DraggableWidgetList from '../widgets/DraggableWidgetList.vue'
import WidgetTypeSwitch from '../widgets/WidgetTypeSwitch.vue'
import { useWorkspace } from '@/ui/workspace/useWorkspace'

const { folderId, container } = useFolderContainerScope()

const workspace = useWorkspace()
const can_write = computed(() => workspace.value?.can_write !== false)

const editingNoteId = ref<string | null>(null)

provideEditingNoteId(editingNoteId)

onMounted(() => {
	registerPaneEditingNoteSetter(folderId.value, (noteId) => {
		editingNoteId.value = noteId
	})
})

onUnmounted(() => {
	registerPaneEditingNoteSetter(folderId.value, null)
})

const {
	children,
	dragGroup,
	on_start,
	on_end,
} = useDraggableReorder(
	folderId,
	container,
	() => ({ name: `folder-stack-${folderId.value}` }),
)

const { onSectionClick } = useClickOutsideEditingNote('.stack-note-row', editingNoteId)
</script>

<template>
	<section
		class="stack-section"
		:data-path="folderId"
		@click="onSectionClick"
	>
		<DraggableWidgetList
			:list="children"
			handle=".stack-drag-handle"
			:group="dragGroup"
			:disabled="!can_write"
			ghost-class="stack-drag-ghost"
			chosen-class="stack-drag-chosen"
			list-class="stack-list"
			@start="on_start"
			@end="on_end"
		>
			<template #item="{ element: widget }">
				<WidgetTypeSwitch
					layout="stack"
					:widget="widget"
				/>
			</template>
		</DraggableWidgetList>
	</section>
</template>

<style scoped>
.stack-list {
	display: block;
}

:deep(.stack-drag-ghost) {
	opacity: 0.4;
}

:deep(.stack-drag-chosen) {
	background-color: var(--pc-bg-muted);
}
</style>
