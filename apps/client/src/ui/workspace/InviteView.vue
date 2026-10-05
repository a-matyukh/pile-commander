<script setup lang="ts">
import { computed } from 'vue'
import cloud from '@/store/cloud'
import AuthForm from '@/ui/workspace/sidebar/workspaces-list/AuthForm.vue'

const view = computed(() => cloud.invite_view)
const preview = computed(() => view.value?.preview ?? null)

const redirect_to = computed(() => {
	const token = view.value?.token
	if (!token) return undefined
	const origin = (import.meta.env.VITE_PUBLIC_BASE_URL || window.location.origin).replace(/\/$/, '')
	return `${origin}/invite/${token}`
})

const role_label = computed(() => {
	if (preview.value?.role === 'viewer') return 'viewer'
	if (preview.value?.role === 'editor') return 'editor'
	return null
})

async function sign_out() {
	await cloud.sign_out()
}
</script>

<template>
	<div class="mx-auto flex max-w-md flex-col gap-4 p-6">
		<p v-if="view?.loading" class="text-sm text-muted">Loading invitation…</p>
		<template v-else-if="preview">
			<h1 class="text-lg font-semibold text-default">
				{{ preview.inviter || 'Someone' }} invited you to {{ preview.workspace_name }}
			</h1>
			<p class="text-sm text-muted">
				Join as {{ role_label }} using {{ preview.email }}.
			</p>
			<p v-if="view?.error" class="text-sm text-error">{{ view.error }}</p>
			<template v-if="cloud.user">
				<p class="text-sm text-muted">Signed in as {{ cloud.user.email }}</p>
				<UButton label="Sign out" color="neutral" variant="outline" size="sm" @click="sign_out" />
			</template>
			<AuthForm
				v-else
				:initial_email="preview.email"
				initial_mode="sign_up"
				:redirect_to="redirect_to"
			/>
		</template>
		<p v-else-if="view?.error" class="text-sm text-error">{{ view.error }}</p>
	</div>
</template>
