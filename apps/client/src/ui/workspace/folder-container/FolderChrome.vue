<script setup lang="ts">
import { computed } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { FolderView } from '@/domain/Widget'
import FolderSpatialActionsMenu from './FolderSpatialActionsMenu.vue'
import { useCreateChildItems } from '@/ui/workspace/menu/useCreateChildItems'
import { useFolderViewMenuItems } from '@/ui/workspace/menu/useFolderViewMenuItems'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'
import { useFolderContainerScope } from './useFolderContainerScope'
import ItemsDropMenu from '@/ui/kit/ItemsDropMenu.vue'
import { view_label } from '@/ui/kit/items_menu_labels'
import { beginRegisteredNoteEditing, armNoteCreateFromMenu } from './panePosition'

const props = defineProps<{
	view: FolderView
}>()

const requireWorkspace = useRequireWorkspace()
const ws = requireWorkspace()
const { container, folderId } = useFolderContainerScope()
const children = computed(() => container.value?.children ?? [])

const isSpatialView = computed(
	() => props.view === 'canvas' || props.view === 'board',
)

const { newItems, importItem } = useCreateChildItems(folderId, {
	disabled: () => !ws.can_write,
})
const { viewItems } = useFolderViewMenuItems()

async function createNote() {
	// Arm before await — the menu click-through fires while create_note runs.
	armNoteCreateFromMenu()
	const note_id = await ws.create_note(folderId.value)
	if (note_id) {
		beginRegisteredNoteEditing(folderId.value, note_id)
	}
}

const createOnlyItems = computed<DropdownMenuItem[][]>(() => [
	viewItems.value,
	[
		{
			label: 'New',
			disabled: !ws.can_write,
			children: [
				...newItems.value,
				{
					label: 'New note',
					disabled: !ws.can_write,
					onSelect() {
						void createNote()
					},
				},
			],
		},
		importItem.value,
	],
])

const multiSelectedHere = computed(() => {
	const childIds = new Set(children.value.map(child => child.id))
	return ws.selection.filter(id => childIds.has(id)).length >= 2
})

const showCreateMenu = computed(
	() => !ws.selection_mode && !(multiSelectedHere.value && ws.can_write),
)
</script>

<template>
	<span v-if="showCreateMenu" class="folder-chrome board-no-drag" @click.stop @dblclick.stop>
		<FolderSpatialActionsMenu v-if="isSpatialView" />
		<ItemsDropMenu v-else :items="createOnlyItems">
			<template #view-trailing="{ item }">{{ view_label((item as { currentViewLabel?: string }).currentViewLabel) }}</template>
		</ItemsDropMenu>
	</span>
</template>

<style scoped>
.folder-chrome {
	display: flex;
	align-items: center;
	gap: 0.25rem;
	flex-shrink: 0;
	user-select: none;
	-webkit-user-select: none;
	-webkit-touch-callout: none;
}
</style>
