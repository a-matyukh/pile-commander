<script setup lang="ts">
import { computed, ref } from 'vue'
import { count_items, t } from '@/i18n'
import { explorer_drives } from '@/store/explorer/drives'
import { bulk_remove_confirm_text } from '@/store/explorer/folder_menu'
import { explorer_navigation } from '@/store/explorer/navigation'
import { trash_sync_note, trash_sync_note_for_many } from '@/store/explorer/share'
import TrashSyncNote from '@/ui/explorer/folder-header/TrashSyncNote.vue'
import Button from '@/ui/kit/Button.vue'
import Modal from '@/ui/kit/Modal.vue'

export type BulkRemoveItem = {
	id: string
	name: string
	/** True for folder_container / folder_cover widgets. */
	isFolder: boolean
}

const emit = defineEmits<{
	confirm: [payload: { ids: string[] }]
}>()

const is_open = ref(false)
const items = ref<BulkRemoveItem[]>([])

const text = computed(() => {
	const location = explorer_navigation.location
	const drive = location?.kind === 'folder' ? explorer_drives.drive(location.ref.drive_id) : null
	const copy = bulk_remove_confirm_text(drive, items.value.some(item => item.isFolder))
	return {
		title: t(copy.title, { items: count_items(items.value.length) }),
		description: t(copy.description),
		confirm: copy.confirm,
	}
})

/** What the trash does to the synced copies of these items */
const sync_note = computed(() => {
	const location = explorer_navigation.location
	if (!is_open.value || location?.kind !== 'folder') return null
	const [only] = items.value
	if (items.value.length === 1 && only) return trash_sync_note({ ...location.ref, folder_id: only.id }, only.isFolder ? 'folder' : 'file')
	return trash_sync_note_for_many(items.value.map(item => ({ ...location.ref, folder_id: item.id })))
})

function open(nextItems: BulkRemoveItem[]) {
	if (nextItems.length === 0) return
	items.value = nextItems
	is_open.value = true
}

function commit() {
	const ids = items.value.map(item => item.id)
	is_open.value = false
	if (ids.length > 0) {
		emit('confirm', { ids })
	}
}

function cancel() {
	is_open.value = false
}

defineExpose({ open })
</script>

<template>
	<Modal
		v-model:open="is_open"
		:title="text.title"
		:description="text.description"
	>
		<TrashSyncNote v-if="sync_note" :note="sync_note" />
		<template #footer>
			<Button @click="cancel">{{ t('dialog.cancel') }}</Button>
			<Button variant="danger" @click="commit">{{ t(text.confirm) }}</Button>
		</template>
	</Modal>
</template>
