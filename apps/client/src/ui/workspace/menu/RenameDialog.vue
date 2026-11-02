<script setup lang="ts">
import { computed, ref, nextTick, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { ai_available, ai_base_check, ai_settings, vision_support } from '@/store/ai'
import { model_label } from '@/services/ai/presets'
import { ensure_ai_consent } from '@/store/aiConsent'
import { explain_chat_error } from '@/services/ai/client'
import { is_abort_error } from '@/services/ai/errors'
import { name_target_kind } from '@/services/ai/naming'
import { ask_name, collect_name_target, NameSkipped } from '@/services/ai/suggestName'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import AiReachBadge from '@/ui/ai/AiReachBadge.vue'
import Button from '@/ui/kit/Button.vue'
import Modal from '@/ui/kit/Modal.vue'
import TextField from '@/ui/kit/TextField.vue'
import { t } from '@/i18n'

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
const name_input = ref<InstanceType<typeof TextField> | null>(null)
const draft_name = ref('')
const opened_name = ref('')
const target_id = ref('')
const confirm_key = ref('board_menu.rename')

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
	name_input.value?.focus(select)
	// The dialog's field is portaled in on open, one tick after the flag
	if (select && document.activeElement?.tagName !== 'INPUT') {
		await nextTick()
		name_input.value?.focus(select)
	}
}

async function open(name = initial_name, id = '', confirm = 'board_menu.rename') {
	reset_suggestion()
	opened_name.value = name
	draft_name.value = name
	target_id.value = id
	confirm_key.value = confirm
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
		suggest_error.value = t('rename_dialog.no_vision', { model })
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
		if (suggest_controller !== controller) return
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

watch(is_open, open => {
	if (open) return
	reset_suggestion()
	draft_name.value = opened_name.value
})

defineExpose({ open })
</script>

<template>
	<Modal v-model:open="is_open" :title="t('rename_dialog.title')">
		<form class="form" @submit.prevent="commit">
			<div class="row">
				<TextField ref="name_input" v-model="draft_name" autocomplete="off" class="field" />
				<template v-if="can_suggest">
					<Button v-if="suggesting" icon="tabler:player-stop" @click="stop_suggesting">
						{{ t('rename_dialog.stop') }}
					</Button>
					<Button v-else icon="tabler:sparkles" @click="suggest">
						{{ t('rename_dialog.suggest') }}
					</Button>
				</template>
			</div>

			<div v-if="suggesting" class="status">
				<Icon icon="tabler:loader-2" class="spin" />
				<span>{{ t('rename_dialog.asking', { model: model_label(ai_settings.model) }) }}</span>
				<AiReachBadge v-if="ai_base_check.ok" :reach="ai_base_check.reach" />
			</div>
			<div v-else-if="suggestion" class="status">
				<span>{{ t('rename_dialog.suggested') }}</span>
				<button type="button" class="chip" @click="use_suggestion">{{ suggestion }}</button>
			</div>
			<p v-else-if="suggest_error" class="err">{{ suggest_error }}</p>
		</form>
		<template #footer>
			<Button @click="cancel">{{ t('dialog.cancel') }}</Button>
			<Button variant="primary" @click="commit">{{ t(confirm_key) }}</Button>
		</template>
	</Modal>
</template>

<style scoped>
.form {
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.row {
	display: flex;
	align-items: center;
	gap: 8px;
}
.field {
	flex: 1;
	min-width: 0;
}
.status {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
	font-size: 12px;
	color: var(--text-secondary);
}
.chip {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	border: none;
	border-radius: 7px;
	padding: 2px 8px;
	background: var(--bg-accent);
	color: var(--text-accent);
	font: inherit;
	font-size: 12px;
	cursor: pointer;
}
.err {
	margin: 0;
	font-size: 12px;
	line-height: 1.5;
	color: var(--text-danger);
}
.spin {
	animation: spin 1s linear infinite;
}
@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}
.explorer.lg .status,
.explorer.lg .chip,
.explorer.lg .err {
	font-size: 13px;
}
</style>
