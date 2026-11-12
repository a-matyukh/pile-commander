<script setup lang="ts">
import { computed, ref } from 'vue'
import { is_reserved_slug } from '@pile-commander/file-manager'
import cloud from '@/store/cloud'
import { t } from '@/i18n'
import Button from '@/ui/kit/Button.vue'
import Modal from '@/ui/kit/Modal.vue'
import TextField from '@/ui/kit/TextField.vue'

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
		return t('profile.username_rule')
	}
	if (is_reserved_slug(trimmed_username.value)) return t('profile.username_reserved')
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
	<Modal v-model:open="is_open" :title="t('profile.title')">
		<p class="pf-note">
			{{ t('profile.address') }}
			<span class="pf-mono">/{{ trimmed_username || t('profile.username_example') }}/&lt;slug&gt;</span>
		</p>
		<p v-if="cloud.last_error" class="pf-bad">{{ cloud.last_error }}</p>
		<form class="pf" @submit.prevent="save">
			<TextField v-model="username" icon="tabler:at" :placeholder="t('profile.username')" :invalid="!!username_error" autocomplete="username" />
			<p v-if="username_error" class="pf-bad">{{ username_error }}</p>
			<TextField v-model="display_name" icon="tabler:user" :placeholder="t('profile.display_name')" />
			<button type="submit" hidden />
		</form>
		<template #footer>
			<Button @click="is_open = false">{{ t('dialog.cancel') }}</Button>
			<Button variant="primary" :loading="is_saving" :disabled="!can_save" @click="save">{{ t('dialog.save') }}</Button>
		</template>
	</Modal>
</template>

<style scoped>
.pf {
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.pf-note {
	margin: 0;
	font-size: 12px;
	line-height: 1.5;
	color: var(--text-secondary);
}
.pf-mono {
	font-family: var(--font-mono);
}
.pf-bad {
	margin: 0;
	font-size: 12px;
	color: var(--text-danger);
}
</style>
