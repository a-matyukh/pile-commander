<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ai_base_check, ai_settings } from '@/store/ai'
import { ensure_ai_consent } from '@/store/aiConsent'
import { bulk_rename_request, close_bulk_rename } from '@/store/aiBulkRename'
import { new_row, planned_names, rename_entry, type BulkRow } from '@/services/ai/bulkRename'
import { suggest_batch } from '@/services/ai/bulkSuggest'
import AiReachBadge from './AiReachBadge.vue'

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

const planned = computed(() => planned_names(rows.value, sibling_names()))
const to_rename = computed(() => rows.value.filter((row) => {
	const name = planned.value.get(row.entry.id)
	return name !== undefined && name !== row.entry.name
}))
const answered = computed(() => rows.value.filter(row => !['waiting', 'preparing', 'asking'].includes(row.status)).length)
/** rows read so far; null once everything is read and the model is being asked */
const prepared = ref<number | null>(0)

async function start() {
	controller?.abort()
	const ws = workspace.value
	if (!ws) return
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

async function apply() {
	const ws = workspace.value
	if (!ws) return
	const batch = to_rename.value.map(row => ({ row, name: planned.value.get(row.entry.id)! }))
	if (!batch.length) return
	phase.value = 'applying'
	let renamed = 0
	for (const { row, name } of batch) {
		const error = await rename_entry(ws, bulk_rename_request.folder_id, row.entry.id, name)
		if (error) {
			row.status = 'rename_failed'
			row.reason = error
		} else {
			row.status = 'renamed'
			renamed++
		}
		row.checked = false
	}
	ws.exit_selection_mode()
	const failed = batch.length - renamed
	toast.add({
		title: `Renamed ${renamed} of ${batch.length}`,
		description: failed ? `${failed} failed` : undefined,
		color: failed ? 'warning' : 'success',
	})
	if (failed) {
		rows.value = rows.value.filter(row => row.status === 'rename_failed')
		notice.value = `${failed} ${failed === 1 ? 'file was' : 'files were'} not renamed.`
		phase.value = 'done'
	} else {
		close_bulk_rename()
	}
}

function on_open_change(open: boolean) {
	if (!open) {
		stop()
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
		title="Suggest names"
		:description="`${rows.length} ${rows.length === 1 ? 'item' : 'items'} · ${ai_settings.model}`"
		:ui="{ content: 'max-w-2xl', footer: 'justify-between' }"
		@update:open="on_open_change"
	>
		<template #body>
			<div class="flex flex-col gap-3">
				<div class="flex items-center gap-2 text-xs text-muted">
					<AiReachBadge v-if="ai_base_check.ok" :reach="ai_base_check.reach" />
					<span v-if="phase === 'working' && prepared !== null">Preparing {{ prepared }} of {{ rows.length }}…</span>
					<span v-else-if="phase === 'working'">{{ answered }} of {{ rows.length }} answered</span>
					<span v-else-if="phase === 'review'">Uncheck what to keep. Nothing is renamed until you confirm.</span>
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
				<template v-if="phase === 'review'">{{ to_rename.length }} to rename</template>
			</span>
			<div class="flex gap-2">
				<template v-if="phase === 'working'">
					<UButton label="Stop" icon="i-lucide:square" color="neutral" variant="outline" @click="stop" />
				</template>
				<template v-else-if="phase === 'review'">
					<UButton label="Cancel" color="neutral" variant="outline" @click="on_open_change(false)" />
					<UButton
						:label="`Rename ${to_rename.length}`"
						:disabled="!to_rename.length"
						@click="apply"
					/>
				</template>
				<template v-else-if="phase === 'applying'">
					<UButton label="Renaming…" loading disabled />
				</template>
				<template v-else>
					<UButton label="Close" color="neutral" variant="outline" @click="on_open_change(false)" />
				</template>
			</div>
		</template>
	</UModal>
</template>
