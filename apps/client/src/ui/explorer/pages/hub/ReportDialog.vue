<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ABUSE_EMAIL, abuse_mailto } from '@pile-commander/file-manager'
import { t } from '@/i18n'
import cloud from '@/store/cloud'
import Button from '@/ui/kit/Button.vue'
import Modal from '@/ui/kit/Modal.vue'

/**
 * "Report" a publication, in the new interface's look, with the current
 * app's rules (ui/hub/HubReportButton.vue): signed-in reports go to the Hub's
 * moderation once per publication; a visitor without an account writes an
 * email. Not offered on one's own publication or after a report
 */
const props = defineProps<{ workspace_id: string; username: string; slug: string; name: string }>()
const emit = defineEmits<{ visibleChange: [visible: boolean] }>()

const open = ref(false)
const reason = ref('')
const sending = ref(false)
const sent = ref(false)
const already = ref(false)
const error = ref<string | null>(null)

const email = (import.meta.env.VITE_ABUSE_EMAIL as string | undefined)?.trim() || ABUSE_EMAIL
const is_own = computed(() => !!cloud.user && cloud.my_profile?.username === props.username)
const mailto = computed(() => abuse_mailto(
	`Report: ${props.username}/${props.slug}`,
	`I want to report this public board:\n${window.location.origin}/${props.username}/${props.slug}\n\nReason:\n`,
	email,
))

const visible = computed(() => !is_own.value && !sent.value && !already.value)
watch(visible, value => emit('visibleChange', value), { immediate: true })

async function start_report() {
	if (!cloud.user) {
		window.location.href = mailto.value
		return
	}
	error.value = null
	reason.value = ''
	already.value = await cloud.hub_already_reported(props.workspace_id)
	if (!already.value) open.value = true
}

async function submit() {
	const text = reason.value.trim()
	if (!text || sending.value) return
	sending.value = true
	error.value = null
	try {
		if (await cloud.report_hub(props.workspace_id, text)) {
			sent.value = true
			open.value = false
			return
		}
		const message = cloud.last_error ?? t('hub.report_failed')
		if (message.includes('already reported')) {
			already.value = true
			open.value = false
		}
		error.value = message
	} finally {
		sending.value = false
	}
}

defineExpose({ start_report, visible })
</script>

<template>
	<Modal v-model:open="open" :title="t('hub.report_title')" :description="t('hub.report_about', { name, username })">
		<form class="rf" @submit.prevent="submit">
			<textarea
				v-model="reason"
				class="ta"
				rows="3"
				maxlength="280"
				:placeholder="t('hub.report_placeholder')"
				autofocus
			/>
			<p v-if="error" class="bad">{{ error }}</p>
		</form>
		<template #footer>
			<Button @click="open = false">{{ t('dialog.cancel') }}</Button>
			<Button variant="primary" :disabled="!reason.trim()" :loading="sending" @click="submit">{{ t('hub.report_send') }}</Button>
		</template>
	</Modal>
</template>

<style scoped>
.rf {
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.ta {
	width: 100%;
	box-sizing: border-box;
	resize: vertical;
	min-height: 72px;
	padding: 8px 10px;
	border: 0.5px solid var(--border-strong);
	border-radius: 8px;
	background: var(--surface-2);
	font: inherit;
	color: var(--text-primary);
	outline: none;
}
.ta:focus {
	border-color: var(--border-accent);
}
.bad {
	margin: 0;
	font-size: 12px;
	color: var(--text-danger);
}
</style>
