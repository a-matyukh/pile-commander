<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { FolderView } from '@/domain/Widget'
import FolderSpatialActionsMenu from './FolderSpatialActionsMenu.vue'
import FolderChromeActionButton from './FolderChromeActionButton.vue'
import BulkRemoveDialog from '@/ui/workspace/menu/BulkRemoveDialog.vue'
import { useCreateChildItems } from '@/ui/workspace/menu/useCreateChildItems'
import { useFolderViewMenuItems } from '@/ui/workspace/menu/useFolderViewMenuItems'
import ViewMenuTrailing from '@/ui/workspace/menu/ViewMenuTrailing.vue'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'
import { useFolderContainerScope } from './useFolderContainerScope'
import { useDeleteSelectedWidgets } from './useDeleteSelectedWidgets'
import { useCombineSelectedWidgets } from './useCombineSelectedWidgets'
import { beginRegisteredNoteEditing, armNoteCreateFromMenu } from './panePosition'

const props = defineProps<{
	view: FolderView
	compact?: boolean
}>()

const requireWorkspace = useRequireWorkspace()
const ws = requireWorkspace()
const { container, folderId, isEmbedded } = useFolderContainerScope()
const children = computed(() => container.value?.children ?? [])
const editingNoteId = ref<string | null>(null)

const isSpatialView = computed(
	() => props.view === 'canvas' || props.view === 'board',
)

const selectionMode = computed(() => ws.selection_mode)

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

const { dialogRef, onConfirm, openConfirm, showBulkRemoveButton } =
	useDeleteSelectedWidgets({
		children,
		editingNoteId,
	})

const { showCombineButton, combineSelected } = useCombineSelectedWidgets({
	children,
	folderId,
	view: () => props.view,
})

const showCreateMenu = computed(
	() => !selectionMode.value && !showBulkRemoveButton.value,
)
</script>

<template>
	<span class="folder-chrome board-no-drag" @click.stop @dblclick.stop>
		<template v-if="showCreateMenu">
			<FolderSpatialActionsMenu
				v-if="isSpatialView"
				:compact="compact"
			/>
			<UDropdownMenu
				v-else
				:items="createOnlyItems"
				:content="{
					align: 'start',
					side: 'bottom',
					sideOffset: 8,
				}"
				:ui="{
					content: 'min-w-56',
				}"
			>
				<UButton
					icon="i-lucide-ellipsis"
					color="neutral"
					variant="ghost"
					:size="compact ? 'xs' : 'sm'"
					aria-label="Create"
					title="Create"
				/>
				<template #view-trailing="{ item }">
					<ViewMenuTrailing :label="(item as { currentViewLabel?: string }).currentViewLabel" />
				</template>
			</UDropdownMenu>
		</template>
		<FolderChromeActionButton
			v-else-if="selectionMode && !isEmbedded"
			icon="i-lucide-x"
			label="Deselect"
			:compact="compact"
			@click="ws.exit_selection_mode()"
		/>
		<FolderChromeActionButton
			icon="i-lucide-folders"
			label="Combine selected"
			text="Combine"
			:visible="showCombineButton"
			:compact="compact"
			@click="() => void combineSelected()"
		/>
		<FolderChromeActionButton
			icon="i-lucide-trash-2"
			label="Remove selected"
			text="Remove"
			:visible="showBulkRemoveButton"
			:compact="compact"
			@click="openConfirm"
		/>
		<BulkRemoveDialog ref="dialogRef" @confirm="onConfirm" />
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
