<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { t } from '@/i18n'
import type { TrashedWorkspace } from '@pile-commander/file-manager'
import { is_listed_trash_row } from '@/services/workspace/hiddenName'
import cloud from '@/store/cloud'
import { explorer_cloud_trash as trash, type CloudTrashItem } from '@/store/explorer/cloud_trash'
import { show_hidden_files } from '@/store/showHiddenFiles'
import { format_bytes } from '@/utils/format_bytes'
import Button from '@/ui/kit/Button.vue'
import Modal from '@/ui/kit/Modal.vue'

/**
 * The cloud trash, as one list across every top-level cloud folder the user
 * can change: restore an item, delete it forever, or empty the whole trash.
 * Deleting forever always asks first
 */
onMounted(() => {
	if (cloud.user) void trash.load()
})

const purge_target = ref<CloudTrashItem | null>(null)
const purge_workspace = ref<TrashedWorkspace | null>(null)
const purge_open = computed({
	get: () => purge_target.value !== null || purge_workspace.value !== null,
	set: (open: boolean) => {
		if (!open) {
			purge_target.value = null
			purge_workspace.value = null
		}
	},
})
const empty_open = ref(false)

function confirm_purge() {
	const item = purge_target.value
	const row = purge_workspace.value
	purge_target.value = null
	purge_workspace.value = null
	if (item) void trash.purge(item)
	else if (row) void trash.purge_workspace(row)
}

function confirm_empty() {
	empty_open.value = false
	void trash.empty()
}

function details(item: CloudTrashItem): string {
	const size = format_bytes(item.subtree_bytes)
	return item.kind === 'folder' ? `${t('trash.files', { n: item.subtree_files })} · ${size}` : size
}

const date = (value: string) => new Date(value).toLocaleDateString()

const visible_items = computed(() =>
	trash.state.items.filter(item => is_listed_trash_row(item.name, item.path, show_hidden_files.value)),
)
const has_rows = computed(() => visible_items.value.length > 0 || trash.state.workspaces.length > 0)
</script>

<template>
	<div class="page">
		<p v-if="!cloud.user" class="muted">{{ t('trash.sign_in') }}</p>
		<template v-else>
			<div class="bar">
				<p v-if="cloud.last_error" class="muted bad">{{ cloud.last_error }}</p>
				<Button
					v-if="has_rows"
					variant="danger-link"
					class="empty"
					@click="empty_open = true"
				>
					{{ t('trash.empty') }}
				</Button>
			</div>
			<p v-if="trash.state.loading && !trash.state.loaded" class="muted">{{ t('trash.loading') }}</p>
			<p v-else-if="!has_rows" class="muted">{{ t('trash.nothing') }}</p>
			<div v-else class="card list">
				<div v-for="row in trash.state.workspaces" :key="row.id" class="row">
					<Icon icon="tabler:folder" class="ic" />
					<div class="min">
						<div class="nm">{{ row.name }}</div>
						<div class="meta">{{ date(row.deleted_at) }} · {{ format_bytes(row.size_bytes) }}</div>
					</div>
					<Button
						icon="tabler:arrow-back-up"
						:disabled="trash.state.busy.has(`ws\0${row.id}`)"
						@click="trash.restore_workspace(row)"
					>
						{{ t('trash.restore') }}
					</Button>
					<Button
						variant="danger-link"
						:disabled="trash.state.busy.has(`ws\0${row.id}`)"
						@click="purge_workspace = row"
					>
						{{ t('trash.purge') }}
					</Button>
				</div>
				<div v-for="item in visible_items" :key="trash.key(item)" class="row">
					<Icon :icon="item.kind === 'folder' ? 'tabler:folder' : 'tabler:file'" class="ic" />
					<div class="min">
						<div class="nm">{{ item.name }}</div>
						<div class="meta">{{ t('trash.from', { name: item.workspace_name }) }} · {{ date(item.deleted_at) }} · {{ details(item) }}</div>
					</div>
					<Button
						icon="tabler:arrow-back-up"
						:disabled="trash.state.busy.has(trash.key(item))"
						@click="trash.restore(item)"
					>
						{{ t('trash.restore') }}
					</Button>
					<Button
						variant="danger-link"
						:disabled="trash.state.busy.has(trash.key(item))"
						@click="purge_target = item"
					>
						{{ t('trash.purge') }}
					</Button>
				</div>
			</div>
		</template>

		<Modal
			v-model:open="purge_open"
			:title="t('trash.purge_title', { name: purge_target?.name ?? purge_workspace?.name ?? '' })"
			:description="t('trash.purge_d')"
		>
			<template #footer>
				<Button @click="purge_open = false">{{ t('dialog.cancel') }}</Button>
				<Button variant="danger" @click="confirm_purge">{{ t('trash.purge') }}</Button>
			</template>
		</Modal>
		<Modal v-model:open="empty_open" :title="t('trash.empty_title')" :description="t('trash.empty_d')">
			<template #footer>
				<Button @click="empty_open = false">{{ t('dialog.cancel') }}</Button>
				<Button variant="danger" @click="confirm_empty">{{ t('trash.empty') }}</Button>
			</template>
		</Modal>
	</div>
</template>

<style scoped>
.page {
	padding: 16px 16px 32px;
	max-width: 720px;
	display: flex;
	flex-direction: column;
	gap: 12px;
}
.bar {
	display: flex;
	align-items: center;
	gap: 12px;
	min-height: 20px;
}
.empty {
	margin-left: auto;
}
.muted {
	margin: 0;
	font-size: 12px;
	color: var(--text-muted);
}
.bad {
	color: var(--text-danger);
}
.card {
	border: 0.5px solid var(--border);
	border-radius: 12px;
	background: var(--surface-2);
}
.list {
	padding: 4px;
}
.row {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 6px 8px;
	border-radius: 6px;
}
.ic {
	font-size: 18px;
	color: var(--text-secondary);
	flex: none;
}
.min {
	flex: 1;
	min-width: 0;
}
.nm {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.meta {
	font-size: 12px;
	color: var(--text-muted);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.explorer.lg .ic {
	font-size: 21px;
}
@media (hover: hover) {
	.row:hover {
		background: var(--surface-1);
	}
}
</style>
