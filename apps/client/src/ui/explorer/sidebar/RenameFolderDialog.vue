<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { t } from '@/i18n'
import Button from '@/ui/kit/Button.vue'
import Modal from '@/ui/kit/Modal.vue'
import TextField from '@/ui/kit/TextField.vue'

/** `is_file`: select the name without its extension, like Finder */
const props = defineProps<{ name: string; is_file?: boolean }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ confirm: [name: string] }>()
const draft = ref('')
const field = ref<InstanceType<typeof TextField> | null>(null)

watch(open, async value => {
	if (!value) return
	draft.value = props.name
	const dot = props.is_file ? props.name.lastIndexOf('.') : -1
	const select: boolean | [number, number] = dot > 0 ? [0, dot] : true
	await nextTick()
	field.value?.focus(select)
	// The dialog's field is portaled in on open, one tick after the flag
	if (document.activeElement?.tagName !== 'INPUT') {
		await nextTick()
		field.value?.focus(select)
	}
})

function confirm() {
	const name = draft.value.trim()
	if (!name) return
	open.value = false
	emit('confirm', name)
}
</script>

<template>
	<Modal v-model:open="open" :title="t('menu.rename')">
		<form @submit.prevent="confirm">
			<TextField ref="field" v-model="draft" autocomplete="off" autofocus />
		</form>
		<template #footer>
			<Button @click="open = false">{{ t('dialog.cancel') }}</Button>
			<Button variant="primary" :disabled="!draft.trim()" @click="confirm">
				{{ t('dialog.save') }}
			</Button>
		</template>
	</Modal>
</template>
