<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
	confirm: []
}>()

const is_open = ref(false)
const title = ref('')
const description = ref('')
const confirm_label = ref('Confirm')

function open(options: { title: string; description: string; confirmLabel?: string }) {
	title.value = options.title
	description.value = options.description
	confirm_label.value = options.confirmLabel ?? 'Confirm'
	is_open.value = true
}

function commit() {
	is_open.value = false
	emit('confirm')
}

function cancel() {
	is_open.value = false
}

defineExpose({ open })
</script>

<template>
	<UModal
		v-model:open="is_open"
		:title="title"
		:description="description"
		:ui="{ footer: 'justify-end' }"
	>
		<template #footer>
			<UButton label="Cancel" color="neutral" variant="outline" @click="cancel" />
			<UButton :label="confirm_label" color="error" @click="commit" />
		</template>
	</UModal>
</template>
