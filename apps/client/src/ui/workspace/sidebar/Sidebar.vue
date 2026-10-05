<script setup lang="ts">
import { computed } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import WindowControls from '@/ui/window/WindowControls.vue'
import WorkspaceTree from './workspace-tree/WorkspaceTree.vue'
import cloud from '@/store/cloud'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import { useWorkspaceDialogs } from './workspaceDialogs'
import { open_bridge, type BridgeDoor } from '@/store/bridge'

defineProps<{
	show_controls: boolean
}>()

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
	],
])
</script>

<template>
	<div class="sidebar flex min-h-0 w-full flex-1 flex-col overflow-hidden">
		<nav>
			<div v-if="show_controls">
				<WindowControls />
			</div>
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
