<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { ai_base_check, ai_settings, vision_support } from '@/store/ai'
import { model_label } from '@/services/ai/presets'
import { ensure_ai_consent } from '@/store/aiConsent'
import { close_summary, summary_request } from '@/store/aiSummary'
import { record_action } from '@/store/history'
import { count_items, t } from '@/i18n'
import { ai_chat, explain_chat_error } from '@/services/ai/client'
import { is_abort_error } from '@/services/ai/errors'
import {
	add_summary_note,
	build_summary_messages,
	collect_summary_sources,
	coverage_line,
} from '@/services/ai/summarize'
import { strip_think, untrusted_markdown } from '@/services/ai/text'
import { parseNoteMarkdown } from '@/ui/workspace/folder-container/widgets/markdown'
import { loadedNoteRenderer, loadNoteRenderer } from '@/ui/workspace/folder-container/widgets/noteRenderer'
import Button from '@/ui/kit/Button.vue'
import Modal from '@/ui/kit/Modal.vue'
import AiReachBadge from './AiReachBadge.vue'
import './aiDialog.css'

type Phase = 'reading' | 'writing' | 'review' | 'saving' | 'failed'

const toast = useToast()

const phase = ref<Phase>('reading')
const read = ref(0)
const raw = ref('')
const coverage = ref<string | null>(null)
const truncated = ref(false)
const stopped = ref(false)
const error = ref<string | null>(null)
let controller: AbortController | null = null

const summary = computed(() => untrusted_markdown(strip_think(raw.value)))
// The summary becomes a note: shown the way the note will show, the old
// way until the note renderer's chunk is there.
const note_render = shallowRef(loadedNoteRenderer())
void loadNoteRenderer().then((render) => {
	note_render.value = render
})
const summary_html = computed(() => (note_render.value ?? parseNoteMarkdown)(summary.value))

async function start() {
	controller?.abort()
	const ws = summary_request.workspace
	if (!ws) return
	const own = new AbortController()
	controller = own
	const is_current = () => controller === own
	phase.value = 'reading'
	read.value = 0
	raw.value = ''
	coverage.value = null
	truncated.value = false
	stopped.value = false
	error.value = null

	try {
		const { base_url, model } = ai_settings.value
		const sources = await collect_summary_sources(ws, summary_request.entries, {
			images_refused: vision_support(base_url, model) === false,
			signal: own.signal,
			on_progress: (done) => {
				if (is_current()) read.value = done
			},
		})
		if (!is_current()) return
		if (own.signal.aborted) {
			error.value = t('summary.stopped')
			phase.value = 'failed'
			return
		}
		coverage.value = coverage_line(sources)
		if (!(await ensure_ai_consent(ws, { sends_images: sources.images.length > 0 }))) {
			if (is_current()) close_summary()
			return
		}
		if (!is_current()) return
		if (own.signal.aborted) {
			error.value = t('summary.stopped')
			phase.value = 'failed'
			return
		}

		phase.value = 'writing'
		const result = await ai_chat(build_summary_messages(sources, summary_request.board_name), {
			signal: own.signal,
			on_delta: (text) => {
				if (is_current()) raw.value += text
			},
		})
		if (!is_current()) return
		raw.value = result.text
		truncated.value = result.truncated
		if (!summary.value) {
			error.value = t('summary.empty')
			phase.value = 'failed'
			return
		}
		phase.value = 'review'
	} catch (failure) {
		if (!is_current()) return
		if (is_abort_error(failure)) {
			if (summary.value) {
				stopped.value = true
				phase.value = 'review'
			} else {
				error.value = t('summary.stopped')
				phase.value = 'failed'
			}
			return
		}
		error.value = await explain_chat_error(failure)
		phase.value = 'failed'
	} finally {
		if (is_current()) controller = null
	}
}

function stop() {
	controller?.abort()
}

async function accept() {
	const ws = summary_request.workspace
	const text = summary.value
	if (!ws || !text) return
	phase.value = 'saving'
	const folder_id = summary_request.folder_id
	try {
		// Made, filled and named: one undo, which takes the note away for good while untouched
		await record_action(ws, { folder_id }, t('undo.summary'), tx => add_summary_note(ws, folder_id, text, summary_request.position, tx), {
			notice: t('undo.summary_added'),
		})
		// The history's toast says it, with "Undo"; a store without history says it here
		if (!ws.history_ref) toast.add({ title: t('undo.summary_added'), color: 'success' })
		close_summary()
	} catch (failure) {
		error.value = failure instanceof Error ? failure.message : String(failure)
		phase.value = 'review'
	}
}

function on_open_change(open: boolean) {
	if (!open) {
		stop()
		close_summary()
	}
}

watch(() => summary_request.run, () => {
	if (summary_request.open) void start()
})
</script>

<template>
	<Modal
		:open="summary_request.open"
		:title="t('summary.title', { name: summary_request.board_name })"
		:description="t('summary.description', { items: count_items(summary_request.entries.length), model: model_label(ai_settings.model) })"
		:width="640"
		@update:open="on_open_change"
	>
		<div class="aid">
			<div class="aid-status">
				<AiReachBadge v-if="ai_base_check.ok" :reach="ai_base_check.reach" />
				<span v-if="phase === 'reading'">{{ t('summary.reading', { done: read, total: summary_request.entries.length }) }}</span>
				<span v-else-if="phase === 'writing' && !summary">{{ t('summary.asking', { model: model_label(ai_settings.model) }) }}</span>
				<span v-if="coverage">{{ coverage }}</span>
			</div>

			<div v-if="summary" class="aid-preview note-preview prose prose-sm prose-gray max-w-none" v-html="summary_html" />

			<p v-if="truncated" class="aid-warn">{{ t('summary.truncated') }}</p>
			<p v-else-if="stopped" class="aid-warn">{{ t('summary.stopped_early') }}</p>
			<p v-if="error" class="aid-error">{{ error }}</p>
		</div>

		<template #aside>
			<template v-if="phase === 'review'">{{ t('summary.footer') }}</template>
		</template>
		<template #footer>
			<Button v-if="phase === 'reading' || phase === 'writing'" icon="tabler:player-stop" @click="stop">{{ t('summary.stop') }}</Button>
			<template v-else>
				<Button @click="on_open_change(false)">{{ t('summary.discard') }}</Button>
				<Button v-if="phase === 'review' || phase === 'saving'" variant="primary" :loading="phase === 'saving'" @click="accept">{{ t('summary.add') }}</Button>
			</template>
		</template>
	</Modal>
</template>
