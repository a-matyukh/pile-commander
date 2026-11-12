<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { count_items, t } from '@/i18n'
import { ai_chat, explain_chat_error } from '@/services/ai/client'
import { is_abort_error } from '@/services/ai/errors'
import { sanitize_suggested_name } from '@/services/ai/naming'
import { model_label } from '@/services/ai/presets'
import { build_sort_messages, parse_sort_plan } from '@/services/ai/sort'
import { apply_sort_plan, type SortGroupPlan } from '@/services/ai/sortApply'
import { collect_summary_sources, coverage_line } from '@/services/ai/summarize'
import { signal_agent_proposal } from '@/services/mcp/attention'
import { basename_of } from '@/services/mcp/path'
import { close_proposal } from '@/services/mcp/proposal'
import { confirm_move, type MoveDecision } from '@/services/mcp/propose_move'
import type { MoveRowResult } from '@/services/mcp/types'
import { ai_base_check, ai_settings, vision_support } from '@/store/ai'
import { ensure_ai_consent } from '@/store/aiConsent'
import { close_sort, sort_session, type SortGroup } from '@/store/aiSort'
import { record_action } from '@/store/history'
import AiReachBadge from './AiReachBadge.vue'

/**
 * Sorting before anything moves: folders, new or already there, each with
 * the items going into it, checked. A new folder's name can be changed.
 * "Sort" moves the checked items as one undo; closing moves nothing. The
 * plan is an agent's (over MCP), or the app's own model writes it.
 */

type Phase = 'reading' | 'asking' | 'review' | 'applying' | 'done'

const toast = useToast()
const phase = ref<Phase>('review')
const notice = ref<string | null>(null)
const error = ref<string | null>(null)
const read = ref(0)
const coverage = ref<string | null>(null)
let controller: AbortController | null = null
let next_key = 0

const groups = computed(() => sort_session.groups)
const from_model = computed(() => sort_session.source === 'model')
const busy = computed(() => phase.value === 'reading' || phase.value === 'asking')
const to_move = computed(() => groups.value.reduce((sum, group) => sum + group.rows.filter(row => row.checked && row.status === 'ready').length, 0))
/** The model's plan leaves some items where they are */
const left = computed(() => {
	if (!from_model.value || busy.value) return 0
	const placed = new Set(groups.value.flatMap(group => group.rows.filter(row => row.checked).map(row => row.id)))
	const targets = new Set(groups.value.map(group => group.existing_id))
	return sort_session.entries.filter(entry => !placed.has(entry.id) && !targets.has(entry.id)).length
})
const dialog_title = computed(() => from_model.value
	? t('ai_sort.title', { name: sort_session.board_name })
	: (sort_session.client_name || t('ai_sort.agent')))
const dialog_description = computed(() => from_model.value ? model_label(ai_settings.value.model) : sort_session.reason)

function group_checked(group: SortGroup): boolean | 'indeterminate' {
	const ready = group.rows.filter(row => row.status === 'ready')
	const checked = ready.filter(row => row.checked).length
	if (!checked) return false
	return checked === ready.length ? true : 'indeterminate'
}

function set_group(group: SortGroup, value: boolean | 'indeterminate') {
	for (const row of group.rows) {
		if (row.status === 'ready') row.checked = value === true
	}
}

/** A new folder's name as typed, made safe; the proposed name when nothing usable is left. */
function folder_name(group: SortGroup): string {
	if (group.existing_id) return group.to
	return sanitize_suggested_name(group.name, group.name, 'folder') ?? group.to
}

async function start() {
	controller?.abort()
	controller = null
	notice.value = null
	error.value = null
	coverage.value = null
	if (from_model.value) {
		void ask_model()
	} else {
		phase.value = 'review'
		const n = groups.value.reduce((sum, group) => sum + group.rows.length, 0)
		signal_agent_proposal(sort_session.proposal_id, dialog_title.value, t('ai_sort.notify', { n, folder: basename_of(sort_session.folder_id) }))
	}
	await sort_session.workspace?.ensure_preview_folder(sort_session.folder_id)
}

/** Asks the model for a plan: the first time, and again on "Try again". */
async function ask_model() {
	const ws = sort_session.workspace
	if (!ws) return
	controller?.abort()
	const own = new AbortController()
	controller = own
	const is_current = () => controller === own
	notice.value = null
	error.value = null
	read.value = 0
	phase.value = 'reading'
	try {
		const { base_url, model } = ai_settings.value
		const sources = await collect_summary_sources(ws, sort_session.entries, {
			images_refused: vision_support(base_url, model) === false,
			signal: own.signal,
			on_progress: (done) => {
				if (is_current()) read.value = done
			},
		})
		if (!is_current()) return
		if (own.signal.aborted) {
			phase.value = 'review'
			return
		}
		coverage.value = coverage_line(sources)
		if (!(await ensure_ai_consent(ws, { sends_images: sources.images.length > 0 }))) {
			if (!is_current()) return
			notice.value = t('ai_sort.nothing_sent')
			phase.value = 'review'
			return
		}
		if (!is_current() || own.signal.aborted) return
		phase.value = 'asking'
		const result = await ai_chat(build_sort_messages(sources, sort_session.board_name), { signal: own.signal })
		if (!is_current()) return
		const plan = parse_sort_plan(result.text, sort_session.entries, ai_settings.value.name_style)
		const by_id = new Map(sort_session.entries.map(entry => [entry.id, entry]))
		sort_session.groups = plan.map(group => ({
			key: `sort-${next_key++}`,
			to: group.name,
			name: group.name,
			existing_id: group.existing_id,
			rows: group.entry_ids.map((id) => {
				const entry = by_id.get(id)!
				return { id, name: entry.name, type: entry.type, checked: true, status: 'ready' as const, error: null }
			}),
		}))
		if (!plan.length) error.value = t('ai_sort.none')
		phase.value = 'review'
	} catch (failure) {
		if (!is_current()) return
		if (!is_abort_error(failure)) error.value = await explain_chat_error(failure)
		phase.value = 'review'
	} finally {
		if (is_current()) controller = null
	}
}

function stop() {
	controller?.abort()
}

function sorted_text(moved: number): { label?: string; notice?: string } {
	if (!moved) return {}
	const count = count_items(moved)
	return { label: t('undo.sort', { count }), notice: t('undo.sorted', { count }) }
}

async function apply() {
	const ws = sort_session.workspace
	if (!ws || !to_move.value || busy.value) return
	const folder_id = sort_session.folder_id
	const proposal_id = sort_session.proposal_id
	const run = sort_session.run
	phase.value = 'applying'
	notice.value = null
	await ws.ensure_preview_folder(folder_id)
	const decisions: MoveDecision[] = groups.value.map(group => ({
		to: group.to,
		name: folder_name(group),
		entry_ids: group.rows.filter(row => row.checked && row.status === 'ready').map(row => row.id),
	}))
	const existing = new Map(groups.value.map(group => [group.to, group.existing_id]))
	const plan_of = (kept: readonly MoveDecision[]): SortGroupPlan[] => kept.map(decision => ({
		name: decision.name,
		existing_id: existing.get(decision.to) ?? null,
		entry_ids: decision.entry_ids,
	}))
	const label = t('undo.sort', { count: count_items(to_move.value) })
	// The rows follow the groups and their items, in order
	const rows = groups.value.flatMap(group => group.rows)
	let outcomes: (Pick<MoveRowResult, 'outcome' | 'error'> | null)[]
	if (from_model.value) {
		// The moves the person kept are one undo
		const kept = decisions.filter(decision => decision.entry_ids.length > 0)
		const written = await record_action(ws, { folder_id }, label, tx => apply_sort_plan(ws, folder_id, plan_of(kept), tx), {
			describe: done => sorted_text([...done.moved.values()].filter(moved => 'id' in moved).length),
		})
		outcomes = rows.map((row) => {
			const moved = written.moved.get(row.id)
			if (!moved) return null
			return 'id' in moved ? { outcome: 'moved' } : { outcome: 'failed', error: moved.error }
		})
	} else {
		// What the agent proposed and the person kept is one undo
		outcomes = await record_action(ws, { folder_id }, label, tx => confirm_move(
			proposal_id,
			decisions,
			async (kept) => {
				const written = await apply_sort_plan(ws, folder_id, plan_of(kept), tx)
				return { folders: written.folders.map(folder => ('id' in folder ? folder : { error: folder.error || 'No folder' })), moved: written.moved }
			},
		), { describe: done => sorted_text(done.filter(row => row.outcome === 'moved').length) })
	}
	if (sort_session.run !== run) return
	let failed = 0
	outcomes.forEach((result, index) => {
		const row = rows[index]
		if (!row || !result) return
		if (result.outcome === 'moved') {
			row.status = 'moved'
			row.checked = false
		} else if (result.outcome === 'failed') {
			row.status = 'failed'
			row.error = result.error ?? null
			row.checked = false
			failed++
		}
	})
	const moved = outcomes.filter(result => result?.outcome === 'moved').length
	if (moved && !ws.history_ref) toast.add({ title: t('undo.sorted', { count: count_items(moved) }), color: 'success' })
	if (failed) {
		notice.value = t('ai_sort.not_moved', { n: failed })
		phase.value = 'done'
		return
	}
	if (!from_model.value) close_proposal(proposal_id)
	close_sort()
}

function on_open_change(open: boolean) {
	if (open) return
	stop()
	if (!from_model.value) close_proposal(sort_session.proposal_id)
	close_sort()
}

watch(() => sort_session.run, () => {
	if (sort_session.open) void start()
})
</script>

<template>
	<UModal
		:open="sort_session.open"
		:title="dialog_title"
		:description="dialog_description"
		:ui="{ content: 'max-w-2xl', footer: 'justify-between' }"
		@update:open="on_open_change"
	>
		<template #body>
			<div class="flex flex-col gap-3">
				<div v-if="from_model" class="flex flex-wrap items-center gap-2 text-xs text-muted">
					<AiReachBadge v-if="ai_base_check.ok" :reach="ai_base_check.reach" />
					<span v-if="phase === 'reading'">{{ t('ai_sort.reading', { done: read, total: sort_session.entries.length }) }}</span>
					<span v-else-if="phase === 'asking'" class="flex items-center gap-1.5">
						<UIcon name="i-lucide:loader-circle" class="size-3.5 animate-spin" />
						{{ t('ai_sort.asking', { model: model_label(ai_settings.model) }) }}
					</span>
					<span v-if="coverage">{{ coverage }}</span>
				</div>
				<p v-if="phase === 'review' && groups.length" class="text-xs text-muted">{{ t('ai_sort.hint') }}</p>
				<p v-if="error" class="text-sm text-error">{{ error }}</p>
				<p v-if="notice" class="text-sm text-warning">{{ notice }}</p>

				<ul class="flex max-h-[55vh] flex-col gap-2 overflow-y-auto">
					<li v-for="group in groups" :key="group.key" class="rounded-md border border-default">
						<div class="flex items-center gap-2 border-b border-default bg-elevated/50 px-2.5 py-1.5">
							<UCheckbox
								:model-value="group_checked(group)"
								:disabled="phase !== 'review'"
								:aria-label="t('ai_sort.check_group', { name: folder_name(group) })"
								@update:model-value="set_group(group, $event)"
							/>
							<UIcon name="i-lucide:folder" class="size-4 shrink-0 text-muted" />
							<UInput
								v-if="!group.existing_id"
								v-model="group.name"
								size="sm"
								variant="none"
								class="min-w-0 flex-1 font-medium"
								:aria-label="t('ai_sort.folder_name')"
								:disabled="phase !== 'review'"
							/>
							<span v-else class="min-w-0 flex-1 truncate px-2.5 text-sm font-medium">{{ group.to }}</span>
							<UBadge
								size="sm"
								:color="group.existing_id ? 'neutral' : 'primary'"
								variant="subtle"
								:label="group.existing_id ? t('ai_sort.existing') : t('ai_sort.new_folder')"
							/>
						</div>
						<ul class="flex flex-col divide-y divide-default">
							<li v-for="row in group.rows" :key="row.id" class="flex items-center gap-2 px-2.5 py-1.5 pl-8 text-sm">
								<UCheckbox
									v-model="row.checked"
									:disabled="row.status !== 'ready' || phase !== 'review'"
									:aria-label="t('ai_sort.check', { name: row.name })"
								/>
								<UIcon :name="row.type === 'folder' ? 'i-lucide:folder' : 'i-lucide:file'" class="size-3.5 shrink-0 text-dimmed" />
								<span class="min-w-0 flex-1 truncate" :class="row.checked || row.status !== 'ready' ? 'text-default' : 'text-dimmed'" :title="row.name">{{ row.name }}</span>
								<UIcon v-if="row.status === 'moved'" name="i-lucide:check" class="size-3.5 shrink-0 text-success" />
								<span v-else-if="row.status === 'failed'" class="truncate text-xs text-error" :title="row.error ?? ''">{{ row.error }}</span>
							</li>
						</ul>
					</li>
				</ul>
			</div>
		</template>

		<template #footer>
			<span class="text-xs text-muted">
				<template v-if="phase === 'review' && groups.length">
					{{ t('ai_sort.to_move', { n: to_move }) }}<template v-if="left"> · {{ t('ai_sort.left', { n: left }) }}</template>
				</template>
			</span>
			<div class="flex gap-2">
				<UButton
					v-if="busy"
					:label="t('ai_sort.stop')"
					icon="i-lucide:square"
					color="neutral"
					variant="outline"
					@click="stop"
				/>
				<template v-else-if="phase === 'review'">
					<UButton
						v-if="from_model"
						:label="t('ai_sort.again')"
						icon="i-lucide:sparkles"
						color="neutral"
						variant="outline"
						@click="ask_model"
					/>
					<UButton :label="t('ai_sort.cancel')" color="neutral" variant="outline" @click="on_open_change(false)" />
					<UButton :label="t('ai_sort.apply', { n: to_move })" :disabled="!to_move" @click="apply" />
				</template>
				<UButton v-else-if="phase === 'applying'" :label="t('ai_sort.applying')" loading disabled />
				<UButton v-else :label="t('ai_sort.close')" color="neutral" variant="outline" @click="on_open_change(false)" />
			</div>
		</template>
	</UModal>
</template>
