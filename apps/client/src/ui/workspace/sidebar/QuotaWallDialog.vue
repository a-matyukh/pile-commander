<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
	record_quota_wall_event,
	update_quota_wall_event,
} from '@pile-commander/file-manager'
import { format_bytes } from '@/utils/format_bytes'
import { require_supabase } from '@/services/cloud/client'
import cloud from '@/store/cloud'
import quota_wall, { close_quota_wall } from '@/store/quotaWall'

const answer = ref('')
const event_id = ref<string | null>(null)
const is_saving = ref(false)

const title = computed(() => {
	switch (quota_wall.payload?.kind) {
		case 'file_size':
			return 'This file is too large'
		case 'hub_limit':
			return 'Hub listing limit'
		default:
			return 'Cloud storage is full'
	}
})

const summary = computed(() => {
	const p = quota_wall.payload
	if (!p) return ''
	if (p.kind === 'file_size') {
		const size = p.file_bytes != null ? format_bytes(p.file_bytes) : 'this file'
		const cap = p.max_file_bytes != null ? format_bytes(p.max_file_bytes) : 'the plan limit'
		const mime = quota_wall.file_mime ? ` (${quota_wall.file_mime})` : ''
		return `${size}${mime} is over the ${cap} limit for one original.`
	}
	if (p.kind === 'hub_limit') {
		const used = p.used_bytes ?? 0
		const max = p.quota_bytes ?? 3
		return `Free can list ${max} workspaces on the Hub. You already have ${used}.`
	}
	const used = p.used_bytes != null ? format_bytes(p.used_bytes) : 'your cloud'
	const quota = p.quota_bytes != null ? format_bytes(p.quota_bytes) : 'your plan'
	const extra = p.needed_bytes != null ? ` This add needs ${format_bytes(p.needed_bytes)}.` : ''
	return `${used} of ${quota} is used.${extra} Delete files or empty trash to free space.`
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
	<UModal
		:open="quota_wall.open"
		:title="title"
		:ui="{ footer: 'justify-end' }"
		@update:open="(value: boolean) => { if (!value) close_quota_wall() }"
	>
		<template #body>
			<p class="mb-4 text-sm text-muted">{{ summary }}</p>
			<p class="mb-2 text-sm">What are you collecting, and how much space do you need?</p>
			<UTextarea
				v-model="answer"
				placeholder="Optional — photos, video, notes…"
				:rows="3"
				class="w-full"
			/>
		</template>
		<template #footer>
			<UButton color="neutral" variant="ghost" label="Close" @click="close_quota_wall" />
			<UButton
				label="Send"
				:loading="is_saving"
				:disabled="!answer.trim()"
				@click="submit_answer"
			/>
		</template>
	</UModal>
</template>
