<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ai_base_check, ai_settings, vision_support } from '@/store/ai'
import { ensure_ai_consent } from '@/store/aiConsent'
import { close_summary, summary_request } from '@/store/aiSummary'
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
import AiReachBadge from './AiReachBadge.vue'

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
const summary_html = computed(() => parseNoteMarkdown(summary.value))

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
			error.value = 'Stopped.'
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
			error.value = 'Stopped.'
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
			error.value = 'The model returned no summary.'
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
				error.value = 'Stopped.'
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
	try {
		await add_summary_note(ws, summary_request.folder_id, text, summary_request.position)
		toast.add({ title: 'Summary added to the board', color: 'success' })
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
	<UModal
		:open="summary_request.open"
		:title="`Summarize “${summary_request.board_name}”`"
		:description="`${summary_request.entries.length} ${summary_request.entries.length === 1 ? 'item' : 'items'} · ${ai_settings.model}`"
		:ui="{ content: 'max-w-2xl', footer: 'justify-between' }"
		@update:open="on_open_change"
	>
		<template #body>
			<div class="flex flex-col gap-3">
				<div class="flex flex-wrap items-center gap-2 text-xs text-muted">
					<AiReachBadge v-if="ai_base_check.ok" :reach="ai_base_check.reach" />
					<span v-if="phase === 'reading'">Reading {{ read }} of {{ summary_request.entries.length }}…</span>
					<span v-else-if="phase === 'writing' && !summary">Asking {{ ai_settings.model }}…</span>
					<span v-if="coverage">{{ coverage }}</span>
				</div>

				<div
					v-if="summary"
					class="note-preview prose prose-sm prose-gray max-h-[50vh] max-w-none overflow-y-auto rounded-md border border-default p-3"
					v-html="summary_html"
				/>

				<p v-if="truncated" class="text-xs text-warning">
					The answer was cut off by the model's length limit.
				</p>
				<p v-else-if="stopped" class="text-xs text-warning">
					Stopped before the end: the summary may be incomplete.
				</p>
				<p v-if="error" class="text-sm text-error">{{ error }}</p>
			</div>
		</template>

		<template #footer>
			<span class="text-xs text-muted">
				<template v-if="phase === 'review'">Adds a note next to what you summarized.</template>
			</span>
			<div class="flex gap-2">
				<UButton
					v-if="phase === 'reading' || phase === 'writing'"
					label="Stop"
					icon="i-lucide:square"
					color="neutral"
					variant="outline"
					@click="stop"
				/>
				<template v-else>
					<UButton label="Discard" color="neutral" variant="outline" @click="on_open_change(false)" />
					<UButton
						v-if="phase === 'review' || phase === 'saving'"
						label="Add to board"
						:loading="phase === 'saving'"
						@click="accept"
					/>
				</template>
			</div>
		</template>
	</UModal>
</template>
