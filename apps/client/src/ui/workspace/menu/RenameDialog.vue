<script setup lang="ts">
import { ref, nextTick } from 'vue'

const { initial_name } = defineProps<{
	initial_name: string
}>()

const emit = defineEmits<{
	confirm: [payload: { id: string; name: string }]
}>()

const is_open = ref(false)
const name_input = ref<{ inputRef: HTMLInputElement | null } | null>(null)
const draft_name = ref('')
const opened_name = ref('')
const target_id = ref('')
const confirm_label = ref('Rename')

async function open(name = initial_name, id = '', label = 'Rename') {
	opened_name.value = name
	draft_name.value = name
	target_id.value = id
	confirm_label.value = label
	is_open.value = true
	await nextTick()
	const input = name_input.value?.inputRef
	input?.focus()
	input?.select()
}

function commit() {
	const name = draft_name.value.trim()
	const id = target_id.value
	is_open.value = false
	if (id && name && name !== opened_name.value) {
		emit('confirm', { id, name })
	}
}

function cancel() {
	is_open.value = false
	draft_name.value = opened_name.value
}

function on_open_change(open: boolean) {
	if (!open) {
		draft_name.value = opened_name.value
	}
}

defineExpose({ open })
</script>

<template>
	<UModal
		v-model:open="is_open"
		title="New name"
		:ui="{ footer: 'justify-end' }"
		@update:open="on_open_change"
	>
		<template #body>
			<form @submit.prevent="commit">
				<UInput
					ref="name_input"
					v-model="draft_name"
					autocomplete="off"
				/>
			</form>
		</template>

		<template #footer>
			<UButton label="Cancel" color="neutral" variant="outline" @click="cancel" />
			<UButton :label="confirm_label" @click="commit" />
		</template>
	</UModal>
</template>
