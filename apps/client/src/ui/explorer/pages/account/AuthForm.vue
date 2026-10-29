<script setup lang="ts">
import { ref, watch } from 'vue'
import { t } from '@/i18n'
import cloud from '@/store/cloud'
import { SIGN_UP_PASSWORD_MIN } from '@/store/helpers/signUpPasswordError'
import Button from '@/ui/kit/Button.vue'
import TextField from '@/ui/kit/TextField.vue'

/**
 * Sign in and sign up: the prototype's form, the current app's logic
 * (workspaces-list/AuthForm.vue). Registration is closed for now, as there
 */
const SIGN_UP_CLOSED = true

const mode = ref<'sign_in' | 'sign_up'>('sign_in')
const email = ref('')
const password = ref('')
const too_short = ref(false)
const email_missing = ref(false)
const busy = ref(false)
const resetting = ref(false)

watch(password, (value) => {
	if (value.length >= SIGN_UP_PASSWORD_MIN) too_short.value = false
})
watch(email, (value) => {
	if (value) email_missing.value = false
})

async function submit() {
	if (!email.value || !password.value || busy.value) return
	if (mode.value === 'sign_up' && password.value.length < SIGN_UP_PASSWORD_MIN) {
		too_short.value = true
		cloud.clear_error()
		return
	}
	busy.value = true
	try {
		if (mode.value === 'sign_in' || SIGN_UP_CLOSED) await cloud.sign_in(email.value, password.value)
		else await cloud.sign_up(email.value, password.value)
	} finally {
		busy.value = false
	}
}

async function forgot() {
	if (resetting.value) return
	if (!email.value) {
		email_missing.value = true
		cloud.clear_error()
		return
	}
	resetting.value = true
	try {
		await cloud.request_password_reset(email.value)
	} finally {
		resetting.value = false
	}
}

function toggle() {
	if (SIGN_UP_CLOSED) return
	mode.value = mode.value === 'sign_in' ? 'sign_up' : 'sign_in'
	too_short.value = false
	email_missing.value = false
	cloud.notice = null
	cloud.clear_error()
}

// The terms must be reachable where the account is created; no landing URL, no link
const landing_url = (import.meta.env.VITE_LANDING_URL as string | undefined)?.trim().replace(/\/$/, '') || null
</script>

<template>
	<form class="auth" @submit.prevent="submit">
		<div class="head">
			<div class="ttl">{{ mode === 'sign_in' ? t('auth.sign_in_title') : t('auth.sign_up_title') }}</div>
			<div class="sub">{{ t('auth.why') }}</div>
		</div>
		<TextField v-model="email" type="email" icon="tabler:mail" :placeholder="t('auth.email')" autocomplete="email" autofocus />
		<TextField
			v-model="password"
			type="password"
			icon="tabler:lock"
			:placeholder="t('auth.password')"
			:autocomplete="mode === 'sign_in' ? 'current-password' : 'new-password'"
			:invalid="too_short"
		/>
		<p v-if="mode === 'sign_up'" class="msg" :class="{ bad: too_short }">{{ t('auth.password_hint', { n: SIGN_UP_PASSWORD_MIN }) }}</p>
		<p v-if="email_missing" class="msg bad">{{ t('auth.enter_email') }}</p>
		<p v-if="cloud.last_error" class="msg bad">{{ cloud.last_error }}</p>
		<p v-if="cloud.notice" class="msg ok">{{ cloud.notice }}</p>
		<Button type="submit" variant="primary" block :loading="busy" :disabled="!email || !password">
			{{ mode === 'sign_in' ? t('auth.sign_in') : t('auth.sign_up') }}
		</Button>
		<div class="links">
			<Button v-if="mode === 'sign_in'" variant="link" :disabled="resetting" @click="forgot">{{ t('auth.forgot') }}</Button>
			<Button v-if="!SIGN_UP_CLOSED" variant="link" @click="toggle">
				{{ mode === 'sign_in' ? t('auth.to_sign_up') : t('auth.to_sign_in') }}
			</Button>
		</div>
		<p v-if="SIGN_UP_CLOSED" class="msg terms">{{ t('auth.sign_up_closed') }}</p>
		<p v-else-if="mode === 'sign_up' && landing_url" class="msg terms">
			<a :href="`${landing_url}/terms`" target="_blank" rel="noopener noreferrer">{{ t('auth.terms') }}</a>
		</p>
	</form>
</template>

<style scoped>
.auth {
	display: flex;
	flex-direction: column;
	gap: 10px;
	max-width: 360px;
	margin: 24px auto 0;
	padding: 20px;
	border: 0.5px solid var(--border);
	border-radius: 12px;
	background: var(--surface-2);
}
.head {
	margin-bottom: 4px;
}
.ttl {
	font-size: 17px;
	font-weight: 500;
}
.sub {
	font-size: 12px;
	line-height: 1.5;
	color: var(--text-secondary);
	margin-top: 4px;
}
.msg {
	margin: 0;
	font-size: 12px;
	line-height: 1.45;
	color: var(--text-muted);
}
.msg.bad {
	color: var(--text-danger);
}
.msg.ok {
	color: var(--text-success);
}
.links {
	display: flex;
	justify-content: space-between;
	gap: 12px;
}
.links :only-child {
	margin: 0 auto;
}
.terms {
	text-align: center;
}
.explorer.lg .ttl {
	font-size: 19px;
}
.explorer.lg .sub,
.explorer.lg .msg {
	font-size: 13px;
}
</style>
