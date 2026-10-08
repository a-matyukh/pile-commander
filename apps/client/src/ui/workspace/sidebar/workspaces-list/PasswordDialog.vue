<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import cloud from '@/store/cloud'
import { SIGN_UP_PASSWORD_HINT, SIGN_UP_PASSWORD_MIN } from '@/store/helpers/signUpPasswordError'

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
	<UModal
		v-model:open="open"
		:title="is_recovery ? 'Choose a new password' : 'Change password'"
		:description="is_recovery
			? 'This replaces the password on your account.'
			: 'Enter your current password, then a new one.'"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<p v-if="done" class="text-sm text-green-600">Password updated.</p>
			<form v-else class="flex flex-col gap-2" @submit.prevent="submit">
				<UInput
					v-if="!is_recovery"
					v-model="current"
					type="password"
					placeholder="Current password"
					autocomplete="current-password"
					autofocus
				/>
				<p v-if="current_missing" class="text-xs text-red-500">Enter your current password.</p>
				<UInput
					v-model="password"
					type="password"
					placeholder="New password"
					autocomplete="new-password"
					:autofocus="is_recovery"
				/>
				<p
					class="text-xs"
					:class="too_short ? 'text-red-500' : 'opacity-60'"
				>
					{{ SIGN_UP_PASSWORD_HINT }}
				</p>
				<UInput
					v-model="confirm"
					type="password"
					placeholder="Repeat password"
					autocomplete="new-password"
				/>
				<p v-if="mismatch" class="text-xs text-red-500">Those passwords don't match.</p>
				<p v-if="cloud.last_error" class="text-xs text-red-500">{{ cloud.last_error }}</p>
			</form>
		</template>
		<template #footer>
			<UButton
				v-if="done"
				label="Close"
				color="neutral"
				variant="outline"
				@click="cloud.dismiss_password_prompt()"
			/>
			<template v-else>
				<UButton
					:label="is_recovery ? 'Not now' : 'Cancel'"
					color="neutral"
					variant="outline"
					@click="cloud.dismiss_password_prompt()"
				/>
				<UButton
					label="Update password"
					:loading="is_submitting"
					@click="submit"
				/>
			</template>
		</template>
	</UModal>
</template>
