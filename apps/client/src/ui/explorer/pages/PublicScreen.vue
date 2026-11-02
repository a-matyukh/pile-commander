<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import cloud from '@/store/cloud'
import { back_to_explorer_hub, leave_invite } from '@/store/explorer/public_view'
import Button from '@/ui/kit/Button.vue'
import AuthForm from '@/ui/workspace/sidebar/workspaces-list/AuthForm.vue'
import { explorer_window_classes } from '@/ui/explorer/window_classes'
import '../tokens.css'

/**
 * An invitation or a missing publication, in place of the shell. The shell
 * stays unmounted while either flag is set, so a cold start does not open
 * the last folder underneath and there is no header to leave through.
 */
const view = computed(() => cloud.invite_view)
const preview = computed(() => view.value?.preview ?? null)

const redirect_to = computed(() => {
	const token = view.value?.token
	if (!token) return undefined
	const origin = (import.meta.env.VITE_PUBLIC_BASE_URL || window.location.origin).replace(/\/$/, '')
	return `${origin}/invite/${token}`
})

const role_label = computed(() => {
	if (preview.value?.role === 'viewer') return t('invite.role_viewer')
	if (preview.value?.role === 'editor') return t('invite.role_editor')
	return ''
})

async function sign_out() {
	await cloud.sign_out()
}
</script>

<template>
	<div class="explorer screen" :class="explorer_window_classes">
		<div v-if="view" class="card">
			<p v-if="view.loading" class="muted">{{ t('invite.loading') }}</p>
			<template v-else-if="preview">
				<h1>{{ t('invite.invited', { inviter: preview.inviter || t('invite.someone'), workspace: preview.workspace_name }) }}</h1>
				<p class="muted">{{ t('invite.join_as', { role: role_label, email: preview.email }) }}</p>
				<p v-if="view.error" class="err">{{ view.error }}</p>
				<template v-if="cloud.user">
					<p class="muted">{{ t('invite.signed_in', { email: cloud.user.email ?? '' }) }}</p>
					<Button @click="sign_out">{{ t('account.sign_out') }}</Button>
				</template>
				<AuthForm
					v-else
					:initial_email="preview.email"
					initial_mode="sign_up"
					:redirect_to="redirect_to"
				/>
			</template>
			<p v-else-if="view.error" class="err">{{ view.error }}</p>
			<Button @click="leave_invite">{{ t('invite.open_app') }}</Button>
		</div>
		<div v-else-if="cloud.public_not_found" class="card missing">
			<h1>{{ t('publication.not_found') }}</h1>
			<p class="muted">
				<span class="mono">/{{ cloud.public_not_found }}</span>
				{{ t('publication.not_found_tail') }}
			</p>
			<Button @click="back_to_explorer_hub">{{ t('publication.back_to_hub') }}</Button>
		</div>
	</div>
</template>

<style scoped>
.screen {
	height: 100%;
	min-height: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 24px;
	box-sizing: border-box;
}
.card {
	width: 100%;
	max-width: 28rem;
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 12px;
}
.missing {
	align-items: center;
	text-align: center;
}
h1 {
	margin: 0;
	font-size: 16px;
	font-weight: 600;
}
p {
	margin: 0;
}
.muted {
	color: var(--text-secondary);
}
.err {
	color: var(--text-danger);
}
.mono {
	font-family: var(--font-mono);
}
</style>
