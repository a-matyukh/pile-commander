<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import { ABUSE_EMAIL, abuse_mailto } from '@pile-commander/file-manager'
import cloud from '@/store/cloud'

const props = withDefaults(defineProps<{
	workspace_id: string
	username: string
	slug: string
	name: string
	/** `menu` is the Hub card ⋯; `modal` is the public-board Actions item */
	variant?: 'button' | 'menu' | 'modal'
}>(), { variant: 'button' })

const emit = defineEmits<{
	visibleChange: [visible: boolean]
}>()

const open = ref(false)
const reason = ref('')
const sending = ref(false)
const sent = ref(false)
const already = ref(false)
const error = ref<string | null>(null)

const email =
	((import.meta.env.VITE_ABUSE_EMAIL as string | undefined)?.trim() || ABUSE_EMAIL)
const is_own = computed(
	() => !!cloud.user && cloud.my_profile?.username === props.username,
)
const is_anon = computed(() => !cloud.user)
const public_path = computed(() => `/${props.username}/${props.slug}`)
const mailto = computed(() =>
	abuse_mailto(
		`Report: ${props.username}/${props.slug}`,
		`I want to report this public board:\n${window.location.origin}${public_path.value}\n\nReason:\n`,
		email,
	),
)

const show = computed(() => !is_own.value && !sent.value && !already.value)

watch(show, (value) => emit('visibleChange', value), { immediate: true })

const menu_items = computed<DropdownMenuItem[]>(() => [
	{
		label: 'Report',
		icon: 'i-lucide:flag',
		onSelect: start_report,
	},
])

function start_report() {
	if (is_anon.value) {
		window.location.href = mailto.value
		return
	}
	void on_open()
}

function close() {
	open.value = false
}

async function on_open() {
	error.value = null
	reason.value = ''
	if (!cloud.user) return
	already.value = await cloud.hub_already_reported(props.workspace_id)
	if (!already.value) open.value = true
}

async function submit() {
	const text = reason.value.trim()
	if (!text || sending.value) return
	sending.value = true
	error.value = null
	try {
		const ok = await cloud.report_hub(props.workspace_id, text)
		if (ok) {
			sent.value = true
			open.value = false
			return
		}
		const message = cloud.last_error ?? 'Could not send the report'
		if (message.includes('already reported')) already.value = true
		error.value = message
		if (already.value) open.value = false
	} finally {
		sending.value = false
	}
}

defineExpose({ start_report, visible: show })
</script>

<template>
	<template v-if="show">
		<div v-if="variant === 'menu'" @click.stop @pointerdown.stop>
			<UDropdownMenu :items="menu_items" :content="{ align: 'end' }">
				<UButton
					icon="i-lucide:ellipsis"
					color="neutral"
					variant="ghost"
					size="xs"
					aria-label="More"
				/>
			</UDropdownMenu>
		</div>
		<a
			v-else-if="variant === 'button' && is_anon"
			:href="mailto"
			class="inline-flex items-center gap-1 text-xs text-muted no-underline hover:text-default"
			@click.stop
		>
			Report
		</a>
		<UButton
			v-else-if="variant === 'button'"
			label="Report"
			color="neutral"
			variant="ghost"
			size="xs"
			@click.stop="on_open"
		/>
		<UModal v-if="!is_anon" v-model:open="open" title="Report this workspace">
			<template #body>
				<p class="mb-3 text-sm text-muted">
					{{ name }} by @{{ username }}. Signed-in reports only; anonymous mail goes to the moderator's email.
				</p>
				<UTextarea
					v-model="reason"
					placeholder="Why should this leave the Hub?"
					:rows="3"
					:maxlength="280"
					class="w-full"
				/>
				<p v-if="error" class="mt-2 text-xs text-error">{{ error }}</p>
			</template>
			<template #footer>
				<div class="flex justify-end gap-2">
					<UButton
						label="Cancel"
						color="neutral"
						variant="ghost"
						@click="close"
					/>
					<UButton
						label="Send report"
						:disabled="!reason.trim()"
						:loading="sending"
						@click="submit"
					/>
				</div>
			</template>
		</UModal>
	</template>
</template>
