<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import type { WorkspaceStore } from '@/domain/Store'
import type { Position } from '@/domain/Widget'
import { count_notes, t } from '@/i18n'
import { ai_chat, explain_chat_error } from '@/services/ai/client'
import { is_abort_error } from '@/services/ai/errors'
import { build_idea_messages, idea_note, parse_ideas, type Idea } from '@/services/ai/ideas'
import { add_new_notes, new_note_positions, planned_note_names, type NewNoteOutcome } from '@/services/ai/newNotes'
import { model_label } from '@/services/ai/presets'
import { collect_summary_sources, coverage_line } from '@/services/ai/summarize'
import { strip_think, untrusted_markdown } from '@/services/ai/text'
import { signal_agent_proposal } from '@/services/mcp/attention'
import { basename_of } from '@/services/mcp/path'
import { close_proposal } from '@/services/mcp/proposal'
import { confirm_create } from '@/services/mcp/propose_create'
import type { CreateRowResult } from '@/services/mcp/types'
import { to_folder_container } from '@/services/workspace/folderContainer'
import { ai_base_check, ai_settings, vision_support } from '@/store/ai'
import { ensure_ai_consent } from '@/store/aiConsent'
import { close_ideas, ideas_session, type IdeaRow } from '@/store/aiIdeas'
import { record_action } from '@/store/history'
import { parseNoteMarkdown } from '@/ui/workspace/folder-container/widgets/markdown'
import { loadedNoteRenderer, loadNoteRenderer } from '@/ui/workspace/folder-container/widgets/noteRenderer'
import AiReachBadge from './AiReachBadge.vue'

/**
 * New notes before anything is written: an agent's (over MCP), or ideas the
 * app's own model writes for the board. Each shows the way the note will
 * look, checked, under the name it will get. "Add" writes the checked ones
 * as one undo; closing writes nothing.
 */

/** `ask`: the model's wish field, nothing asked yet. */
type Phase = 'ask' | 'reading' | 'writing' | 'review' | 'applying' | 'done'

const toast = useToast()

const phase = ref<Phase>('review')
const notice = ref<string | null>(null)
const error = ref<string | null>(null)
const prompt = ref('')
const read = ref(0)
const coverage = ref<string | null>(null)
const truncated = ref(false)
let controller: AbortController | null = null
let next_key = 0

const workspace = computed(() => ideas_session.workspace)
const rows = computed(() => ideas_session.rows)
const from_model = computed(() => ideas_session.source === 'model')
const busy = computed(() => phase.value === 'reading' || phase.value === 'writing')

const note_render = shallowRef(loadedNoteRenderer())
void loadNoteRenderer().then((render) => {
	note_render.value = render
})

function note_html(text: string): string {
	return (note_render.value ?? parseNoteMarkdown)(untrusted_markdown(strip_think(text)))
}

function sibling_names(): string[] {
	return (workspace.value?.resolve_folder_data(ideas_session.folder_id)?.children ?? []).map(child => child.name)
}

/** What each note will be called: a taken name, or one repeated here, gets ` (1)`. */
const planned = computed(() => planned_note_names(rows.value.map(row => row.name), sibling_names()))
const to_add = computed(() => rows.value.filter(row => row.checked && row.status === 'ready'))

const dialog_title = computed(() => from_model.value
	? t('ideas.title', { name: ideas_session.board_name })
	: (ideas_session.client_name || t('ideas.agent')))
const dialog_description = computed(() => from_model.value
	? model_label(ai_settings.value.model)
	: ideas_session.reason)

function title_of(name: string): string {
	return name.replace(/\.md$/i, '')
}

/** Where the new notes go: from the anchor, right of what the folder holds, or wherever the folder puts them. */
function places(ws: WorkspaceStore, folder_id: string, count: number): (Position | null)[] {
	const folder = ws.resolve_folder_data(folder_id)
	const children = folder ? to_folder_container(folder, ws.preview_folders).children : []
	return new_note_positions(children, count, ideas_session.anchor)
}

const field = ref<{ inputRef?: HTMLInputElement } | null>(null)

async function start() {
	controller?.abort()
	controller = null
	notice.value = null
	error.value = null
	coverage.value = null
	truncated.value = false
	prompt.value = ''
	if (from_model.value) {
		phase.value = 'ask'
		await nextTick()
		field.value?.inputRef?.focus()
	} else {
		phase.value = 'review'
		signal_agent_proposal(
			ideas_session.proposal_id,
			dialog_title.value,
			t('ideas.notify', { folder: basename_of(ideas_session.folder_id), n: rows.value.length }),
		)
	}
	await workspace.value?.ensure_preview_folder(ideas_session.folder_id)
}

function row_of(idea: Idea, status: IdeaRow['status']): IdeaRow {
	const note = idea_note(idea, ai_settings.value.name_style)
	return {
		key: `idea-${next_key++}`,
		name: note.name,
		title: idea.title,
		text: note.text,
		checked: true,
		position: null,
		status,
		error: null,
	}
}

/** The answer so far as rows after `base`: whole ideas ready, the one being written last. */
function show_answer(base: number, answer: string, done: boolean) {
	const { ideas, writing } = parse_ideas(answer, done)
	const list = writing && writing.title ? [...ideas, writing] : ideas
	list.forEach((idea, index) => {
		const status = index < ideas.length ? 'ready' : 'writing'
		const row = rows.value[base + index]
		if (!row) {
			ideas_session.rows.push(row_of(idea, status))
			return
		}
		const note = idea_note(idea, ai_settings.value.name_style)
		row.title = idea.title
		row.name = note.name
		row.text = note.text
		row.status = status
	})
	ideas_session.rows.splice(base + list.length)
}

async function generate() {
	const ws = workspace.value
	if (!ws || busy.value) return
	controller?.abort()
	const own = new AbortController()
	controller = own
	const is_current = () => controller === own
	const base = rows.value.length
	const shown = rows.value.map(row => row.title)
	let answer = ''
	notice.value = null
	error.value = null
	truncated.value = false
	read.value = 0
	phase.value = 'reading'
	try {
		const { base_url, model } = ai_settings.value
		const sources = await collect_summary_sources(ws, ideas_session.entries, {
			images_refused: vision_support(base_url, model) === false,
			signal: own.signal,
			on_progress: (done) => {
				if (is_current()) read.value = done
			},
		})
		if (!is_current()) return
		if (own.signal.aborted) {
			phase.value = base ? 'review' : 'ask'
			return
		}
		coverage.value = coverage_line(sources)
		if (!(await ensure_ai_consent(ws, { sends_images: sources.images.length > 0 }))) {
			if (!is_current()) return
			notice.value = t('ideas.nothing_sent')
			phase.value = base ? 'review' : 'ask'
			return
		}
		if (!is_current() || own.signal.aborted) return
		phase.value = 'writing'
		const result = await ai_chat(build_idea_messages(sources, ideas_session.board_name, prompt.value, shown), {
			signal: own.signal,
			on_delta: (text) => {
				if (!is_current()) return
				answer += text
				show_answer(base, answer, false)
			},
		})
		if (!is_current()) return
		answer = result.text
		show_answer(base, answer, true)
		truncated.value = result.truncated
		if (rows.value.length === base) error.value = t('ideas.none')
		phase.value = rows.value.length ? 'review' : 'ask'
	} catch (failure) {
		if (!is_current()) return
		// What was whole stays; the idea still being written goes
		ideas_session.rows = rows.value.filter(row => row.status !== 'writing')
		if (is_abort_error(failure)) {
			if (rows.value.length > base) notice.value = t('ideas.stopped')
		} else {
			error.value = await explain_chat_error(failure)
		}
		phase.value = rows.value.length ? 'review' : 'ask'
	} finally {
		if (is_current()) controller = null
	}
}

function stop() {
	controller?.abort()
}

function added_text(created: number): { label?: string; notice?: string } {
	if (!created) return {}
	const count = count_notes(created)
	return { label: t('undo.notes', { count }), notice: t('undo.notes_added', { count }) }
}

/** Marks each row with what the write did; returns how many failed. */
function show_outcomes(outcomes: ({ outcome: 'created' | 'failed' | 'skipped' | 'pending'; error?: string } | null)[]): number {
	let failed = 0
	outcomes.forEach((result, index) => {
		const row = rows.value[index]
		if (!row || !result) return
		if (result.outcome === 'created') {
			row.status = 'created'
			row.checked = false
		} else if (result.outcome === 'failed') {
			row.status = 'failed'
			row.error = result.error ?? null
			row.checked = false
			failed++
		}
	})
	return failed
}

async function apply() {
	const ws = workspace.value
	if (!ws || !to_add.value.length || busy.value) return
	const folder_id = ideas_session.folder_id
	const proposal_id = ideas_session.proposal_id
	const run = ideas_session.run
	phase.value = 'applying'
	notice.value = null
	await ws.ensure_preview_folder(folder_id)
	const names = planned.value
	const checked = rows.value.map(row => row.checked && row.status === 'ready')
	const chosen = rows.value.flatMap((row, index) => (checked[index] ? [{ index, row }] : []))
	const label = t('undo.notes', { count: count_notes(chosen.length) })
	const write = (picked: readonly { index: number; text: string }[], tx: Parameters<typeof add_new_notes>[3]) => {
		const spots = places(ws, folder_id, picked.length)
		return add_new_notes(ws, folder_id, picked.map((item, at) => ({
			name: names[item.index] ?? rows.value[item.index]!.name,
			text: item.text,
			position: rows.value[item.index]?.position ?? spots[at] ?? null,
		})), tx)
	}
	let outcomes: ({ outcome: 'created' | 'failed' | 'skipped' | 'pending'; error?: string } | null)[]
	if (from_model.value) {
		// The ideas the person kept are one undo
		const written: NewNoteOutcome[] = await record_action(ws, { folder_id }, label, tx => write(
			chosen.map(({ index, row }) => ({ index, text: row.text })),
			tx,
		), { describe: done => added_text(done.filter(outcome => !outcome.error).length) })
		outcomes = rows.value.map(() => null)
		chosen.forEach(({ index }, at) => {
			const outcome = written[at]
			outcomes[index] = outcome?.error ? { outcome: 'failed', error: outcome.error } : { outcome: 'created' }
		})
	} else {
		// What the agent proposed and the person kept is one undo, as with names
		const results: CreateRowResult[] = await record_action(ws, { folder_id }, label, tx => confirm_create(
			proposal_id,
			checked,
			picked => write(picked, tx),
		), { describe: done => added_text(done.filter(row => row.outcome === 'created').length) })
		outcomes = results
	}
	if (ideas_session.run !== run) return
	const failed = show_outcomes(outcomes)
	const created = outcomes.filter(outcome => outcome?.outcome === 'created').length
	// The history's toast says it, with "Undo"; a store without history says it here
	if (created && !ws.history_ref) toast.add({ title: t('undo.notes_added', { count: count_notes(created) }), color: 'success' })
	if (failed) {
		notice.value = t('ideas.not_added', { n: failed })
		phase.value = 'done'
		return
	}
	if (!from_model.value) close_proposal(proposal_id)
	close_ideas()
}

function on_open_change(open: boolean) {
	if (open) return
	stop()
	if (!from_model.value) close_proposal(ideas_session.proposal_id)
	close_ideas()
}

watch(() => ideas_session.run, () => {
	if (ideas_session.open) void start()
})
</script>

<template>
	<UModal
		:open="ideas_session.open"
		:title="dialog_title"
		:description="dialog_description"
		:ui="{ content: 'max-w-2xl', footer: 'justify-between' }"
		@update:open="on_open_change"
	>
		<template #body>
			<div class="flex flex-col gap-3">
				<form v-if="from_model" class="flex gap-2" @submit.prevent="generate">
					<UInput
						ref="field"
						v-model="prompt"
						class="flex-1"
						:placeholder="t('ideas.prompt_placeholder')"
						:disabled="busy || phase === 'applying'"
						icon="i-lucide:sparkles"
					/>
					<UButton
						v-if="phase === 'ask'"
						type="submit"
						:label="t('ideas.generate')"
					/>
				</form>

				<div v-if="from_model" class="flex flex-wrap items-center gap-2 text-xs text-muted">
					<AiReachBadge v-if="ai_base_check.ok" :reach="ai_base_check.reach" />
					<span v-if="phase === 'reading'">{{ t('ideas.reading', { done: read, total: ideas_session.entries.length }) }}</span>
					<span v-else-if="phase === 'writing'">{{ t('ideas.asking', { model: model_label(ai_settings.model) }) }}</span>
					<span v-if="coverage">{{ coverage }}</span>
				</div>

				<p v-if="phase === 'review' && rows.length" class="text-xs text-muted">{{ t('ideas.hint') }}</p>
				<p v-if="error" class="text-sm text-error">{{ error }}</p>
				<p v-if="notice" class="text-sm text-warning">{{ notice }}</p>
				<p v-if="truncated" class="text-xs text-warning">{{ t('ideas.truncated') }}</p>

				<ul v-if="rows.length" class="flex max-h-[55vh] flex-col gap-2 overflow-y-auto">
					<li
						v-for="(row, index) in rows"
						:key="row.key"
						class="flex gap-2.5 rounded-md border border-default p-2.5"
						:class="{ 'opacity-60': (!row.checked && row.status === 'ready') || row.status === 'writing' }"
					>
						<UCheckbox
							v-model="row.checked"
							class="mt-0.5"
							:disabled="row.status !== 'ready' || phase !== 'review'"
							:aria-label="t('ideas.check', { name: title_of(planned[index] ?? row.name) })"
						/>
						<div class="min-w-0 flex-1">
							<p class="flex items-center gap-1.5 truncate text-sm font-medium" :title="planned[index] ?? row.name">
								<UIcon v-if="row.status === 'writing'" name="i-lucide:loader-circle" class="size-3.5 shrink-0 animate-spin text-muted" />
								{{ title_of(planned[index] ?? row.name) }}
							</p>
							<div
								class="note-preview prose prose-sm prose-gray mt-1 max-h-28 max-w-none overflow-hidden text-muted prose-headings:my-1 prose-headings:text-sm prose-headings:font-semibold prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0"
								v-html="note_html(row.text)"
							/>
							<p v-if="row.status === 'failed' && row.error" class="mt-1 text-xs text-error">{{ row.error }}</p>
						</div>
					</li>
				</ul>
			</div>
		</template>

		<template #footer>
			<span class="text-xs text-muted">
				<template v-if="phase === 'review'">{{ t('ideas.to_add', { n: to_add.length }) }}</template>
			</span>
			<div class="flex gap-2">
				<UButton
					v-if="busy"
					:label="t('ideas.stop')"
					icon="i-lucide:square"
					color="neutral"
					variant="outline"
					@click="stop"
				/>
				<template v-else-if="phase === 'ask'">
					<UButton :label="t('ideas.cancel')" color="neutral" variant="outline" @click="on_open_change(false)" />
				</template>
				<template v-else-if="phase === 'review'">
					<UButton
						v-if="from_model"
						:label="t('ideas.more')"
						icon="i-lucide:sparkles"
						color="neutral"
						variant="outline"
						@click="generate"
					/>
					<UButton :label="t('ideas.cancel')" color="neutral" variant="outline" @click="on_open_change(false)" />
					<UButton :label="t('ideas.add', { n: to_add.length })" :disabled="!to_add.length" @click="apply" />
				</template>
				<UButton v-else-if="phase === 'applying'" :label="t('ideas.adding')" loading disabled />
				<UButton v-else :label="t('ideas.close')" color="neutral" variant="outline" @click="on_open_change(false)" />
			</div>
		</template>
	</UModal>
</template>
