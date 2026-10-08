<script setup lang="ts">
import { computed, ref } from 'vue'
import AuthForm from './AuthForm.vue'
import ProfileDialog from '@/ui/workspace/sidebar/ProfileDialog.vue'
import cloud from '@/store/cloud'
import { CLOUD_UNAVAILABLE, cloud_status_message } from '@/services/cloud/client'
import { format_bytes } from '@/utils/format_bytes'
import DesktopUpdateControls from '@/ui/desktop/DesktopUpdateControls.vue'

withDefaults(defineProps<{
	/** False when the host already shows Check for updates in a pinned footer. */
	show_desktop_update?: boolean
}>(), { show_desktop_update: true })

const profile_dialog = ref<InstanceType<typeof ProfileDialog> | null>(null)
const cloud_notice = computed(() => cloud_status_message(cloud.last_error))
const cloud_offline = computed(() => cloud_notice.value === CLOUD_UNAVAILABLE)

// Deleting the account is irreversible and the backend demands a fresh
// sign-in (step-up), so the confirm dialog doubles as a password prompt
const is_delete_open = ref(false)
const delete_password = ref('')
const is_deleting = ref(false)

function confirm_delete_account() {
	delete_password.value = ''
	cloud.clear_error()
	is_delete_open.value = true
}

function cancel_delete() {
	is_delete_open.value = false
}

async function on_confirm_delete() {
	if (!delete_password.value || is_deleting.value) return
	is_deleting.value = true
	try {
		await cloud.delete_account(delete_password.value)
	} finally {
		is_deleting.value = false
		delete_password.value = ''
		// the dialog stays open on failure so the error is visible next to the field
		if (!cloud.last_error) is_delete_open.value = false
	}
}
</script>

<template>
	<div>
		<p v-if="!cloud.is_configured" class="p-2">
			<small>Cloud is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY</small>
		</p>
		<AuthForm v-else-if="!cloud.user" class="m-2" />
		<div v-else class="flex flex-col gap-2 p-2">
			<UFieldGroup class="w-full">
				<UButton
					color="neutral"
					variant="outline"
					class="min-w-0 flex-1 justify-start"
					icon="i-lucide:user-round"
					:title="cloud.user.email ?? undefined"
				>
					<span class="truncate">{{ cloud.user.email }}</span>
				</UButton>
				<UButton
					icon="i-lucide:log-out"
					color="neutral"
					variant="outline"
					title="Sign out"
					@click="cloud.sign_out()"
				/>
			</UFieldGroup>

			<p v-if="cloud_offline && !is_delete_open" class="text-xs text-muted">
				{{ cloud_notice }}
			</p>
			<p v-else-if="cloud.last_error && !is_delete_open" class="text-xs text-red-500 cursor-pointer" @click="cloud.clear_error()">
				{{ cloud.last_error }}
			</p>

			<UButton
				color="neutral"
				variant="outline"
				icon="i-lucide:at-sign"
				class="justify-start"
				@click="profile_dialog?.open()"
			>
				Profile
				<span v-if="cloud.my_profile?.username" class="truncate text-muted">
					@{{ cloud.my_profile.username }}
				</span>
			</UButton>

			<UButton
				color="neutral"
				variant="outline"
				icon="i-lucide:key-round"
				class="justify-start"
				@click="cloud.open_password_change()"
			>
				Change password
			</UButton>

			<p v-if="cloud.notice && !is_delete_open" class="text-xs text-green-600">
				{{ cloud.notice }}
			</p>

			<p v-if="cloud.billing && cloud.owner_usage" class="px-0.5 text-xs text-muted">
				{{ format_bytes(cloud.owner_usage.used_bytes) }} of
				{{ format_bytes(cloud.billing.quota_bytes) }} used
			</p>
			<p
				v-else-if="cloud.plan_loading"
				class="flex items-center gap-1.5 px-0.5 text-xs text-muted"
			>
				<UIcon name="i-lucide:loader-circle" class="size-3.5 shrink-0 animate-spin" />
				Requesting used storage size...
			</p>

			<p>
				<UButton color="error" variant="link" size="xs" class="px-0" @click="confirm_delete_account">
					Delete cloud account
				</UButton>
			</p>
		</div>

		<UModal
			v-model:open="is_delete_open"
			title="Delete cloud account"
			description="Delete your account and ALL your cloud workspaces? This cannot be undone. Enter your password to confirm."
			:ui="{ footer: 'justify-end' }"
		>
			<template #body>
				<form class="flex flex-col gap-2" @submit.prevent="on_confirm_delete">
					<UInput
						v-model="delete_password"
						type="password"
						placeholder="Password"
						autocomplete="current-password"
						autofocus
					/>
					<p v-if="cloud.last_error" class="text-xs text-red-500">{{ cloud.last_error }}</p>
				</form>
			</template>
			<template #footer>
				<UButton label="Cancel" color="neutral" variant="outline" @click="cancel_delete" />
				<UButton
					label="Delete account"
					color="error"
					:disabled="!delete_password"
					:loading="is_deleting"
					@click="on_confirm_delete"
				/>
			</template>
		</UModal>
		<ProfileDialog ref="profile_dialog" />
		<div
			v-if="is_desktop && show_desktop_update"
			class="border-t border-default px-2 py-1.5"
		>
			<DesktopUpdateControls />
		</div>
	</div>
</template>
