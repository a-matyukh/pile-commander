<script setup lang="ts">
import { ref } from 'vue'
import type { TrashEntry, WorkspaceUsage } from '@pile-commander/file-manager'
import cloud from '@/store/cloud'
import { format_bytes } from '@/utils/format_bytes'
import ConfirmDialog from '@/ui/workspace/menu/ConfirmDialog.vue'

const is_open = ref(false)
const is_loading = ref(false)
const workspace_id = ref('')
const entries = ref<TrashEntry[]>([])
const usage = ref<WorkspaceUsage | null>(null)

const purge_dialog = ref<InstanceType<typeof ConfirmDialog>>()
const empty_dialog = ref<InstanceType<typeof ConfirmDialog>>()
const pending_purge_path = ref('')

async function reload() {
	is_loading.value = true
	const [trash, usage_data] = await Promise.all([
		cloud.fetch_trash(workspace_id.value),
		cloud.fetch_usage(workspace_id.value),
	])
	entries.value = trash
	usage.value = usage_data
	is_loading.value = false
	void cloud.fetch_plan()
}

function open(id: string) {
	workspace_id.value = id
	cloud.clear_error()
	is_open.value = true
	void reload()
}

async function restore(entry: TrashEntry) {
	if (await cloud.restore(workspace_id.value, entry.path)) {
		await reload()
	}
}

function ask_purge(entry: TrashEntry) {
	pending_purge_path.value = entry.path
	purge_dialog.value?.open({
		title: 'Delete forever',
		description: `Permanently delete "${entry.name}"? This cannot be undone.`,
		confirmLabel: 'Delete forever',
	})
}

async function confirm_purge() {
	if (await cloud.purge(workspace_id.value, pending_purge_path.value)) {
		await reload()
	}
}

function ask_empty() {
	empty_dialog.value?.open({
		title: 'Empty trash',
		description: `Permanently delete all ${entries.value.length} items? This cannot be undone.`,
		confirmLabel: 'Empty trash',
	})
}

async function confirm_empty() {
	if (await cloud.purge_all(workspace_id.value)) {
		await reload()
	}
}

function format_date(deleted_at: string): string {
	return new Date(deleted_at).toLocaleDateString()
}

function subtree_info(entry: TrashEntry): string {
	const size = format_bytes(entry.subtree_bytes)
	return entry.kind === 'folder' ? `${entry.subtree_files} files · ${size}` : size
}

defineExpose({ open })
</script>

<template>
	<UModal v-model:open="is_open" title="Trash" :ui="{ footer: 'justify-end' }" @after:leave="$emit('closed')">
		<template #body>
			<p v-if="usage" class="mb-3 text-sm text-muted">
				{{ format_bytes(usage.live_bytes) }} used · {{ format_bytes(usage.trash_bytes) }} in trash
				<template v-if="cloud.owner_usage && cloud.billing">
					· {{ format_bytes(cloud.owner_usage.used_bytes) }} of
					{{ format_bytes(cloud.billing.quota_bytes) }} total
				</template>
			</p>
			<p v-if="cloud.last_error" class="mb-3 text-sm text-error">{{ cloud.last_error }}</p>
			<p v-if="is_loading" class="text-sm text-muted">Loading…</p>
			<p v-else-if="entries.length === 0" class="text-sm text-muted">Trash is empty</p>
			<ul v-else class="flex flex-col gap-1">
				<li
					v-for="entry in entries"
					:key="entry.id"
					class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-elevated"
				>
					<UIcon
						:name="entry.kind === 'folder' ? 'i-lucide-folder' : 'i-lucide-file'"
						class="size-4 shrink-0 text-muted"
					/>
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm">{{ entry.name }}</p>
						<p class="truncate text-xs text-muted">
							{{ entry.path }} · {{ format_date(entry.deleted_at) }} · {{ subtree_info(entry) }}
						</p>
					</div>
					<UButton label="Restore" color="neutral" variant="ghost" size="xs" @click="restore(entry)" />
					<UButton
						label="Delete forever"
						color="error"
						variant="ghost"
						size="xs"
						@click="ask_purge(entry)"
					/>
				</li>
			</ul>
		</template>
		<template #footer>
			<UButton
				label="Empty trash"
				color="error"
				variant="outline"
				:disabled="entries.length === 0 || is_loading"
				@click="ask_empty"
			/>
		</template>
	</UModal>
	<ConfirmDialog ref="purge_dialog" @confirm="confirm_purge" />
	<ConfirmDialog ref="empty_dialog" @confirm="confirm_empty" />
</template>
