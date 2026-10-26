<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import store from '@/store'
import { is_desktop } from '@/isDesktop'
import {
	listenFolderDrop,
	type DroppedFilesPayload,
	type DroppedFolderPayload,
} from '@/services/workspace/listenFolderDrop'
import { listenOpenedPaths } from '@/services/workspace/listenOpenedPaths'
import WorkspaceWindow from '@/ui/workspace/WorkspaceWindow.vue'
import QuotaWallDialog from '@/ui/workspace/sidebar/QuotaWallDialog.vue'
import BridgeDialog from '@/ui/workspace/sidebar/BridgeDialog.vue'
import UpdateBanner from '@/ui/app/UpdateBanner.vue'
import PasswordDialog from '@/ui/workspace/sidebar/workspaces-list/PasswordDialog.vue'
import AiConsentDialog from '@/ui/ai/AiConsentDialog.vue'
import BulkRenameDialog from '@/ui/ai/BulkRenameDialog.vue'
import SummaryDialog from '@/ui/ai/SummaryDialog.vue'

// OS-level drop/open events live here (the shell never unmounts); the
// workspace window handles browser drops through its own DOM.
const dragOver = ref(false)

function on_folder_drop(payload: DroppedFolderPayload) {
	void store.open_local_workspace(payload.path)
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
		onFolderDrop: (path) => store.open_local_workspace(path),
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
		<WorkspaceWindow />
		<QuotaWallDialog />
		<BridgeDialog />
		<PasswordDialog />
		<BulkRenameDialog />
		<SummaryDialog />
		<AiConsentDialog />
		<UpdateBanner />
	</UApp>
</template>
