<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { AppWindow } from '@/domain/Desktop'
import desktops from '@/store/desktops'
import store from '@/store'
import { workspace_registry } from '@/store/workspaceRegistry'
import desktop_children from '@/store/desktopChildren'
import { is_desktop } from '@/isDesktop'
import {
	listenFolderDrop,
	type DroppedFilesPayload,
	type DroppedFolderPayload,
} from '@/services/workspace/listenFolderDrop'
import { listenOpenedPaths } from '@/services/workspace/listenOpenedPaths'
import { resolvePanePosition } from '@/ui/workspace/folder-container/panePosition'
import WorkspaceWindow from '@/ui/workspace/WorkspaceWindow.vue'
import Window from '@/ui/window/Window.vue'
import DesktopSurface from './DesktopSurface.vue'
import DesktopTabs from './DesktopTabs.vue'
import RemoveDesktopModal from './RemoveDesktopModal.vue'
import Taskbar from './Taskbar.vue'
import QuotaWallDialog from '@/ui/workspace/sidebar/QuotaWallDialog.vue'
import BridgeDialog from '@/ui/workspace/sidebar/BridgeDialog.vue'
import UpdateBanner from './UpdateBanner.vue'
import PasswordDialog from '@/ui/workspace/sidebar/workspaces-list/PasswordDialog.vue'
import { desktops_enabled } from '@/store/experiments'

// App root: two render modes. fullscreen = the classic single-workspace app;
// desktops = surfaces with floating windows, desktop tabs and a taskbar.
// A fullscreen-state window hides the desktop chrome entirely (and unmounts
// the other windows via the v-if below).
// Desktops are an opt-in experiment: with the switch off the window controls
// (the way into desktops mode) are hidden and Cmd/Alt+N does nothing.
const show_controls = computed(() => desktops_enabled.value)

const mode = computed(() => desktops.mode)
// A saved selection may point at a cloud desktop that has not been fetched
// yet (or cannot be, while offline). Show a desktop that is already in
// memory so local windows start opening.
const selected_desktop = computed(() =>
	desktops.selected_desktop ?? desktops.desktops[0] ?? null,
)
const fullscreen_window = computed(() =>
	selected_desktop.value?.windows.find(w => w.state === 'fullscreen') ?? null,
)

const { macOS } = useKbd()
defineShortcuts(computed(() => ({
	// Cmd+N on macOS; Alt+N elsewhere (Nuxt UI maps meta→ctrl on non-Mac, so branch explicitly).
	[macOS.value ? 'meta_n' : 'alt_n']: () => {
		if (!desktops_enabled.value) return
		if (desktops.mode !== 'desktops') store.enter_desktops_mode()
		desktops.open_window({ kind: 'empty' })
	},
})))

// OS-level drop/open events live here (the shell never unmounts); embedded
// WorkspaceWindow instances handle browser drops through their own DOM.
const dragOver = ref(false)

/** Top-most app window under the cursor; null = bare desktop surface. */
function window_at(x: number, y: number): AppWindow | null {
	for (const el of document.elementsFromPoint(x, y)) {
		if (!(el instanceof HTMLElement)) continue
		const id = el.closest('[data-window-id]')?.getAttribute('data-window-id')
		if (!id) continue
		const found = selected_desktop.value?.windows.find(w => w.id === id)
		if (found && found.state !== 'minimized') return found
	}
	return null
}

function on_folder_drop(payload: DroppedFolderPayload) {
	// desktops mode: drop on a window → open the folder in that window;
	// drop on the bare surface → new window (same as Start menu)
	if (mode.value === 'desktops') {
		const window = payload.client ? window_at(payload.client.x, payload.client.y) : null
		if (window) {
			void store.open_local_workspace(payload.path, { replace_window_id: window.id })
			return
		}
		void store.open_local_workspace(payload.path, { as_new_window: true })
		return
	}
	void store.open_local_workspace(payload.path)
}

function on_files_drop(payload: DroppedFilesPayload) {
	// desktops mode: the window under the cursor receives the files; a drop on
	// the bare surface imports into the desktop children folder (the board
	// under the windows)
	if (mode.value === 'desktops') {
		const window = payload.client ? window_at(payload.client.x, payload.client.y) : null
		if (!window) {
			void import_to_desktop(payload)
			return
		}
		const workspace = workspace_registry.get(window.id)
		if (!workspace) {
			store.last_error = 'Drop files onto an open window'
			return
		}
		if (!workspace.can_write) return
		// the board position resolver is a global singleton and may belong to
		// another window's board — the widget may land at a default position
		void workspace.import_external_files(payload.paths, payload.position ?? undefined)
		return
	}
	const workspace = store.workspace
	if (!workspace) {
		store.last_error = 'Open a folder before importing files'
		return
	}
	if (!workspace.can_write) return
	void workspace.import_external_files(payload.paths, payload.position ?? undefined)
}

/** Drop on the bare desktop surface → import into the desktop children folder. */
async function import_to_desktop(payload: DroppedFilesPayload) {
	const desktop = selected_desktop.value
	const workspace = desktop ? await desktop_children.get_store(desktop) : null
	if (!workspace) {
		// web v1: desktop children are unavailable
		store.last_error = 'Drop files onto an open window'
		return
	}
	if (!workspace.can_write) return
	// resolve against the desktop board's own pane (payload.position comes
	// from a global singleton resolver that may belong to another board)
	const position = payload.client
		? resolvePanePosition(workspace.id, payload.client.x, payload.client.y)
		: null
	void workspace.import_external_files(payload.paths, position ?? undefined)
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
		<WorkspaceWindow v-if="mode === 'fullscreen'" :show_controls />
		<div v-else class="relative flex h-svh w-full flex-col overflow-hidden bg-default">
			<template v-if="fullscreen_window && selected_desktop">
				<Window
					:key="fullscreen_window.id"
					:window="fullscreen_window"
					:desktop="selected_desktop"
					class="min-h-0 flex-1"
				/>
			</template>
			<template v-else-if="selected_desktop">
				<DesktopTabs />
				<div class="relative min-h-0 w-full flex-1 overflow-hidden">
					<DesktopSurface :desktop="selected_desktop" />
					<Taskbar />
				</div>
			</template>
			<RemoveDesktopModal />
		</div>
		<QuotaWallDialog />
		<BridgeDialog />
		<PasswordDialog />
		<UpdateBanner />
	</UApp>
</template>
