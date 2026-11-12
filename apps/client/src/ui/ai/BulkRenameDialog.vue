<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { count_items, t } from '@/i18n'
import { ai_base_check, ai_settings } from '@/store/ai'
import { model_label } from '@/services/ai/presets'
import { ensure_ai_consent } from '@/store/aiConsent'
import { bulk_rename_request, close_bulk_rename } from '@/store/aiBulkRename'
import { new_row, planned_names, rename_entry, type BulkRow } from '@/services/ai/bulkRename'
import { suggest_batch } from '@/services/ai/bulkSuggest'
import { signal_agent_proposal } from '@/services/mcp/attention'
import { basename_of } from '@/services/mcp/path'
import { close_proposal, confirm_proposal, proposal_decisions, ready_proposal_rows } from '@/services/mcp/propose'
import { record_action } from '@/store/history'
import Button from '@/ui/kit/Button.vue'
import Checkbox from '@/ui/kit/Checkbox.vue'
import Modal from '@/ui/kit/Modal.vue'
import AiReachBadge from './AiReachBadge.vue'
import './aiDialog.css'

type Phase = 'working' | 'review' | 'applying' | 'done'

const toast = useToast()

const rows = ref<BulkRow[]>([])
const phase = ref<Phase>('working')
const notice = ref<string | null>(null)
let controller: AbortController | null = null

const workspace = computed(() => bulk_rename_request.workspace)

function sibling_names(): string[] {
	const folder = workspace.value?.resolve_folder_data(bulk_rename_request.folder_id)
	return (folder?.children ?? []).map(child => child.name)
}

const is_proposal = computed(() => bulk_rename_request.source === 'proposal')
const dialog_title = computed(() => is_proposal.value
	? (bulk_rename_request.client_name || t('bulk_rename.agent'))
	: t('bulk_rename.title'))
const dialog_description = computed(() => is_proposal.value
	? bulk_rename_request.reason
	: t('bulk_rename.description', { items: count_items(rows.value.length), model: model_label(ai_settings.value.model) }))

const planned = computed(() => planned_names(rows.value, sibling_names()))
const to_rename = computed(() => rows.value.filter((row) => {
	const name = planned.value.get(row.entry.id)
	return name !== undefined && name !== row.entry.name
}))
const answered = computed(() => rows.value.filter(row => !['waiting', 'preparing', 'asking'].includes(row.status)).length)
/** rows read so far; null once everything is read and the model is being asked */
const prepared = ref<number | null>(0)

function signal_proposal() {
	const title = bulk_rename_request.client_name || t('bulk_rename.agent')
	const body = t('bulk_rename.notify', {
		n: bulk_rename_request.entries.length,
		folder: basename_of(bulk_rename_request.folder_id),
	})
	signal_agent_proposal(bulk_rename_request.proposal_id, title, body)
}

async function start() {
	controller?.abort()
	const ws = workspace.value
	if (!ws) return
	if (bulk_rename_request.source === 'proposal') {
		controller = null
		rows.value = ready_proposal_rows(bulk_rename_request.entries.map(entry => ({
			id: entry.id,
			name: entry.name,
			type: entry.type,
			to: bulk_rename_request.proposal_to[entry.id] ?? '',
		})))
		phase.value = 'review'
		notice.value = null
		prepared.value = null
		signal_proposal()
		await ws.ensure_preview_folder(bulk_rename_request.folder_id)
		return
	}
	const own = new AbortController()
	controller = own
	rows.value = bulk_rename_request.entries.map(new_row)
	phase.value = 'working'
	notice.value = null
	prepared.value = 0

	const outcome = await suggest_batch({
		workspace: ws,
		rows: rows.value,
		concurrency: ai_base_check.value.ok && ai_base_check.value.reach === 'cloud' ? 3 : 1,
		signal: own.signal,
		confirm: (sends_images) => {
			if (controller === own) prepared.value = null
			return ensure_ai_consent(ws, { sends_images })
		},
		on_prepared: (done) => {
			if (controller === own) prepared.value = done
		},
	})
	if (controller !== own) return
	controller = null
	if (!outcome.consented) notice.value = t('bulk_rename.nothing_sent')
	else if (outcome.stop_reason) notice.value = t('bulk_rename.stopped_because', { reason: outcome.stop_reason })
	phase.value = 'review'
}

function stop() {
	controller?.abort()
}

/** A renamed entry: its name before and after */
type Renamed = { from: string; to: string }

/** How the history names a batch once it is done, and its toast with "Undo" */
function renamed_text(renamed: Renamed[]): { label?: string; notice?: string } {
	if (renamed.length === 0) return {}
	if (renamed.length === 1) return { label: t('undo.rename', { name: renamed[0]!.from }), notice: t('undo.renamed', { name: renamed[0]!.to }) }
	const count = count_items(renamed.length)
	return { label: t('undo.rename_many', { count }), notice: t('undo.renamed_many', { count }) }
}

/**
 * What is left to say once a batch is done: the history's toast says how many
 * were renamed, with "Undo"; here only what it cannot (nothing renamed, or a
 * store without history)
 */
function report_batch(renamed: number, total: number) {
	if (renamed > 0 && workspace.value?.history_ref) return
	const failed = total - renamed
	toast.add({
		title: t('bulk_rename.renamed', { renamed, total }),
		description: failed ? t('bulk_rename.failed', { n: failed }) : undefined,
		color: failed ? 'warning' : 'success',
	})
}

async function apply() {
	if (bulk_rename_request.source === 'proposal') {
		await apply_proposal()
		return
	}
	const ws = workspace.value
	if (!ws) return
	const batch = to_rename.value.map(row => ({ row, name: planned.value.get(row.entry.id)! }))
	if (!batch.length) return
	phase.value = 'applying'
	const folder_id = bulk_rename_request.folder_id
	// The whole batch is one undo; a rename that failed is not in it
	const done = await record_action(ws, { folder_id }, t('undo.rename_many', { count: count_items(batch.length) }), async (tx) => {
		const renamed: Renamed[] = []
		for (const { row, name } of batch) {
			const error = await rename_entry(ws, folder_id, row.entry.id, name, tx)
			if (error) {
				row.status = 'rename_failed'
				row.reason = error
			} else {
				row.status = 'renamed'
				renamed.push({ from: row.entry.name, to: name })
			}
			row.checked = false
		}
		return renamed
	}, { describe: renamed_text })
	ws.exit_selection_mode()
	const renamed = done.length
	const failed = batch.length - renamed
	report_batch(renamed, batch.length)
	if (failed) {
		rows.value = rows.value.filter(row => row.status === 'rename_failed')
		notice.value = t('bulk_rename.not_renamed', { n: failed })
		phase.value = 'done'
	} else {
		close_bulk_rename()
	}
}

async function apply_proposal() {
	const ws = workspace.value
	if (!ws) return
	await ws.ensure_preview_folder(bulk_rename_request.folder_id)
	const decisions = proposal_decisions(rows.value, sibling_names())
	if (!decisions.some(decision => decision.checked)) return
	phase.value = 'applying'
	const folder_id = bulk_rename_request.folder_id
	const asked = decisions.filter(decision => decision.checked).length
	// What the agent proposed and the person accepted is one undo, as in the dialog
	const outcomes = await record_action(ws, { folder_id }, t('undo.rename_many', { count: count_items(asked) }), tx => confirm_proposal(
		bulk_rename_request.proposal_id,
		decisions,
		(entry_id, name) => rename_entry(ws, folder_id, entry_id, name, tx),
	), {
		describe: rows => renamed_text(rows
			.filter(row => row.outcome === 'renamed')
			.map(row => ({ from: row.name, to: row.written_name ?? row.to }))),
	})
	const by_name = new Map(outcomes.map(row => [row.name, row]))
	let renamed = 0
	let failed = 0
	for (const row of rows.value) {
		const outcome = by_name.get(row.entry.name)
		if (!outcome || outcome.outcome === 'skipped' || outcome.outcome === 'pending') {
			row.checked = false
			continue
		}
		if (outcome.outcome === 'failed') {
			row.status = 'rename_failed'
			row.reason = outcome.error ?? null
			failed++
		} else {
			row.status = 'renamed'
			renamed++
		}
		row.checked = false
	}
	ws.exit_selection_mode()
	report_batch(renamed, renamed + failed)
	if (failed) {
		rows.value = rows.value.filter(row => row.status === 'rename_failed')
		notice.value = t('bulk_rename.not_renamed', { n: failed })
		phase.value = 'done'
	} else {
		close_proposal(bulk_rename_request.proposal_id)
		close_bulk_rename()
	}
}

function on_open_change(open: boolean) {
	if (!open) {
		stop()
		if (bulk_rename_request.source === 'proposal') close_proposal(bulk_rename_request.proposal_id)
		close_bulk_rename()
	}
}

function status_text(row: BulkRow): string {
	switch (row.status) {
		case 'waiting': return t('bulk_rename.waiting')
		case 'preparing': return t('bulk_rename.reading')
		case 'asking': return t('bulk_rename.asking')
		case 'same': return t('bulk_rename.same')
		case 'stopped': return row.reason ?? t('bulk_rename.stopped')
		case 'renamed': return t('bulk_rename.done')
		default: return row.reason ?? ''
	}
}

watch(() => bulk_rename_request.run, () => {
	if (bulk_rename_request.open) void start()
})
</script>

<template>
	<Modal
		:open="bulk_rename_request.open"
		:title="dialog_title"
		:description="dialog_description"
		:width="640"
		@update:open="on_open_change"
	>
		<div class="aid">
			<div class="aid-status">
				<AiReachBadge v-if="!is_proposal && ai_base_check.ok" :reach="ai_base_check.reach" />
				<template v-if="!is_proposal && phase === 'working'">
					<span v-if="prepared !== null">{{ t('bulk_rename.preparing', { done: prepared, total: rows.length }) }}</span>
					<span v-else>{{ t('bulk_rename.answered', { done: answered, total: rows.length }) }}</span>
				</template>
				<span v-else-if="phase === 'review'">{{ t('bulk_rename.hint') }}</span>
			</div>

			<p v-if="notice" class="aid-error">{{ notice }}</p>

			<ul class="aid-list">
				<li v-for="row in rows" :key="row.entry.id" class="aid-row">
					<Checkbox
						v-model="row.checked"
						:disabled="row.status !== 'ready' || phase !== 'review'"
						:label="t('bulk_rename.check', { name: row.entry.name })"
					/>
					<span class="aid-cell aid-muted" :title="row.entry.name">{{ row.entry.name }}</span>
					<Icon icon="tabler:arrow-right" class="aid-icon" />
					<span
						v-if="row.status === 'ready'"
						class="aid-cell"
						:class="{ 'aid-struck': !row.checked }"
						:title="planned.get(row.entry.id) ?? row.suggestion ?? ''"
					>{{ planned.get(row.entry.id) ?? row.suggestion }}</span>
					<span
						v-else
						class="aid-cell aid-status"
						:class="{ 'aid-error': ['failed', 'rename_failed'].includes(row.status) }"
						:title="status_text(row)"
					>
						<Icon v-if="row.status === 'asking' || row.status === 'preparing'" icon="tabler:loader-2" class="aid-spin" />
						{{ status_text(row) }}
					</span>
				</li>
			</ul>
		</div>

		<template #aside>
			<template v-if="phase === 'review'">{{ t('bulk_rename.to_rename', { n: to_rename.length }) }}</template>
		</template>
		<template #footer>
			<Button v-if="phase === 'working'" icon="tabler:player-stop" @click="stop">{{ t('bulk_rename.stop') }}</Button>
			<template v-else-if="phase === 'review'">
				<Button @click="on_open_change(false)">{{ t('bulk_rename.cancel') }}</Button>
				<Button variant="primary" :disabled="!to_rename.length" @click="apply">{{ t('bulk_rename.rename', { n: to_rename.length }) }}</Button>
			</template>
			<Button v-else-if="phase === 'applying'" variant="primary" loading>{{ t('bulk_rename.renaming') }}</Button>
			<Button v-else @click="on_open_change(false)">{{ t('bulk_rename.close') }}</Button>
		</template>
	</Modal>
</template>
