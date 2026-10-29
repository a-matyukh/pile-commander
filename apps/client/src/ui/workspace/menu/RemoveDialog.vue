<script setup lang="ts">
import { ref, computed } from 'vue'
import { t } from '@/i18n'
import { explorer_drives } from '@/store/explorer/drives'
import { remove_confirm_text } from '@/store/explorer/folder_menu'
import { explorer_navigation } from '@/store/explorer/navigation'
import { explorer_mounted } from '@/store/explorer/public_view'
import Button from '@/ui/kit/Button.vue'
import Modal from '@/ui/kit/Modal.vue'

const { name, type } = defineProps<{
	name: string
	type: 'folder' | 'file'
}>()

const emit = defineEmits<{
	confirm: [payload: { id: string }]
}>()

const is_open = ref(false)
const display_name = ref(name)
const target_id = ref('')

const description = computed(() =>
	type === 'folder'
		? `Remove folder "${display_name.value}"? This will delete all contents.`
		: `Remove file "${display_name.value}"?`,
)

function open(item_name = name, id = '') {
	display_name.value = item_name
	target_id.value = id
	is_open.value = true
}

function commit() {
	const id = target_id.value
	is_open.value = false
	if (id) {
		emit('confirm', { id })
	}
}

function cancel() {
	is_open.value = false
}

/**
 * In the Explorer it asks as its List and tree do: to the drive's trash, or
 * forever where the drive has none
 */
const explorer_text = computed(() => {
	const location = explorer_navigation.location
	const trash = location?.kind === 'folder' ? explorer_drives.drive(location.ref.drive_id)?.trash ?? null : null
	const folder = remove_confirm_text(trash)
	if (type === 'folder') return folder
	const to_trash = folder.confirm !== 'tree.delete_permanently'
	return {
		title: to_trash ? 'list.file_trash_title' : 'list.file_delete_title',
		description: to_trash ? 'list.file_trash_description' : 'list.file_delete_description',
		confirm: folder.confirm,
	}
})

defineExpose({ open })
</script>

<template>
	<Modal
		v-if="explorer_mounted"
		v-model:open="is_open"
		:title="t(explorer_text.title, { name: display_name })"
		:description="t(explorer_text.description, { name: display_name })"
	>
		<template #footer>
			<Button @click="cancel">{{ t('dialog.cancel') }}</Button>
			<Button variant="danger" @click="commit">{{ t(explorer_text.confirm) }}</Button>
		</template>
	</Modal>
	<UModal
		v-else
		v-model:open="is_open"
		title="Remove"
		:description="description"
		:ui="{ footer: 'justify-end' }"
	>
		<template #footer>
			<UButton label="Cancel" color="neutral" variant="outline" @click="cancel" />
			<UButton label="Remove" color="error" @click="commit" />
		</template>
	</UModal>
</template>
