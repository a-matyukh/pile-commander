<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { entry_clipboard } from '@/store/entryClipboard'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'
import BulkRemoveDialog from '@/ui/workspace/menu/BulkRemoveDialog.vue'
import FolderChromeActionButton from './FolderChromeActionButton.vue'
import ClipboardBanner from './ClipboardBanner.vue'
import { useFolderContainerScope } from './useFolderContainerScope'
import { useDeleteSelectedWidgets } from './useDeleteSelectedWidgets'
import { useCombineSelectedWidgets } from './useCombineSelectedWidgets'
import { canvasToolbarInset } from './canvas/canvasToolbarInset'

defineProps<{
	compact?: boolean
}>()

const requireWorkspace = useRequireWorkspace()
const ws = requireWorkspace()
const { container, folderId, isEmbedded } = useFolderContainerScope()
const children = computed(() => container.value?.children ?? [])
const view = computed(() => container.value?.view ?? 'list')
const editingNoteId = ref<string | null>(null)
const isCoarsePointer = useMediaQuery('(pointer: coarse)')
const toolbarInset = canvasToolbarInset(folderId)

const publicMode = computed(() => !!cloud.publication_view || !!cloud.public_not_found)

const showSelect = computed(() =>
	!isEmbedded
	&& isCoarsePointer.value
	&& ws.can_write
	&& !ws.selection_mode
	&& view.value !== 'canvas'
	&& !publicMode.value,
)

const showDeselect = computed(() =>
	!isEmbedded && ws.can_write && ws.selection_mode,
)

const { dialogRef, onConfirm, openConfirm, showBulkRemoveButton } =
	useDeleteSelectedWidgets({
		children,
		editingNoteId,
	})

const { showCombineButton, combineSelected } = useCombineSelectedWidgets({
	children,
	folderId,
	view,
})

const showClipboard = computed(() =>
	!isEmbedded && (entry_clipboard.current?.entry_ids.length ?? 0) > 0,
)

const shown = computed(() =>
	showSelect.value
	|| showDeselect.value
	|| showCombineButton.value
	|| showBulkRemoveButton.value
	|| showClipboard.value,
)

const panelStyle = computed(() => {
	const inset = toolbarInset.value
	if (inset <= 0) return undefined
	return { top: `${inset + 8}px` }
})
</script>

<template>
	<div class="folder-actions-host">
		<div
			v-if="shown"
			class="folder-actions-panel board-no-drag nodrag nopan"
			:style="panelStyle"
			@click.stop
			@dblclick.stop
			@pointerdown.stop
		>
			<FolderChromeActionButton
				v-if="showSelect"
				icon="i-lucide-mouse-pointer-2"
				label="Select"
				:compact="compact"
				@click="ws.enter_selection_mode()"
			/>
			<FolderChromeActionButton
				v-else-if="showDeselect"
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
			<ClipboardBanner v-if="!isEmbedded" />
		</div>
		<div class="folder-actions-dialog">
			<BulkRemoveDialog ref="dialogRef" @confirm="onConfirm" />
		</div>
	</div>
</template>

<style scoped>
.folder-actions-host {
	display: contents;
}

.folder-actions-panel {
	position: absolute;
	z-index: 20;
	top: 0.5rem;
	left: 0.75rem;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem;
	max-width: calc(100% - 1.5rem);
	user-select: none;
	-webkit-user-select: none;
	-webkit-touch-callout: none;
}

.folder-actions-dialog {
	position: absolute;
	width: 0;
	height: 0;
	overflow: visible;
}
</style>
