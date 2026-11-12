<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { count_items, t } from '@/i18n'
import { sanitize_suggested_name } from '@/services/ai/naming'
import { apply_sort_plan } from '@/services/ai/sortApply'
import { signal_agent_proposal } from '@/services/mcp/attention'
import { basename_of } from '@/services/mcp/path'
import { close_proposal } from '@/services/mcp/proposal'
import { confirm_move, type MoveDecision } from '@/services/mcp/propose_move'
import type { MoveRowResult } from '@/services/mcp/types'
import { close_sort, sort_session, type SortGroup } from '@/store/aiSort'
import { record_action } from '@/store/history'

/**
 * Sorting before anything moves: folders, new or already there, each with
 * the items going into it, checked. A new folder's name can be changed.
 * "Sort" moves the checked items as one undo; closing moves nothing.
 */

type Phase = 'review' | 'applying' | 'done'

const toast = useToast()
const phase = ref<Phase>('review')
const notice = ref<string | null>(null)

const groups = computed(() => sort_session.groups)
const to_move = computed(() => groups.value.reduce((sum, group) => sum + group.rows.filter(row => row.checked && row.status === 'ready').length, 0))
const dialog_title = computed(() => sort_session.source === 'agent'
	? (sort_session.client_name || t('ai_sort.agent'))
	: t('ai_sort.title', { name: sort_session.board_name }))

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
	phase.value = 'review'
	notice.value = null
	if (sort_session.source === 'agent') {
		const n = groups.value.reduce((sum, group) => sum + group.rows.length, 0)
		signal_agent_proposal(sort_session.proposal_id, dialog_title.value, t('ai_sort.notify', { n, folder: basename_of(sort_session.folder_id) }))
	}
	await sort_session.workspace?.ensure_preview_folder(sort_session.folder_id)
}

function sorted_text(moved: number): { label?: string; notice?: string } {
	if (!moved) return {}
	const count = count_items(moved)
	return { label: t('undo.sort', { count }), notice: t('undo.sorted', { count }) }
}

async function apply() {
	const ws = sort_session.workspace
	if (!ws || !to_move.value) return
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
	// What the agent proposed and the person kept is one undo
	const results: MoveRowResult[] = await record_action(ws, { folder_id }, t('undo.sort', { count: count_items(to_move.value) }), tx => confirm_move(
		proposal_id,
		decisions,
		async (kept) => {
			const written = await apply_sort_plan(ws, folder_id, kept.map(decision => ({
				name: decision.name,
				existing_id: existing.get(decision.to) ?? null,
				entry_ids: decision.entry_ids,
			})), tx)
			return { folders: written.folders.map(folder => ('id' in folder ? folder : { error: folder.error || 'No folder' })), moved: written.moved }
		},
	), { describe: rows => sorted_text(rows.filter(row => row.outcome === 'moved').length) })
	if (sort_session.run !== run) return
	// The proposal's rows follow the preview's groups and items
	const rows = groups.value.flatMap(group => group.rows)
	let failed = 0
	results.forEach((result, index) => {
		const row = rows[index]
		if (!row) return
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
	const moved = results.filter(row => row.outcome === 'moved').length
	if (moved && !ws.history_ref) toast.add({ title: t('undo.sorted', { count: count_items(moved) }), color: 'success' })
	if (failed) {
		notice.value = t('ai_sort.not_moved', { n: failed })
		phase.value = 'done'
		return
	}
	close_proposal(proposal_id)
	close_sort()
}

function on_open_change(open: boolean) {
	if (open) return
	if (sort_session.source === 'agent') close_proposal(sort_session.proposal_id)
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
		:description="sort_session.source === 'agent' ? sort_session.reason : undefined"
		:ui="{ content: 'max-w-2xl', footer: 'justify-between' }"
		@update:open="on_open_change"
	>
		<template #body>
			<div class="flex flex-col gap-3">
				<p v-if="phase === 'review'" class="text-xs text-muted">{{ t('ai_sort.hint') }}</p>
				<p v-if="notice" class="text-sm text-error">{{ notice }}</p>

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
				<template v-if="phase === 'review'">{{ t('ai_sort.to_move', { n: to_move }) }}</template>
			</span>
			<div class="flex gap-2">
				<template v-if="phase === 'review'">
					<UButton :label="t('ai_sort.cancel')" color="neutral" variant="outline" @click="on_open_change(false)" />
					<UButton :label="t('ai_sort.apply', { n: to_move })" :disabled="!to_move" @click="apply" />
				</template>
				<UButton v-else-if="phase === 'applying'" :label="t('ai_sort.applying')" loading disabled />
				<UButton v-else :label="t('ai_sort.close')" color="neutral" variant="outline" @click="on_open_change(false)" />
			</div>
		</template>
	</UModal>
</template>
