<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window'
import { count_items, t } from '@/i18n'
import { is_desktop } from '@/isDesktop'
import { ai_base_check, ai_settings } from '@/store/ai'
import { model_label } from '@/services/ai/presets'
import { ensure_ai_consent } from '@/store/aiConsent'
import { bulk_rename_request, close_bulk_rename } from '@/store/aiBulkRename'
import { new_row, planned_names, rename_entry, type BulkRow } from '@/services/ai/bulkRename'
import { suggest_batch } from '@/services/ai/bulkSuggest'
import { notify_proposal, signal_unfocused_proposal } from '@/services/mcp/attention'
import { basename_of } from '@/services/mcp/path'
import { close_proposal, confirm_proposal, proposal_decisions, ready_proposal_rows } from '@/services/mcp/propose'
import { record_action } from '@/store/history'
import AiReachBadge from './AiReachBadge.vue'

type Phase = 'working' | 'review' | 'applying' | 'done'

const toast = useToast()
/** Proposal id that already bounced the Dock and posted its notification. */
let signaled_proposal: string | null = null

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
	: 'Suggest names')
const dialog_description = computed(() => is_proposal.value
	? bulk_rename_request.reason
	: `${rows.value.length} ${rows.value.length === 1 ? 'item' : 'items'} · ${model_label(ai_settings.value.model)}`)

const planned = computed(() => planned_names(rows.value, sibling_names()))
const to_rename = computed(() => rows.value.filter((row) => {
	const name = planned.value.get(row.entry.id)
	return name !== undefined && name !== row.entry.name
}))
const answered = computed(() => rows.value.filter(row => !['waiting', 'preparing', 'asking'].includes(row.status)).length)
/** rows read so far; null once everything is read and the model is being asked */
const prepared = ref<number | null>(0)

function signal_proposal() {
	if (!is_desktop) return
	const id = bulk_rename_request.proposal_id
	if (!id || signaled_proposal === id) return
	signaled_proposal = id
	const title = bulk_rename_request.client_name || t('bulk_rename.agent')
	const body = t('bulk_rename.notify', {
		n: bulk_rename_request.entries.length,
		folder: basename_of(bulk_rename_request.folder_id),
	})
	void (async () => {
		try {
			const win = getCurrentWindow()
			const focused = await win.isFocused()
			await signal_unfocused_proposal({
				focused,
				already: false,
				bounce: () => win.requestUserAttention(UserAttentionType.Informational),
				notify: () => notify_proposal(title, body),
			})
		} catch (error) {
			console.error('[mcp] proposal attention', error)
		}
	})()
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
	if (!outcome.consented) notice.value = 'Nothing was sent.'
	else if (outcome.stop_reason) notice.value = `Stopped: ${outcome.stop_reason}`
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
		notice.value = `${failed} ${failed === 1 ? 'file was' : 'files were'} not renamed.`
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
		case 'waiting': return 'Waiting…'
		case 'preparing': return 'Reading…'
		case 'asking': return 'Asking…'
		case 'same': return 'Keeps its name'
		case 'stopped': return row.reason ?? 'Stopped'
		case 'renamed': return 'Renamed'
		default: return row.reason ?? ''
	}
}

watch(() => bulk_rename_request.run, () => {
	if (bulk_rename_request.open) void start()
})
</script>

<template>
	<UModal
		:open="bulk_rename_request.open"
		:title="dialog_title"
		:description="dialog_description"
		:ui="{ content: 'max-w-2xl', footer: 'justify-between' }"
		@update:open="on_open_change"
	>
		<template #body>
			<div class="flex flex-col gap-3">
				<div class="flex items-center gap-2 text-xs text-muted">
					<AiReachBadge v-if="!is_proposal && ai_base_check.ok" :reach="ai_base_check.reach" />
					<template v-if="!is_proposal">
						<span v-if="phase === 'working' && prepared !== null">Preparing {{ prepared }} of {{ rows.length }}…</span>
						<span v-else-if="phase === 'working'">{{ answered }} of {{ rows.length }} answered</span>
						<span v-else-if="phase === 'review'">Uncheck what to keep. Nothing is renamed until you confirm.</span>
					</template>
					<span v-else-if="phase === 'review'">{{ t('bulk_rename.hint') }}</span>
				</div>

				<p v-if="notice" class="text-sm text-error">{{ notice }}</p>

				<ul class="flex max-h-[50vh] flex-col divide-y divide-default overflow-y-auto rounded-md border border-default">
					<li v-for="row in rows" :key="row.entry.id" class="flex items-center gap-2 px-2.5 py-1.5 text-sm">
						<UCheckbox
							v-model="row.checked"
							:disabled="row.status !== 'ready' || phase !== 'review'"
							:aria-label="`Rename ${row.entry.name}`"
						/>
						<span class="min-w-0 flex-1 truncate text-muted" :title="row.entry.name">{{ row.entry.name }}</span>
						<UIcon name="i-lucide:arrow-right" class="size-3.5 shrink-0 text-dimmed" />
						<span
							v-if="row.status === 'ready'"
							class="min-w-0 flex-1 truncate"
							:class="row.checked ? 'text-default' : 'text-dimmed line-through'"
							:title="planned.get(row.entry.id) ?? row.suggestion ?? ''"
						>{{ planned.get(row.entry.id) ?? row.suggestion }}</span>
						<span
							v-else
							class="flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs"
							:class="['failed', 'rename_failed'].includes(row.status) ? 'text-error' : 'text-muted'"
							:title="status_text(row)"
						>
							<UIcon v-if="row.status === 'asking' || row.status === 'preparing'" name="i-lucide:loader-circle" class="size-3.5 shrink-0 animate-spin" />
							{{ status_text(row) }}
						</span>
					</li>
				</ul>
			</div>
		</template>

		<template #footer>
			<span class="text-xs text-muted">
				<template v-if="phase === 'review'">
					{{ is_proposal ? t('bulk_rename.to_rename', { n: to_rename.length }) : `${to_rename.length} to rename` }}
				</template>
			</span>
			<div class="flex gap-2">
				<template v-if="phase === 'working'">
					<UButton label="Stop" icon="i-lucide:square" color="neutral" variant="outline" @click="stop" />
				</template>
				<template v-else-if="phase === 'review'">
					<UButton
						:label="is_proposal ? t('bulk_rename.cancel') : 'Cancel'"
						color="neutral"
						variant="outline"
						@click="on_open_change(false)"
					/>
					<UButton
						:label="is_proposal ? t('bulk_rename.rename', { n: to_rename.length }) : `Rename ${to_rename.length}`"
						:disabled="!to_rename.length"
						@click="apply"
					/>
				</template>
				<template v-else-if="phase === 'applying'">
					<UButton :label="is_proposal ? t('bulk_rename.renaming') : 'Renaming…'" loading disabled />
				</template>
				<template v-else>
					<UButton
						:label="is_proposal ? t('bulk_rename.close') : 'Close'"
						color="neutral"
						variant="outline"
						@click="on_open_change(false)"
					/>
				</template>
			</div>
		</template>
	</UModal>
</template>
