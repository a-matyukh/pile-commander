<script setup lang="ts">
import { ref, watch } from 'vue'
import { t } from '@/i18n'
import cloud from '@/store/cloud'
import Button from '@/ui/kit/Button.vue'
import Modal from '@/ui/kit/Modal.vue'
import TextField from '@/ui/kit/TextField.vue'

/**
 * Deleting the cloud account is irreversible and the backend wants a fresh
 * sign-in, so the dialog asks for the password again. On failure it stays
 * open with the error next to the field
 */
const open = defineModel<boolean>('open', { required: true })

const password = ref('')
const busy = ref(false)

watch(open, (on) => {
	if (!on) return
	password.value = ''
	cloud.clear_error()
})

async function confirm() {
	if (!password.value || busy.value) return
	busy.value = true
	try {
		await cloud.delete_account(password.value)
	} finally {
		busy.value = false
		password.value = ''
		if (!cloud.last_error) open.value = false
	}
}
</script>

<template>
	<Modal v-model:open="open" :title="t('delete_account.title')" :description="t('delete_account.description')">
		<form class="df" @submit.prevent="confirm">
			<TextField
				v-model="password"
				type="password"
				icon="tabler:lock"
				:placeholder="t('auth.password')"
				autocomplete="current-password"
				autofocus
			/>
			<p v-if="cloud.last_error" class="bad">{{ cloud.last_error }}</p>
		</form>
		<template #footer>
			<Button @click="open = false">{{ t('dialog.cancel') }}</Button>
			<Button variant="danger" :disabled="!password" :loading="busy" @click="confirm">
				{{ t('delete_account.submit') }}
			</Button>
		</template>
	</Modal>
</template>

<style scoped>
.df {
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.bad {
	margin: 0;
	font-size: 12px;
	color: var(--text-danger);
}
</style>
