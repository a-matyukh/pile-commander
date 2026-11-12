<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
	record_quota_wall_event,
	update_quota_wall_event,
} from '@pile-commander/file-manager'
import { format_bytes } from '@/utils/format_bytes'
import { t } from '@/i18n'
import Button from '@/ui/kit/Button.vue'
import Modal from '@/ui/kit/Modal.vue'
import Textarea from '@/ui/kit/Textarea.vue'
import { require_supabase } from '@/services/cloud/client'
import cloud from '@/store/cloud'
import quota_wall, { close_quota_wall } from '@/store/quotaWall'

const answer = ref('')
const event_id = ref<string | null>(null)
const is_saving = ref(false)

const title = computed(() => {
	switch (quota_wall.payload?.kind) {
		case 'file_size':
			return t('quota_wall.file_size_title')
		case 'hub_limit':
			return t('quota_wall.hub_limit_title')
		default:
			return t('quota_wall.storage_title')
	}
})

const summary = computed(() => {
	const p = quota_wall.payload
	if (!p) return ''
	if (p.kind === 'file_size') {
		const size = p.file_bytes != null ? format_bytes(p.file_bytes) : t('quota_wall.this_file')
		const cap = p.max_file_bytes != null ? format_bytes(p.max_file_bytes) : t('quota_wall.plan_limit')
		const mime = quota_wall.file_mime ? ` (${quota_wall.file_mime})` : ''
		return t('quota_wall.file_size', { size, mime, cap })
	}
	if (p.kind === 'hub_limit') {
		return t('quota_wall.hub_limit', { max: p.quota_bytes ?? 3, used: p.used_bytes ?? 0 })
	}
	const parts: string[] = []
	if (p.used_bytes != null && p.quota_bytes != null) {
		parts.push(t('quota_wall.storage', { used: format_bytes(p.used_bytes), quota: format_bytes(p.quota_bytes) }))
	}
	if (p.needed_bytes != null) parts.push(t('quota_wall.needs', { size: format_bytes(p.needed_bytes) }))
	parts.push(t('quota_wall.free_space'))
	return parts.join(' ')
})

watch(
	() => quota_wall.open,
	async (open) => {
		if (!open || !quota_wall.payload || !cloud.user) return
		answer.value = ''
		event_id.value = null
		try {
			event_id.value = await record_quota_wall_event(
				require_supabase(),
				cloud.user.id,
				{
					kind: quota_wall.payload.kind,
					used_bytes: quota_wall.payload.used_bytes,
					quota_bytes: quota_wall.payload.quota_bytes,
					file_bytes: quota_wall.payload.file_bytes,
					file_mime: quota_wall.file_mime,
					needed_bytes: quota_wall.payload.needed_bytes,
				},
			)
		} catch (error) {
			console.error(error)
		}
		void cloud.fetch_plan()
	},
)

async function submit_answer() {
	const id = event_id.value
	const text = answer.value.trim()
	if (!id || !text || is_saving.value) {
		close_quota_wall()
		return
	}
	is_saving.value = true
	try {
		await update_quota_wall_event(require_supabase(), id, text)
	} catch (error) {
		console.error(error)
	} finally {
		is_saving.value = false
		close_quota_wall()
	}
}
</script>

<template>
	<Modal :open="quota_wall.open" :title="title" :description="summary" @update:open="(value: boolean) => { if (!value) close_quota_wall() }">
		<div class="qw">
			<p class="qw-question">{{ t('quota_wall.question') }}</p>
			<Textarea v-model="answer" :placeholder="t('quota_wall.placeholder')" :rows="3" />
		</div>
		<template #footer>
			<Button @click="close_quota_wall">{{ t('dialog.close') }}</Button>
			<Button variant="primary" :loading="is_saving" :disabled="!answer.trim()" @click="submit_answer">{{ t('quota_wall.send') }}</Button>
		</template>
	</Modal>
</template>

<style scoped>
.qw {
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.qw-question {
	margin: 0;
	font-size: 13px;
}
</style>
