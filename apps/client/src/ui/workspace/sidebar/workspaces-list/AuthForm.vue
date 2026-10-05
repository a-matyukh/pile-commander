<script setup lang="ts">
import { ref, watch } from 'vue'
import cloud from '@/store/cloud'
import { SIGN_UP_PASSWORD_HINT, SIGN_UP_PASSWORD_MIN } from '@/store/helpers/signUpPasswordError'

const props = withDefaults(defineProps<{
	initial_email?: string
	initial_mode?: 'sign_in' | 'sign_up'
	redirect_to?: string
}>(), {
	initial_mode: 'sign_in',
})

const mode = ref<'sign_in' | 'sign_up'>(props.initial_mode)
const email = ref(props.initial_email ?? '')
const password = ref('')
const is_submitting = ref(false)
const password_too_short = ref(false)
const email_missing = ref(false)
const is_resetting = ref(false)

watch(() => props.initial_email, (value) => {
	if (value && !email.value) email.value = value
})

watch(() => props.initial_mode, (value) => {
	mode.value = value
})

watch(password, (value) => {
	if (value.length >= SIGN_UP_PASSWORD_MIN) password_too_short.value = false
})

watch(email, (value) => {
	if (value) email_missing.value = false
})

async function forgot() {
	if (is_resetting.value) return
	if (!email.value) {
		email_missing.value = true
		cloud.clear_error()
		return
	}
	email_missing.value = false
	is_resetting.value = true
	try {
		await cloud.request_password_reset(email.value)
	} finally {
		is_resetting.value = false
	}
}

async function submit() {
	if (!email.value || !password.value || is_submitting.value) return
	// Length is known here. A leaked password is not: that answer comes back
	// from Auth after the request, as sign_up_error_message.
	if (mode.value === 'sign_up' && password.value.length < SIGN_UP_PASSWORD_MIN) {
		password_too_short.value = true
		cloud.clear_error()
		return
	}
	password_too_short.value = false
	is_submitting.value = true
	try {
		if (mode.value === 'sign_in') {
			await cloud.sign_in(email.value, password.value)
		} else {
			await cloud.sign_up(email.value, password.value, props.redirect_to)
		}
	} finally {
		is_submitting.value = false
	}
}

function toggle_mode() {
	mode.value = mode.value === 'sign_in' ? 'sign_up' : 'sign_in'
	password_too_short.value = false
	email_missing.value = false
	cloud.notice = null
	cloud.clear_error()
}

// Sign-up is where the account (and its email) is created, so the terms have to
// be reachable from here. No VITE_LANDING_URL, no links: a dead link would be
// worse than none
const landing_url = (import.meta.env.VITE_LANDING_URL as string | undefined)
	?.trim()
	.replace(/\/$/, '') || null
</script>

<template>
	<form
		class="flex flex-col gap-2 p-2 rounded border border-gray-200 dark:border-gray-700"
		@submit.prevent="submit"
	>
		<UInput v-model="email" type="email" placeholder="Email" required autocomplete="email" />
		<UInput
			v-model="password"
			type="password"
			placeholder="Password"
			required
			:autocomplete="mode === 'sign_in' ? 'current-password' : 'new-password'"
		/>
		<p
			v-if="mode === 'sign_up'"
			class="text-xs"
			:class="password_too_short ? 'text-red-500' : 'opacity-60'"
		>
			{{ SIGN_UP_PASSWORD_HINT }}
		</p>
		<p v-if="email_missing" class="text-xs text-red-500">Enter your email address.</p>
		<p v-if="cloud.notice" class="text-xs text-green-600 dark:text-green-400">{{ cloud.notice }}</p>
		<p v-if="cloud.last_error" class="text-xs text-red-500 cursor-pointer" @click="cloud.clear_error()">
			{{ cloud.last_error }}
		</p>
		<UButton type="submit" size="sm" block :loading="is_submitting">
			{{ mode === 'sign_in' ? 'Sign in' : 'Sign up' }}
		</UButton>
		<button
			v-if="mode === 'sign_in'"
			type="button"
			class="text-xs opacity-60 hover:opacity-100 cursor-pointer"
			:disabled="is_resetting"
			@click="forgot"
		>
			Forgot password?
		</button>
		<p v-if="mode === 'sign_up' && landing_url" class="text-xs opacity-60">
			By creating an account you agree to the
			<a :href="`${landing_url}/terms`" target="_blank" rel="noopener noreferrer" class="underline">Terms</a>
			and the
			<a :href="`${landing_url}/privacy`" target="_blank" rel="noopener noreferrer" class="underline">Privacy Policy</a>.
		</p>
		<button type="button" class="text-xs opacity-60 hover:opacity-100 cursor-pointer" @click="toggle_mode">
			{{ mode === 'sign_in' ? 'No account yet? Sign up' : 'Have an account? Sign in' }}
		</button>
	</form>
</template>
