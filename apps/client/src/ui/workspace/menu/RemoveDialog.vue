<script setup lang="ts">
import { ref, computed } from 'vue'
import { t } from '@/i18n'
import { explorer_drives } from '@/store/explorer/drives'
import { remove_confirm_text, remove_file_confirm_text } from '@/store/explorer/folder_menu'
import { explorer_navigation } from '@/store/explorer/navigation'
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
/** The prop, unless `open` names a file or a folder for this one ask */
const kind = ref(type)

function open(item_name = name, id = '', item_type: 'folder' | 'file' = type) {
	display_name.value = item_name
	target_id.value = id
	kind.value = item_type
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
 * for good where the drive has none
 */
const explorer_text = computed(() => {
	const location = explorer_navigation.location
	const drive = location?.kind === 'folder' ? explorer_drives.drive(location.ref.drive_id) : null
	return kind.value === 'folder' ? remove_confirm_text(drive) : remove_file_confirm_text(drive)
})

defineExpose({ open })
</script>

<template>
	<Modal
		v-model:open="is_open"
		:title="t(explorer_text.title, { name: display_name })"
		:description="t(explorer_text.description, { name: display_name })"
	>
		<template #footer>
			<Button @click="cancel">{{ t('dialog.cancel') }}</Button>
			<Button variant="danger" @click="commit">{{ t(explorer_text.confirm) }}</Button>
		</template>
	</Modal>
</template>
