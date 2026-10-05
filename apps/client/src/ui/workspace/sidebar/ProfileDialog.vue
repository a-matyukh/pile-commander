<script setup lang="ts">
import { computed, ref } from 'vue'
import { is_reserved_slug } from '@pile-commander/file-manager'
import cloud from '@/store/cloud'

/** DB: profiles.username ~ '^[a-z0-9][a-z0-9-]{2,39}$' (the /<username> segment) */
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/

const is_open = ref(false)
const is_saving = ref(false)
const username = ref('')
const display_name = ref('')

const trimmed_username = computed(() => username.value.trim())
const username_error = computed(() => {
	if (!trimmed_username.value) return null
	if (!USERNAME_PATTERN.test(trimmed_username.value)) {
		return '3-40 chars: lowercase letters, digits, hyphens'
	}
	if (is_reserved_slug(trimmed_username.value)) return 'this username is reserved'
	return null
})

const has_changes = computed(() =>
	trimmed_username.value !== (cloud.my_profile?.username ?? '')
	|| display_name.value.trim() !== (cloud.my_profile?.display_name ?? ''),
)

const can_save = computed(() =>
	has_changes.value
	&& !username_error.value
	&& !!trimmed_username.value
	&& !is_saving.value,
)

function open() {
	cloud.clear_error()
	username.value = cloud.my_profile?.username ?? ''
	display_name.value = cloud.my_profile?.display_name ?? ''
	is_open.value = true
}

async function save() {
	if (!can_save.value) return
	is_saving.value = true
	try {
		if (trimmed_username.value !== (cloud.my_profile?.username ?? '')) {
			if (!(await cloud.save_username(trimmed_username.value))) return
		}
		if (display_name.value.trim() !== (cloud.my_profile?.display_name ?? '')) {
			if (!(await cloud.save_display_name(display_name.value.trim()))) return
		}
		is_open.value = false
	} finally {
		is_saving.value = false
	}
}

defineExpose({ open })
</script>

<template>
	<UModal v-model:open="is_open" title="Profile">
		<template #body>
			<p class="mb-3 text-sm text-muted">
				Your username is the public address of your publications:
				<span class="font-mono">/{{ trimmed_username || 'username' }}/&lt;slug&gt;</span>
			</p>
			<p v-if="cloud.last_error" class="mb-3 text-sm text-error">{{ cloud.last_error }}</p>
			<form class="flex flex-col gap-3" @submit.prevent="save">
				<div>
					<UInput
						v-model="username"
						placeholder="set username"
						class="w-full"
						icon="i-lucide:at-sign"
					/>
					<p v-if="username_error" class="mt-1 text-xs text-error">{{ username_error }}</p>
				</div>
				<UInput
					v-model="display_name"
					placeholder="Display name (optional)"
					class="w-full"
					icon="i-lucide:user-round"
				/>
				<div class="flex justify-end">
					<UButton
						type="submit"
						label="Save"
						:loading="is_saving"
						:disabled="!can_save"
					/>
				</div>
			</form>
		</template>
	</UModal>
</template>
