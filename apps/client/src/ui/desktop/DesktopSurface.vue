<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Desktop } from '@/domain/Desktop'
import type { WorkspaceStore } from '@/domain/Store'
import desktops from '@/store/desktops'
import desktop_children from '@/store/desktopChildren'
import { workspace_registry } from '@/store/workspaceRegistry'
import { provideWorkspaceStore } from '@/ui/workspace/useWorkspace'
import {
	createScopeFromStore,
	provideFolderContainerScope,
} from '@/ui/workspace/folder-container/useFolderContainerScope'
import { provideBoardPlacement } from '@/ui/workspace/folder-container/board/boardShapePlacement'
import { resolvePanePosition } from '@/ui/workspace/folder-container/panePosition'
import { useClipboardShortcuts } from '@/ui/workspace/folder-container/useClipboardShortcuts'
import { is_desktop } from '@/isDesktop'
import { CLOUD_DESKTOP_OFFLINE } from '@/services/cloud/client'
import Board from '@/ui/workspace/folder-container/board/Board.vue'
import ClipboardBanner from '@/ui/workspace/folder-container/ClipboardBanner.vue'
import ImportProgressOverlay from '@/ui/workspace/folder-container/ImportProgressOverlay.vue'
import Window from '@/ui/window/Window.vue'
import { backgroundStyle } from '@/ui/workspace/folder-container/widgets/resolveBackground'
import BackgroundValueMenuSlot from '@/ui/workspace/menu/BackgroundValueMenuSlot.vue'
import ColorPickerMenuSlot from '@/ui/workspace/menu/ColorPickerMenuSlot.vue'
import MenuSwatchDot from '@/ui/workspace/menu/MenuSwatchDot.vue'
import PresetColorsMenuSlot from '@/ui/workspace/menu/PresetColorsMenuSlot.vue'
import { useDesktopMenuItems } from './useDesktopMenuItems'
import cloud from '@/store/cloud'
import { cloud_board_epoch } from '@/store/cloudBoardReload'
import type { BridgeSource } from '@/store/bridge'
import { parent_folder_id_from_node_id, path_separator } from '@/services/workspace/paths'

const props = defineProps<{
	desktop: Desktop
}>()

// Windows live only in the desktops store; files/folders (children) live in
// the desktop's own folder (Tauri) and render as a board under the windows.
const windows = computed(() => props.desktop.windows)

const children_store = ref<WorkspaceStore | null>(null)
const children_workspace = computed(() => children_store.value)
const importProgress = computed(() => children_store.value?.import_progress ?? null)

async function load_children() {
	children_store.value = await desktop_children.get_store(props.desktop)
}

watch(
	() => props.desktop.id,
	async () => {
		children_store.value = null
		await load_children()
	},
	{ immediate: true },
)
// Session recovered or the browser came online: a cloud board that failed
// to open tries again. A board that is already open is left as it is.
watch(cloud_board_epoch, () => {
	if (props.desktop.backend !== 'cloud' || children_store.value) return
	void load_children()
})

const cloud_board_offline = computed(() =>
	props.desktop.backend === 'cloud'
	&& !!cloud.user
	&& !children_store.value
	&& !desktop_children.is_loading(props.desktop.id),
)

function retry_cloud_board() {
	void load_children()
}
provideWorkspaceStore(children_workspace)

// Board-level clipboard shortcuts (cut/copy of selected widgets, paste of the
// board's own clipboard). Selection actions: the focused window's listener
// wins while it has a selection — clicking board widgets clears window
// selections. Paste: exactly one handler may fire, and the focused window
// owns it; the board pastes via keyboard only when no window is focused
// (the banner's "Paste here" stays available regardless).
useClipboardShortcuts(children_workspace, (action) => {
	const board = children_store.value
	if (!board) return false
	const focused = workspace_registry.focused_workspace()
	if (action === 'paste') return !focused
	if (focused && focused.selection.length > 0) return false
	return board.selection.length > 0 || !focused
})

function apply_desktop_background(value: string) {
	desktops.update_desktop_xattrs(props.desktop.id, {
		background: value.trim() || undefined,
	})
}

// Clicking the board (background or a widget — mouse events bubble) moves
// the keyboard focus from windows to the desktop, so global shortcuts
// (Cmd+V paste, …) target the board. Clicks inside app windows never reach
// this handler's target check and keep their own focus.
function onSurfacePointerDown(event: PointerEvent) {
	if (event.target instanceof Element && event.target.closest('[data-window-id]')) return
	desktops.focus_board(props.desktop.id)
}

// Web only: dropping OS files onto the bare board imports them into the
// desktop children root (Tauri routes drops through listenFolderDrop in
// DesktopShell instead). Windows above the board swallow their own drops.
function on_surface_dragover(event: DragEvent) {
	if (is_desktop) return
	if (event.target instanceof Element && event.target.closest('[data-window-id]')) return
	if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
}

function on_surface_drop(event: DragEvent) {
	if (is_desktop) return
	// drops land on the window under the cursor too (events bubble) — the
	// window's own handler imports them
	if (event.target instanceof Element && event.target.closest('[data-window-id]')) return
	const files = [...(event.dataTransfer?.files ?? [])]
	if (files.length === 0) return
	event.preventDefault()
	const board = children_store.value
	if (!board || !board.can_write) return
	// resolve against this board's own pane — the global singleton resolver
	// may belong to an open window's board
	const position = resolvePanePosition(board.id, event.clientX, event.clientY)
	void board.import_files(board.id, files, position ?? undefined)
}

const {
	standalone_items,
	grid_size,
	on_grid_size_change,
	pickerColor,
	onPickerPointerDown,
	commitPickerColor,
	customValue,
	commitCustomValue,
	applyColor,
} = useDesktopMenuItems(() => props.desktop)

const desktop_background = computed(() => props.desktop.xattrs.background)

// local desktops: a top-level folder opens as its own workspace window, so it
// is a workspace tile too — its menu copies the whole workspace to the cloud
function local_tile_at(node_id: string): BridgeSource | null {
	const desktop_store = children_store.value
	if (!desktop_store || props.desktop.backend !== 'local' || !cloud.is_configured) return null
	if (desktop_store.type !== 'local' && desktop_store.type !== 'browser') return null
	const root = desktop_store.id
	if (node_id === root || parent_folder_id_from_node_id(node_id, root) !== root) return null
	return {
		type: desktop_store.type,
		id: node_id,
		name: node_id.slice(node_id.lastIndexOf(path_separator(node_id)) + 1),
	}
}

provideFolderContainerScope(
	createScopeFromStore({
		fixedView: 'board',
		backgroundOverride: {
			current: desktop_background,
			apply: apply_desktop_background,
		},
		// cloud desktop boards: workspace tiles get the workspace menu
		// (open/rename/publish/share/remove) instead of the folder menu
		workspaceTileAt: (id) => desktop_children.workspace_tile_at(id),
		localTileAt: local_tile_at,
		// same-setup provideWorkspaceStore is invisible to inject() here —
		// pass the workspace explicitly or the scope reads the global store
		workspace: children_workspace,
	}),
)
// normally provided by WorkspaceWindow — the surface plays that role for the
// desktop board (shape placement state for Board + FolderContainerCtxMenu)
provideBoardPlacement()

// The children store is not store.workspace — surface its errors here,
// same as WorkspaceWindow does for window stores
const toast = useToast()
watch(
	() => children_store.value?.last_error,
	(message) => {
		if (!message) return
		toast.add({
			title: 'Error',
			description: message,
			color: 'error',
			icon: 'mdi:alert-circle-outline',
		})
		children_store.value?.clear_error()
	},
)

// background is a plain string: a CSS color or an https:/file: image URL
const surface_style = computed(() => backgroundStyle(props.desktop.xattrs.background))
</script>

<template>
	<div
		class="desktop-surface relative h-full w-full overflow-hidden bg-elevated"
		:style="surface_style"
		@pointerdown="onSurfacePointerDown"
		@dragover="on_surface_dragover"
		@drop="on_surface_drop"
	>
		<UContextMenu
			v-if="!children_store"
			:items="standalone_items"
			:ui="{ content: 'min-w-56' }"
		>
			<div class="h-full w-full">
				<div
					v-if="cloud_board_offline"
					class="pointer-events-auto absolute left-1/2 top-4 flex -translate-x-1/2 flex-col items-center gap-2 rounded-lg border border-default bg-default px-4 py-3 text-center text-sm shadow-lg"
				>
					<p>{{ CLOUD_DESKTOP_OFFLINE }}</p>
					<UButton size="xs" variant="soft" label="Retry" @click.stop="retry_cloud_board" />
				</div>
				<Window
					v-for="window in windows"
					:key="window.id"
					:window="window"
					:desktop="desktop"
					:style="{ zIndex: window.z }"
				/>
			</div>
			<template #item-leading="{ item }">
				<MenuSwatchDot :color="(item as { swatch?: string }).swatch" />
			</template>
			<template #preset-colors>
				<PresetColorsMenuSlot :apply-color="applyColor" />
			</template>
			<template #color-picker>
				<ColorPickerMenuSlot
					v-model="pickerColor"
					:on-picker-pointer-down="onPickerPointerDown"
					:commit-picker-color="commitPickerColor"
					:show-hex-input="false"
				/>
			</template>
			<template #background-value>
				<BackgroundValueMenuSlot
					v-model="customValue"
					:commit-custom-value="commitCustomValue"
				/>
			</template>
			<template #grid-size-trailing>
				<UInput
					:model-value="grid_size"
					type="number"
					min="1"
					class="w-16"
					@click.stop
					@keydown.stop
					@update:model-value="on_grid_size_change"
				/>
			</template>
		</UContextMenu>

		<template v-else>
			<div :key="desktop.id" class="absolute inset-0 z-0">
				<Board />
			</div>
			<Window
				v-for="window in windows"
				:key="window.id"
				:window="window"
				:desktop="desktop"
				:style="{ zIndex: window.z }"
			/>
			<ClipboardBanner above_taskbar />
			<ImportProgressOverlay :progress="importProgress" />
		</template>
	</div>
</template>
