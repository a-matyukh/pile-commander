<script setup lang="ts">
import { ref } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { useDeleteSelectedWidgets } from '@/ui/workspace/folder-container/useDeleteSelectedWidgets'
import BulkRemoveDialog from '@/ui/workspace/menu/BulkRemoveDialog.vue'
import RemoveDialog from '@/ui/workspace/menu/RemoveDialog.vue'
import { menu_layer_open } from '@/ui/explorer/folder_keys'

/**
 * Delete or Backspace in List, Gallery and 3D removes the selected items, as
 * on a board: one item asks as its menu's "Move to trash", several ask once
 */
const props = defineProps<{ children: readonly FolderContainerWidgetChild[] }>()

const { dialogRef, removeDialogRef, onConfirm, onConfirmOne } = useDeleteSelectedWidgets({
	children: () => [...props.children],
	editingNoteId: ref(null),
	// An open menu or dialog (the item's own, a rename) keeps the key
	enabled: () => ![...document.querySelectorAll('[role="menu"], [role="dialog"]')].some(menu_layer_open),
})
</script>

<template>
	<RemoveDialog ref="removeDialogRef" name="" type="file" @confirm="onConfirmOne" />
	<BulkRemoveDialog ref="dialogRef" @confirm="onConfirm" />
</template>
