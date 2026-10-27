<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import store from '@/store'
import { is_desktop } from '@/isDesktop'
import { report_error } from '@/store/helpers/reportError'
import { explorer_enabled } from '@/store/explorer/enabled'
import { add_bookmark } from '@/store/explorer/bookmarks'
import { explorer_navigation } from '@/store/explorer/navigation'
import { local_bookmark_ref, point_in_rect } from '@/ui/explorer/top-bar/folderDrop'
import {
	listenFolderDrop,
	type DroppedFilesPayload,
	type DroppedFolderPayload,
} from '@/services/workspace/listenFolderDrop'
import { listenOpenedPaths } from '@/services/workspace/listenOpenedPaths'
import ExplorerShell from '@/ui/explorer/ExplorerShell.vue'
import WorkspaceWindow from '@/ui/workspace/WorkspaceWindow.vue'
import QuotaWallDialog from '@/ui/workspace/sidebar/QuotaWallDialog.vue'
import BridgeDialog from '@/ui/workspace/sidebar/BridgeDialog.vue'
import UpdateBanner from '@/ui/app/UpdateBanner.vue'
import SyncKeptHiddenToast from '@/ui/workspace/sidebar/SyncKeptHiddenToast.vue'
import PasswordDialog from '@/ui/workspace/sidebar/workspaces-list/PasswordDialog.vue'
import AiConsentDialog from '@/ui/ai/AiConsentDialog.vue'
import BulkRenameDialog from '@/ui/ai/BulkRenameDialog.vue'
import SummaryDialog from '@/ui/ai/SummaryDialog.vue'

// OS-level drop/open events live here (the shell never unmounts); the
// workspace window handles browser drops through its own DOM.
const dragOver = ref(false)

function on_folder_drop(payload: DroppedFolderPayload) {
	if (explorer_enabled.value && point_in_rect(payload.client, top_bar_rect())) {
		void bookmark_dropped_folder(payload.path).catch(error => report_error(store, error))
		return
	}
	void open_dropped_folder(payload.path)
}

function top_bar_rect() {
	const bar = document.querySelector('.explorer .bb')
	return bar ? bar.getBoundingClientRect() : null
}

async function bookmark_dropped_folder(path: string) {
	const { homeDir } = await import('@tauri-apps/api/path')
	add_bookmark(local_bookmark_ref(path, await homeDir()))
}

function open_dropped_folder(path: string): Promise<void> {
	const opening = explorer_enabled.value
		? explorer_navigation.open_local_path(path)
		: store.open_local_workspace(path)
	return Promise.resolve(opening).catch(error => report_error(store, error))
}

function on_files_drop(payload: DroppedFilesPayload) {
	const workspace = store.workspace
	if (!workspace) {
		store.last_error = 'Open a folder before importing files'
		return
	}
	if (!workspace.can_write) return
	void workspace.import_external_files(payload.paths, payload.position ?? undefined)
}

let unlistenDrop: (() => void) | null = null
let unlistenOpened: (() => void) | null = null

onMounted(async () => {
	if (!is_desktop) return
	unlistenDrop = await listenFolderDrop({
		onFolderDrop: on_folder_drop,
		onFilesDrop: on_files_drop,
		onPileOpen: (path) => store.import_workspace_pack(path),
		onError: (message) => { store.last_error = message },
		dragOver,
	})
	unlistenOpened = await listenOpenedPaths({
		onFolderDrop: (path) => open_dropped_folder(path),
		onPileOpen: (path) => store.import_workspace_pack(path),
		onError: (message) => { store.last_error = message },
	})
})

onUnmounted(() => {
	unlistenDrop?.()
	unlistenOpened?.()
})
</script>

<template>
	<UApp>
		<Teleport to="body">
			<div
				v-if="dragOver"
				class="pointer-events-none fixed inset-0 z-[9999] flex items-center justify-center border-2 border-dashed border-primary bg-default/60 text-sm text-default"
			>
				Drop a folder to open, a .pile to import, or files into the workspace
			</div>
		</Teleport>
		<SyncKeptHiddenToast />
		<ExplorerShell v-if="explorer_enabled" />
		<WorkspaceWindow v-else />
		<QuotaWallDialog />
		<BridgeDialog />
		<PasswordDialog />
		<BulkRenameDialog />
		<SummaryDialog />
		<AiConsentDialog />
		<UpdateBanner />
	</UApp>
</template>
