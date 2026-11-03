<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { ImageTextField } from '@/services/workspace/imageText'
import { t } from '@/i18n'
import Button from '@/ui/kit/Button.vue'
import Modal from '@/ui/kit/Modal.vue'
import TextField from '@/ui/kit/TextField.vue'

const emit = defineEmits<{
	confirm: [payload: { id: string; field: ImageTextField; value: string }]
}>()

const is_open = ref(false)
const field = ref<ImageTextField>('title')
const editing = ref(false)
const draft = ref('')
const target_id = ref('')
const name_input = ref<InstanceType<typeof TextField> | null>(null)
const area = ref<HTMLTextAreaElement | null>(null)

const title = computed(() => {
	if (field.value === 'title') return t(editing.value ? 'board_menu.edit_title' : 'board_menu.add_title')
	return t(editing.value ? 'board_menu.edit_description' : 'board_menu.add_description')
})

async function focus_field() {
	await nextTick()
	if (field.value === 'title') {
		name_input.value?.focus(true)
		if (document.activeElement?.tagName !== 'INPUT') {
			await nextTick()
			name_input.value?.focus(true)
		}
		return
	}
	area.value?.focus()
	area.value?.select()
	if (document.activeElement?.tagName !== 'TEXTAREA') {
		await nextTick()
		area.value?.focus()
		area.value?.select()
	}
}

async function open(next: ImageTextField, value: string, id: string) {
	field.value = next
	editing.value = value.trim() !== ''
	draft.value = value
	target_id.value = id
	is_open.value = true
	await focus_field()
}

function commit() {
	is_open.value = false
	emit('confirm', { id: target_id.value, field: field.value, value: draft.value })
}

function cancel() {
	is_open.value = false
}

defineExpose({ open })
</script>

<template>
	<Modal v-model:open="is_open" :title="title">
		<form class="form" @submit.prevent="commit">
			<TextField v-if="field === 'title'" ref="name_input" v-model="draft" autocomplete="off" />
			<textarea v-else ref="area" v-model="draft" class="area" rows="3" />
		</form>
		<template #footer>
			<Button @click="cancel">{{ t('dialog.cancel') }}</Button>
			<Button variant="primary" @click="commit">{{ t('dialog.save') }}</Button>
		</template>
	</Modal>
</template>

<style scoped>
.form {
	display: flex;
	flex-direction: column;
}
.area {
	width: 100%;
	box-sizing: border-box;
	min-height: 72px;
	resize: vertical;
	padding: 8px 10px;
	border: 0.5px solid var(--border-strong);
	border-radius: 7px;
	background: var(--surface-2);
	color: var(--text-primary);
	font: inherit;
	font-size: 13px;
	line-height: 1.4;
}
.area:focus {
	outline: none;
	border-color: var(--fill-accent);
	box-shadow: 0 0 0 3px var(--bg-accent);
}
</style>
