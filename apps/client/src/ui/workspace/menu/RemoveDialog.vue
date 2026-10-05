<script setup lang="ts">
import { ref, computed } from 'vue'

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

defineExpose({ open })
</script>

<template>
	<UModal
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
