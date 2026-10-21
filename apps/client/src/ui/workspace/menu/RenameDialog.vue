<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'
import { ai_available, ai_base_check, ai_settings, vision_support } from '@/store/ai'
import { ensure_ai_consent } from '@/store/aiConsent'
import { explain_chat_error } from '@/services/ai/client'
import { is_abort_error } from '@/services/ai/errors'
import { name_target_kind } from '@/services/ai/naming'
import { ask_name, collect_name_target, NameSkipped } from '@/services/ai/suggestName'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import AiReachBadge from '@/ui/ai/AiReachBadge.vue'

const { initial_name, entry_type } = defineProps<{
	initial_name: string
	/** set for workspace files and folders: enables the AI name suggestion */
	entry_type?: 'file' | 'folder'
}>()

const emit = defineEmits<{
	confirm: [payload: { id: string; name: string }]
}>()

const workspace = useWorkspace()

const is_open = ref(false)
const name_input = ref<{ inputRef: HTMLInputElement | null } | null>(null)
const draft_name = ref('')
const opened_name = ref('')
const target_id = ref('')
const confirm_label = ref('Rename')

const suggesting = ref(false)
const suggestion = ref<string | null>(null)
const suggest_error = ref<string | null>(null)
let suggest_controller: AbortController | null = null

const target_kind = computed(() =>
	entry_type ? name_target_kind({ name: opened_name.value, type: entry_type }) : null)
const can_suggest = computed(() => target_kind.value !== null && ai_available(workspace.value))

function stop_suggesting() {
	suggest_controller?.abort()
	suggest_controller = null
	suggesting.value = false
}

function reset_suggestion() {
	stop_suggesting()
	suggestion.value = null
	suggest_error.value = null
}

async function focus_input(select: boolean) {
	await nextTick()
	const input = name_input.value?.inputRef
	input?.focus()
	if (select) input?.select()
}

async function open(name = initial_name, id = '', label = 'Rename') {
	reset_suggestion()
	opened_name.value = name
	draft_name.value = name
	target_id.value = id
	confirm_label.value = label
	is_open.value = true
	await focus_input(true)
}

async function suggest() {
	const ws = workspace.value
	if (!ws || !entry_type || !target_kind.value) return
	reset_suggestion()
	const { base_url, model } = ai_settings.value
	const is_image = target_kind.value === 'image'
	if (is_image && vision_support(base_url, model) === false) {
		suggest_error.value = `The model “${model}” doesn't accept images. Pick a vision model in Settings → AI.`
		return
	}
	const controller = new AbortController()
	suggest_controller = controller
	suggesting.value = true
	try {
		const entry = { id: target_id.value, name: opened_name.value, type: entry_type }
		const target = await collect_name_target(ws, entry)
		if (suggest_controller !== controller) return
		if (!(await ensure_ai_consent(ws, { sends_images: is_image }))) {
			if (suggest_controller === controller) stop_suggesting()
			return
		}
		const name = await ask_name(target, entry, { signal: controller.signal })
		if (suggest_controller === controller) suggestion.value = name
	} catch (error) {
		if (suggest_controller !== controller || is_abort_error(error)) return
		const message = error instanceof NameSkipped ? error.message : await explain_chat_error(error)
		if (suggest_controller === controller) suggest_error.value = message
	} finally {
		if (suggest_controller === controller) {
			suggest_controller = null
			suggesting.value = false
		}
	}
}

async function use_suggestion() {
	if (!suggestion.value) return
	draft_name.value = suggestion.value
	await focus_input(false)
}

function commit() {
	const name = draft_name.value.trim()
	const id = target_id.value
	is_open.value = false
	reset_suggestion()
	if (id && name && name !== opened_name.value) {
		emit('confirm', { id, name })
	}
}

function cancel() {
	is_open.value = false
	reset_suggestion()
	draft_name.value = opened_name.value
}

function on_open_change(open: boolean) {
	if (!open) {
		reset_suggestion()
		draft_name.value = opened_name.value
	}
}

defineExpose({ open })
</script>

<template>
	<UModal
		v-model:open="is_open"
		title="New name"
		:ui="{ footer: 'justify-end' }"
		@update:open="on_open_change"
	>
		<template #body>
			<form class="flex flex-col gap-2" @submit.prevent="commit">
				<div class="flex items-center gap-2">
					<UInput
						ref="name_input"
						v-model="draft_name"
						autocomplete="off"
						class="min-w-0 flex-1"
					/>
					<template v-if="can_suggest">
						<UButton
							v-if="suggesting"
							label="Stop"
							icon="i-lucide:square"
							color="neutral"
							variant="outline"
							@click="stop_suggesting"
						/>
						<UButton
							v-else
							label="Suggest"
							icon="i-lucide:sparkles"
							color="neutral"
							variant="outline"
							@click="suggest"
						/>
					</template>
				</div>

				<div v-if="suggesting" class="flex items-center gap-2 text-xs text-muted">
					<UIcon name="i-lucide:loader-circle" class="size-3.5 animate-spin" />
					<span>Asking {{ ai_settings.model }}…</span>
					<AiReachBadge v-if="ai_base_check.ok" :reach="ai_base_check.reach" />
				</div>
				<div v-else-if="suggestion" class="flex items-center gap-2 text-xs">
					<span class="text-muted">Suggested:</span>
					<UButton
						:label="suggestion"
						size="xs"
						color="primary"
						variant="soft"
						class="min-w-0 truncate"
						@click="use_suggestion"
					/>
				</div>
				<p v-else-if="suggest_error" class="text-xs leading-relaxed text-error">
					{{ suggest_error }}
				</p>
			</form>
		</template>

		<template #footer>
			<UButton label="Cancel" color="neutral" variant="outline" @click="cancel" />
			<UButton :label="confirm_label" @click="commit" />
		</template>
	</UModal>
</template>
