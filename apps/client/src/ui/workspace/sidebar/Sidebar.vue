<script setup lang="ts">
import { computed } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import WorkspaceTree from './workspace-tree/WorkspaceTree.vue'
import cloud from '@/store/cloud'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import { useWorkspaceDialogs } from './workspaceDialogs'
import { open_bridge, type BridgeDoor } from '@/store/bridge'
import { sync_link_of, sync_workspace_to_folder, synced_folder_of, unlink_folder } from '@/store/localSync'
import store from '@/store'
import { is_desktop } from '@/isDesktop'
import SyncStatusButton from './SyncStatusButton.vue'

const workspace = useWorkspace()
const dialogs = useWorkspaceDialogs()

function open_trash() {
	const ws = workspace.value
	if (!ws || ws.type !== 'cloud') return
	dialogs.open_trash(ws.uid)
}

function open_share() {
	const ws = workspace.value
	if (!ws || ws.type !== 'cloud') return
	dialogs.open_share(ws.uid)
}

function open_publish() {
	const ws = workspace.value
	if (!ws || ws.type !== 'cloud') return
	dialogs.open_publish(ws.uid)
}

function open_workspace_root() {
	const ws = workspace.value
	if (!ws) return
	ws.open_folder(ws.id)
}

/** Sharing/publishing management is owner-only */
const is_cloud_owner = computed(() => {
	const ws = workspace.value
	return ws?.type === 'cloud' && cloud.role_of(ws.uid) === 'owner'
})

/**
 * A local workspace shares and publishes through a cloud copy: Share and
 * Publish open the bridge dialog instead of staying disabled
 */
const is_local_workspace = computed(() => {
	const ws = workspace.value
	return cloud.is_configured && (ws?.type === 'local' || ws?.type === 'browser')
})

function copy_to_cloud(door: BridgeDoor) {
	const ws = workspace.value
	if (!ws || (ws.type !== 'local' && ws.type !== 'browser')) return
	// the whole workspace from its root, whichever folder is open
	open_bridge({ type: ws.type, id: ws.id, name: ws.name }, door, { fm: ws.file_manager })
}

/** Auto-sync keeps a folder on disk in step with a cloud copy: desktop folders only */
const is_syncable = computed(() => is_desktop && is_local_workspace.value && workspace.value?.type === 'local')
const is_synced = computed(() => {
	const ws = workspace.value
	return !!ws && sync_link_of(ws.id) !== null
})

function set_auto_sync(on: boolean) {
	const ws = workspace.value
	if (!ws) return
	if (on) copy_to_cloud('sync')
	else void unlink_folder(ws.id)
}

/** Desktop: this cloud workspace as a folder on this computer (the menu shows only to owners and editors) */
const is_cloud_syncable = computed(() => is_desktop && cloud.is_configured && workspace.value?.type === 'cloud')
const synced_folder = computed(() => {
	const ws = workspace.value
	return ws?.type === 'cloud' ? synced_folder_of(ws.uid) : null
})

async function sync_to_folder() {
	const ws = workspace.value
	if (!ws || ws.type !== 'cloud') return
	try {
		const root = await sync_workspace_to_folder({ id: ws.uid, name: ws.name })
		if (root) await store.open_local_workspace(root)
	} catch (error) {
		store.last_error = error instanceof Error ? error.message : String(error)
	}
}

const workspace_menu_items = computed<DropdownMenuItem[][]>(() => [
	[
		{
			// the desktop app writes a .pile: a local workspace, or a cloud workspace downloaded whole
			label: 'Export',
			icon: 'i-lucide-download',
			disabled: !is_desktop || (workspace.value?.type !== 'local' && workspace.value?.type !== 'cloud'),
			onSelect: () => {
				void store.export_current_workspace()
			},
		},
		{
			label: is_local_workspace.value ? 'Share…' : 'Share',
			icon: 'i-lucide-users',
			disabled: !is_cloud_owner.value && !is_local_workspace.value,
			onSelect: () => (is_local_workspace.value ? copy_to_cloud('share') : open_share()),
		},
		{
			label: is_local_workspace.value ? 'Publish…' : 'Publish',
			icon: 'i-lucide-globe',
			disabled: !is_cloud_owner.value && !is_local_workspace.value,
			onSelect: () => (is_local_workspace.value ? copy_to_cloud('publish') : open_publish()),
		},
		...(is_local_workspace.value
			? [{
				label: 'Copy to cloud…',
				icon: 'i-lucide-monitor-smartphone',
				onSelect: () => copy_to_cloud('device'),
			}]
			: []),
		...(is_cloud_syncable.value
			? [{
				label: synced_folder.value ? 'Open synced folder' : 'Sync to a folder on this computer…',
				icon: 'i-lucide-folder-sync',
				onSelect: () => void sync_to_folder(),
			}]
			: []),
		...(is_syncable.value
			? [{
				label: 'Auto-sync',
				icon: 'i-lucide-refresh-cw',
				type: 'checkbox' as const,
				checked: is_synced.value,
				onUpdateChecked: set_auto_sync,
			}]
			: []),
	],
])
</script>

<template>
	<div class="sidebar flex min-h-0 w-full flex-1 flex-col overflow-hidden">
		<nav>
			<div class="sidebar-header flex items-stretch gap-1 border-b border-default pr-1">
				<UButton
					v-if="workspace"
					class="h-full rounded-none"
					:class="{ 'opened_folder': workspace.is_opened_folder(workspace.id) }"
					color="neutral"
					variant="ghost"
					@click="open_workspace_root"
				>{{ workspace.name }}</UButton>
				<div
					v-if="workspace?.can_write"
					class="ml-auto flex shrink-0 items-center gap-1"
				>
					<SyncStatusButton v-if="is_syncable" :root="workspace.id" />
					<UDropdownMenu
						:items="workspace_menu_items"
						:content="{
							align: 'end',
							side: 'bottom',
							sideOffset: 8,
							onCloseAutoFocus: (e: Event) => e.preventDefault(),
						}"
						:ui="{
							content: 'min-w-32',
						}"
					>
						<UButton icon="material-symbols:share-outline" color="neutral" variant="ghost" size="xs" label="Share" />
					</UDropdownMenu>
					<UButton
						v-if="workspace.type === 'cloud'"
						icon="i-lucide-trash-2"
						color="neutral"
						variant="ghost"
						size="xs"
						label="Trash"
						@click="open_trash"
					/>
				</div>
			</div>
		</nav>
		<section class="min-h-0 flex-1 overflow-y-auto" v-if="workspace" :key="workspace.uid">
			<WorkspaceTree />
		</section>
	</div>
</template>

<style scoped>
.opened_folder {
	/* background-color: var(--pc-bg-muted); */
	background-color: #fff;
	color: var(--pc-accent);
}
nav {
	width: 100%;
	padding: 0;
}
.sidebar-header {
	height: 45px;
}
.sidebar {
	background-color: var(--pc-gray-surface);
}
</style>
