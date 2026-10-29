<script setup lang="ts">
import { ref, watch } from 'vue'
import { t } from '@/i18n'
import Button from '@/ui/kit/Button.vue'
import Modal from '@/ui/kit/Modal.vue'
import TextField from '@/ui/kit/TextField.vue'

const props = defineProps<{ name: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ confirm: [name: string] }>()
const draft = ref('')

watch(open, value => {
	if (value) draft.value = props.name
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
			<TextField v-model="draft" autocomplete="off" autofocus />
		</form>
		<template #footer>
			<Button @click="open = false">{{ t('dialog.cancel') }}</Button>
			<Button variant="primary" :disabled="!draft.trim()" @click="confirm">
				{{ t('dialog.save') }}
			</Button>
		</template>
	</Modal>
</template>
