<script setup lang="ts">
import { computed, ref } from 'vue'
import { count_items, t } from '@/i18n'
import { explorer_drives } from '@/store/explorer/drives'
import { bulk_remove_confirm_text } from '@/store/explorer/folder_menu'
import { explorer_navigation } from '@/store/explorer/navigation'
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
	const trash = location?.kind === 'folder' ? explorer_drives.drive(location.ref.drive_id)?.trash ?? null : null
	const copy = bulk_remove_confirm_text(trash, items.value.some(item => item.isFolder))
	return {
		title: t(copy.title, { items: count_items(items.value.length) }),
		description: t(copy.description),
		confirm: copy.confirm,
	}
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
		<template #footer>
			<Button @click="cancel">{{ t('dialog.cancel') }}</Button>
			<Button variant="danger" @click="commit">{{ t(text.confirm) }}</Button>
		</template>
	</Modal>
</template>
