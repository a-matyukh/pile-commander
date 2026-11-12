<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import cloud from '@/store/cloud'
import { SIGN_UP_PASSWORD_MIN } from '@/store/helpers/signUpPasswordError'
import { t } from '@/i18n'
import Button from '@/ui/kit/Button.vue'
import Modal from '@/ui/kit/Modal.vue'
import TextField from '@/ui/kit/TextField.vue'

const current = ref('')
const password = ref('')
const confirm = ref('')
const too_short = ref(false)
const mismatch = ref(false)
const current_missing = ref(false)
const done = ref(false)
const is_submitting = ref(false)

const is_recovery = computed(() => cloud.password_prompt === 'recovery')
const open = computed({
	get: () => cloud.password_prompt != null,
	set: (value: boolean) => {
		if (!value && cloud.password_prompt) cloud.dismiss_password_prompt()
	},
})

watch(() => cloud.password_prompt, () => {
	current.value = ''
	password.value = ''
	confirm.value = ''
	too_short.value = false
	mismatch.value = false
	current_missing.value = false
	done.value = false
})

watch(password, (value) => {
	if (value.length >= SIGN_UP_PASSWORD_MIN) too_short.value = false
})

watch(confirm, () => {
	mismatch.value = false
})

async function submit() {
	if (is_submitting.value || done.value) return
	current_missing.value = false
	mismatch.value = false
	if (!is_recovery.value && !current.value) {
		current_missing.value = true
		cloud.clear_error()
		return
	}
	if (password.value.length < SIGN_UP_PASSWORD_MIN) {
		too_short.value = true
		cloud.clear_error()
		return
	}
	too_short.value = false
	if (password.value !== confirm.value) {
		mismatch.value = true
		cloud.clear_error()
		return
	}
	is_submitting.value = true
	try {
		const ok = is_recovery.value
			? await cloud.update_password(password.value)
			: await cloud.change_password(current.value, password.value)
		if (ok) done.value = true
	} finally {
		is_submitting.value = false
	}
}
</script>

<template>
	<Modal
		v-model:open="open"
		:title="is_recovery ? t('password.recovery_title') : t('password.title')"
		:description="is_recovery ? t('password.recovery_description') : t('password.description')"
	>
		<p v-if="done" class="pw-ok">{{ t('password.updated') }}</p>
		<form v-else class="pw" @submit.prevent="submit">
			<TextField
				v-if="!is_recovery"
				v-model="current"
				type="password"
				icon="tabler:lock"
				:placeholder="t('password.current')"
				autocomplete="current-password"
				:invalid="current_missing"
				autofocus
			/>
			<p v-if="current_missing" class="pw-bad">{{ t('password.enter_current') }}</p>
			<TextField
				v-model="password"
				type="password"
				icon="tabler:key"
				:placeholder="t('password.new')"
				autocomplete="new-password"
				:invalid="too_short"
				:autofocus="is_recovery"
			/>
			<p class="pw-hint" :class="{ 'pw-bad': too_short }">{{ t('auth.password_hint', { n: SIGN_UP_PASSWORD_MIN }) }}</p>
			<TextField
				v-model="confirm"
				type="password"
				icon="tabler:key"
				:placeholder="t('password.repeat')"
				autocomplete="new-password"
				:invalid="mismatch"
			/>
			<p v-if="mismatch" class="pw-bad">{{ t('password.mismatch') }}</p>
			<p v-if="cloud.last_error" class="pw-bad">{{ cloud.last_error }}</p>
			<button type="submit" hidden />
		</form>
		<template #footer>
			<Button v-if="done" @click="cloud.dismiss_password_prompt()">{{ t('dialog.close') }}</Button>
			<template v-else>
				<Button @click="cloud.dismiss_password_prompt()">{{ is_recovery ? t('password.not_now') : t('dialog.cancel') }}</Button>
				<Button variant="primary" :loading="is_submitting" @click="submit">{{ t('password.submit') }}</Button>
			</template>
		</template>
	</Modal>
</template>

<style scoped>
.pw {
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.pw-hint {
	margin: -2px 0 0;
	font-size: 12px;
	color: var(--text-muted);
}
.pw-bad {
	margin: 0;
	font-size: 12px;
	color: var(--text-danger);
}
.pw-ok {
	margin: 0;
	font-size: 13px;
	color: var(--text-success);
}
</style>
