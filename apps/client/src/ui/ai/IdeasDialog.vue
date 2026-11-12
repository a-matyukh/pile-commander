<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { WorkspaceStore } from '@/domain/Store'
import type { Position } from '@/domain/Widget'
import { count_notes, t } from '@/i18n'
import { add_new_notes, new_note_positions, planned_note_names } from '@/services/ai/newNotes'
import { strip_think, untrusted_markdown } from '@/services/ai/text'
import { signal_agent_proposal } from '@/services/mcp/attention'
import { basename_of } from '@/services/mcp/path'
import { close_proposal } from '@/services/mcp/proposal'
import { confirm_create } from '@/services/mcp/propose_create'
import type { CreateRowResult } from '@/services/mcp/types'
import { to_folder_container } from '@/services/workspace/folderContainer'
import { close_ideas, ideas_session } from '@/store/aiIdeas'
import { record_action } from '@/store/history'
import { parseNoteMarkdown } from '@/ui/workspace/folder-container/widgets/markdown'
import { loadedNoteRenderer, loadNoteRenderer } from '@/ui/workspace/folder-container/widgets/noteRenderer'

/**
 * New notes an agent proposed, before anything is written: each shown the
 * way the note will look, checked, under the name it will get. "Add" writes
 * the checked ones as one undo; closing writes nothing.
 */

type Phase = 'review' | 'applying' | 'done'

const toast = useToast()

const phase = ref<Phase>('review')
const notice = ref<string | null>(null)

const workspace = computed(() => ideas_session.workspace)
const rows = computed(() => ideas_session.rows)

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

const dialog_title = computed(() => ideas_session.client_name || t('ideas.agent'))

function title_of(name: string): string {
	return name.replace(/\.md$/i, '')
}

/** Where the new notes go: right of what the folder holds, or wherever the folder puts them. */
function places(ws: WorkspaceStore, folder_id: string, count: number): (Position | null)[] {
	const folder = ws.resolve_folder_data(folder_id)
	const children = folder ? to_folder_container(folder, ws.preview_folders).children : []
	return new_note_positions(children, count)
}

async function start() {
	phase.value = 'review'
	notice.value = null
	signal_agent_proposal(
		ideas_session.proposal_id,
		dialog_title.value,
		t('ideas.notify', { folder: basename_of(ideas_session.folder_id), n: rows.value.length }),
	)
	await workspace.value?.ensure_preview_folder(ideas_session.folder_id)
}

function added_text(results: CreateRowResult[]): { label?: string; notice?: string } {
	const created = results.filter(row => row.outcome === 'created').length
	if (!created) return {}
	const count = count_notes(created)
	return { label: t('undo.notes', { count }), notice: t('undo.notes_added', { count }) }
}

async function apply() {
	const ws = workspace.value
	if (!ws || !to_add.value.length) return
	const folder_id = ideas_session.folder_id
	const proposal_id = ideas_session.proposal_id
	phase.value = 'applying'
	notice.value = null
	await ws.ensure_preview_folder(folder_id)
	const names = planned.value
	const checked = rows.value.map(row => row.checked && row.status === 'ready')
	const asked = to_add.value.length
	// What the agent proposed and the person kept is one undo, as with names
	const results = await record_action(ws, { folder_id }, t('undo.notes', { count: count_notes(asked) }), tx => confirm_create(
		proposal_id,
		checked,
		(chosen) => {
			const spots = places(ws, folder_id, chosen.length)
			return add_new_notes(ws, folder_id, chosen.map((row, at) => ({
				name: names[row.index] ?? row.name,
				text: row.text,
				position: rows.value[row.index]?.position ?? spots[at] ?? null,
			})), tx)
		},
	), { describe: added_text })
	if (ideas_session.proposal_id !== proposal_id) return
	let failed = 0
	results.forEach((result, index) => {
		const row = rows.value[index]
		if (!row) return
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
	const created = results.filter(row => row.outcome === 'created').length
	// The history's toast says it, with "Undo"; a store without history says it here
	if (created && !ws.history_ref) toast.add({ title: t('undo.notes_added', { count: count_notes(created) }), color: 'success' })
	if (failed) {
		notice.value = t('ideas.not_added', { n: failed })
		phase.value = 'done'
		return
	}
	close_proposal(proposal_id)
	close_ideas()
}

function on_open_change(open: boolean) {
	if (open) return
	close_proposal(ideas_session.proposal_id)
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
		:description="ideas_session.reason"
		:ui="{ content: 'max-w-2xl', footer: 'justify-between' }"
		@update:open="on_open_change"
	>
		<template #body>
			<div class="flex flex-col gap-3">
				<p v-if="phase === 'review'" class="text-xs text-muted">{{ t('ideas.hint') }}</p>
				<p v-if="notice" class="text-sm text-error">{{ notice }}</p>

				<ul class="flex max-h-[55vh] flex-col gap-2 overflow-y-auto">
					<li
						v-for="(row, index) in rows"
						:key="row.key"
						class="flex gap-2.5 rounded-md border border-default p-2.5"
						:class="{ 'opacity-60': !row.checked && row.status === 'ready' }"
					>
						<UCheckbox
							v-model="row.checked"
							class="mt-0.5"
							:disabled="row.status !== 'ready' || phase !== 'review'"
							:aria-label="t('ideas.check', { name: title_of(planned[index] ?? row.name) })"
						/>
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium" :title="planned[index] ?? row.name">
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
				<template v-if="phase === 'review'">
					<UButton :label="t('ideas.cancel')" color="neutral" variant="outline" @click="on_open_change(false)" />
					<UButton :label="t('ideas.add', { n: to_add.length })" :disabled="!to_add.length" @click="apply" />
				</template>
				<UButton v-else-if="phase === 'applying'" :label="t('ideas.adding')" loading disabled />
				<UButton v-else :label="t('ideas.close')" color="neutral" variant="outline" @click="on_open_change(false)" />
			</div>
		</template>
	</UModal>
</template>
