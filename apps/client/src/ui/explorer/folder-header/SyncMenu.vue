<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import { t } from '@/i18n'
import { normalize_workspace_id } from '@/services/workspace/paths'
import bridge, { dismiss_bridge } from '@/store/bridge'
import { BRIDGE_PANEL_WIDTH, bridge_hidden_tip, bridge_in_sync_menu, bridge_title } from '@/store/bridgePanel'
import { continue_sync_here, copy_to_cloud, open_other_side, start_sync, stop_sync, sync_link_now, use_sync_link } from '@/store/explorer/share'
import { other_copy_link_of, sync_statuses, type OtherCopyLink } from '@/store/localSync'
import BridgeBody from './BridgeBody.vue'
import PanelFrame from './PanelFrame.vue'
import DropMenu from '@/ui/kit/DropMenu.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import MenuItem from '@/ui/kit/MenuItem.vue'
import MenuLabel from '@/ui/kit/MenuLabel.vue'
import MenuSeparator from '@/ui/kit/MenuSeparator.vue'

/**
 * Everything about Auto-sync for the open folder, as in the prototype's Sync
 * menu. Not synced: start it (a folder on this Mac goes to the cloud, a cloud
 * folder gets a folder on this Mac). Synced: the old interface's status
 * panel (progress, conflicts, failures, a paused mass delete) and its actions
 */
const props = defineProps<{ folder: FolderRef; name: string; align: 'start' | 'end' }>()

const open = ref(false)
const in_cloud = computed(() => props.folder.drive_id === 'cloud')
const link = use_sync_link(() => props.folder)
/**
 * A folder on this Mac that another copy of the app syncs (its link file is
 * not this copy's): the menu offers to continue here instead of a new copy
 */
const other = ref<OtherCopyLink | null>(null)
let other_check = 0
watch([() => props.folder.folder_id, () => props.folder.drive_id, () => link.value?.root, open], async () => {
	const check = ++other_check
	const found = in_cloud.value || link.value ? null : await other_copy_link_of(normalize_workspace_id(props.folder.folder_id))
	if (check === other_check) other.value = found
}, { immediate: true })
const status = computed(() => (link.value ? sync_statuses[link.value.root] ?? null : null))
const has_failures = computed(() => status.value?.phase === 'idle' && status.value.errors.length > 0)
const source_id = computed(() => normalize_workspace_id(props.folder.folder_id))
const session = computed(() =>
	bridge.open && bridge.source?.id === source_id.value && bridge_in_sync_menu(bridge.door),
)
const hidden_tip = computed(() => bridge_hidden_tip({
	open: bridge.open,
	step: bridge.step,
	door: bridge.door,
	source_id: bridge.source?.id ?? null,
	progress: bridge.progress,
}, source_id.value, 'sync'))

watch(session, (on, was) => {
	if (on) open.value = true
	else if (was) open.value = false
}, { immediate: true })

watch(open, (is_open, was_open) => {
	if (was_open == null) return
	if (is_open && hidden_tip.value) bridge.open = true
	if (was_open && !is_open && bridge.open && bridge.source?.id === source_id.value && bridge_in_sync_menu(bridge.door)) {
		dismiss_bridge()
	}
})

const icon = computed(() => {
	if (!link.value && other.value) return 'tabler:cloud-question'
	if (!link.value) return in_cloud.value ? 'tabler:cloud-down' : 'tabler:cloud-up'
	if (!status.value) return 'tabler:cloud'
	if (has_failures.value) return 'tabler:cloud-exclamation'
	switch (status.value.phase) {
		case 'syncing': return 'tabler:refresh'
		case 'paused': return 'tabler:cloud-pause'
		case 'error': return 'tabler:cloud-off'
		default: return 'tabler:cloud-check'
	}
})

const title = computed(() => {
	if (!status.value) return t('sync.waiting')
	if (has_failures.value) return t('sync.some_failed')
	switch (status.value.phase) {
		case 'syncing': return t('sync.syncing_now')
		case 'paused': return t('sync.paused')
		case 'error': return t('sync.failed')
		default: return t('sync.synced')
	}
})

function ago(epoch_ms: number): string {
	const minutes = Math.round((Date.now() - epoch_ms) / 60_000)
	if (minutes < 1) return t('sync.just_now')
	if (minutes < 60) return t('sync.min_ago', { n: minutes })
	return new Date(epoch_ms).toLocaleString()
}

const subtitle = computed(() => {
	const progress = status.value?.progress
	if (progress && progress.total > 0) {
		const of = t('sync.progress', { done: Math.min(progress.done + 1, progress.total), total: progress.total })
		return progress.current ? `${of} · ${progress.current}` : of
	}
	const at = status.value?.last_synced_at
	return at ? t('sync.last_synced', { when: ago(at) }) : t('sync.not_synced_yet')
})

const tip = computed(() => hidden_tip.value ?? (link.value ? title.value : other.value ? t('sync.other_copy_title') : t('actions.sync')))
const cloud_pause = computed(() => {
	if (status.value?.reason === 'workspace_trashed') return t('sync.workspace_trashed')
	if (status.value?.reason === 'workspace_missing') return t('sync.workspace_missing')
	return ''
})
</script>

<template>
	<DropMenu v-model:open="open" :width="session ? BRIDGE_PANEL_WIDTH : 300" :align="align">
		<template #trigger>
			<IconButton
				class="hb"
				:class="{ spin: status?.phase === 'syncing' || !!hidden_tip }"
				:active="open"
				:icon="icon"
				:icon_size="18"
				:aria-label="tip"
				:data-tip="tip"
			/>
		</template>
		<PanelFrame v-if="session" plain :title="bridge_title(bridge.door)" @close="open = false">
			<BridgeBody />
		</PanelFrame>
		<template v-else-if="!link && other">
			<div class="st" role="status">
				<p class="tt">{{ t('sync.other_copy_title') }}</p>
				<p>{{ t('sync.other_copy', { name: other.name }) }}</p>
				<p class="mu">{{ t('sync.other_copy_hint') }}</p>
			</div>
			<MenuSeparator />
			<MenuItem icon="tabler:cloud-check" :label="t('sync.continue_here')" @select="continue_sync_here(folder, name)" />
		</template>
		<template v-else-if="!link">
			<MenuLabel :label="in_cloud ? t('sync.cloud_only') : t('sync.local_only')" />
			<MenuItem v-if="!in_cloud" icon="tabler:cloud-plus" :label="t('sync.copy_to_cloud')" keep_open @select="copy_to_cloud(folder, name, 'device')" />
			<MenuItem
				:icon="in_cloud ? 'tabler:cloud-down' : 'tabler:cloud-up'"
				:label="in_cloud ? t('sync.sync_with_disk') : t('sync.sync_with_cloud')"
				:keep_open="!in_cloud"
				@select="start_sync(folder, name)"
			/>
		</template>
		<template v-else>
			<div class="st" role="status" aria-live="polite">
				<p class="tt">{{ title }}</p>
				<p class="mu one" :title="subtitle">{{ subtitle }}</p>
				<p class="mu">{{ t('sync.both_ways') }}</p>
				<p v-if="cloud_pause">{{ cloud_pause }}</p>
				<p v-else-if="status?.message" :class="{ er: status.phase === 'error' }">{{ status.message }}</p>
				<p v-if="status?.conflicts.length">
					{{ t('sync.conflicts', { n: status.conflicts.length, names: status.conflicts.slice(-3).join(', ') }) }}
				</p>
				<p v-if="status?.kept_for_hidden.length">
					{{ t('sync.kept_hidden', { names: status.kept_for_hidden.slice(-3).join(', ') }) }}
				</p>
				<p v-if="status?.skipped.length" class="mu">{{ t('sync.skipped', { n: status.skipped.length }) }}</p>
				<div v-if="status?.errors.length" class="er">
					<p>{{ t('sync.errors', { n: status.errors.length }) }}</p>
					<p v-for="failure in status.errors.slice(0, 3)" :key="failure.relative" class="one" :title="failure.message">
						{{ failure.relative }} — {{ failure.message }}
					</p>
				</div>
			</div>
			<MenuSeparator />
			<MenuItem
				v-if="status?.reason === 'mass_delete_cloud'"
				icon="tabler:trash"
				:label="t('sync.trash_cloud', { n: status.pending_deletes ?? 0 })"
				@select="sync_link_now(link, { allow_cloud_deletes: true })"
			/>
			<MenuItem
				v-if="status?.reason === 'mass_delete_local'"
				icon="tabler:trash"
				:label="t('sync.trash_local', { n: status.pending_deletes ?? 0 })"
				@select="sync_link_now(link, { allow_local_deletes: true })"
			/>
			<MenuItem
				v-if="status?.phase !== 'syncing'"
				icon="tabler:refresh"
				:label="t('sync.sync_now')"
				@select="sync_link_now(link)"
			/>
			<MenuItem
				:icon="in_cloud ? 'tabler:device-laptop' : 'tabler:cloud'"
				:label="in_cloud ? t('sync.open_disk_copy') : t('sync.open_cloud_copy')"
				@select="open_other_side(folder, link)"
			/>
			<MenuItem icon="tabler:cloud-off" :label="t('sync.stop')" @select="stop_sync(link)" />
		</template>
	</DropMenu>
</template>

<style scoped>
.st {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 6px 8px;
	font-size: 12px;
	line-height: 1.4;
	color: var(--text-primary);
	white-space: normal;
}
.st p {
	margin: 0;
}
.tt {
	font-weight: 600;
	font-size: 13px;
}
.mu {
	color: var(--text-muted);
}
.er {
	color: var(--text-danger);
}
.one {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.spin :deep(svg) {
	animation: sync-spin 1s linear infinite;
}
@keyframes sync-spin {
	to {
		transform: rotate(360deg);
	}
}
</style>
