<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'
import { locale, t } from '@/i18n'
import store from '@/store'
import { is_desktop } from '@/isDesktop'
import { report_error } from '@/store/helpers/reportError'
import { explorer_public_open } from '@/store/explorer/public_view'
import { add_bookmark } from '@/store/explorer/bookmarks'
import { explorer_navigation } from '@/store/explorer/navigation'
import { has_unsaved_writes } from '@/services/workspace/xattrs'
import { local_bookmark_ref, point_in_rect } from '@/ui/explorer/top-bar/folderDrop'
import type { ClientPoint } from '@/services/workspace/dropClientPosition'
import {
	listenFolderDrop,
	type DroppedFilesPayload,
	type DroppedFolderPayload,
} from '@/services/workspace/listenFolderDrop'
import { listenOpenedPaths } from '@/services/workspace/listenOpenedPaths'
import ExplorerShell from '@/ui/explorer/ExplorerShell.vue'
import PublicScreen from '@/ui/explorer/pages/PublicScreen.vue'
import QuotaWallDialog from '@/ui/workspace/sidebar/QuotaWallDialog.vue'
import UpdateBanner from '@/ui/app/UpdateBanner.vue'
import SyncKeptHiddenToast from '@/ui/workspace/sidebar/SyncKeptHiddenToast.vue'
import PasswordDialog from '@/ui/workspace/sidebar/workspaces-list/PasswordDialog.vue'
import AiConsentDialog from '@/ui/ai/AiConsentDialog.vue'
import BulkRenameDialog from '@/ui/ai/BulkRenameDialog.vue'
import SummaryDialog from '@/ui/ai/SummaryDialog.vue'

// OS-level drop and open events live here: the shell never unmounts.
const dragOver = ref(false)
const overBar = ref(false)
const barBox = ref<{ top: number, left: number, width: number, height: number } | null>(null)

// The document language follows the Explorer. AppShell stays mounted, so a
// screen swap cannot put the start language back.
watchEffect(() => {
	document.documentElement.lang = locale.value
})

function on_folder_drop(payload: DroppedFolderPayload) {
	if (point_in_rect(payload.client, top_bar_rect())) {
		void bookmark_dropped_folder(payload.path).catch(error => report_error(store, error))
		return
	}
	void open_dropped_folder(payload.path)
}

function top_bar_rect() {
	const bar = document.querySelector('.explorer .bb')
	return bar ? bar.getBoundingClientRect() : null
}

function measure_bar() {
	const rect = top_bar_rect()
	barBox.value = rect
		? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
		: null
	return rect
}

function on_drag_move(client: ClientPoint) {
	overBar.value = point_in_rect(client, measure_bar())
}

const bodyPad = computed(() => {
	const bar = barBox.value
	return bar ? { paddingTop: `${bar.top + bar.height}px` } : undefined
})

watch(dragOver, (on) => {
	if (on) {
		measure_bar()
		return
	}
	overBar.value = false
	barBox.value = null
})

async function bookmark_dropped_folder(path: string) {
	const { homeDir } = await import('@tauri-apps/api/path')
	add_bookmark(local_bookmark_ref(path, await homeDir()))
}

function open_dropped_folder(path: string): Promise<void> {
	return Promise.resolve(explorer_navigation.open_local_path(path)).catch(error => report_error(store, error))
}

/** A .pile unpacks into a folder the person picks, then opens as a folder of its own */
async function open_pile(path: string) {
	const unpacked = await store.unpack_workspace_pack(path)
	if (unpacked) await open_dropped_folder(unpacked.root)
}

function on_files_drop(payload: DroppedFilesPayload) {
	// A cloud folder is opening: the folder on screen is not where the files would go
	if (explorer_navigation.target) return
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

// A look change or a picture is on screen before it reaches the cloud:
// closing the tab meanwhile would lose it, so the browser asks first
function warn_unsaved(event: BeforeUnloadEvent) {
	if (!has_unsaved_writes()) return
	event.preventDefault()
	event.returnValue = ''
}
onMounted(() => { window.addEventListener('beforeunload', warn_unsaved) })
onUnmounted(() => { window.removeEventListener('beforeunload', warn_unsaved) })

onMounted(async () => {
	if (!is_desktop) return
	unlistenDrop = await listenFolderDrop({
		onFolderDrop: on_folder_drop,
		onFilesDrop: on_files_drop,
		onPileOpen: (path) => { void open_pile(path) },
		onError: (message) => { store.last_error = message },
		dragOver,
		onDragMove: on_drag_move,
	})
	unlistenOpened = await listenOpenedPaths({
		onFolderDrop: (path) => open_dropped_folder(path),
		onPileOpen: (path) => { void open_pile(path) },
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
			<div v-if="dragOver" class="drop-veil">
				<div class="drop-body" :class="{ hot: !overBar }" :style="bodyPad">
					<p class="main">{{ t('drop.open') }}</p>
					<p class="more">{{ t('drop.open_more') }}</p>
				</div>
				<div
					v-if="barBox"
					class="drop-bar"
					:class="{ hot: overBar }"
					:style="{ top: `${barBox.top}px`, left: `${barBox.left}px`, width: `${barBox.width}px`, height: `${barBox.height}px` }"
				>
					{{ t('drop.bookmark') }}
				</div>
			</div>
		</Teleport>
		<SyncKeptHiddenToast />
		<!-- The Explorer, or the invitation and missing-publication screen in its place. -->
		<ExplorerShell v-if="!explorer_public_open" />
		<PublicScreen v-else />
		<QuotaWallDialog />
		<PasswordDialog />
		<BulkRenameDialog />
		<SummaryDialog />
		<AiConsentDialog />
		<UpdateBanner />
	</UApp>
</template>

<style scoped>
.drop-veil {
	position: fixed;
	inset: 0;
	z-index: 9999;
	pointer-events: none;
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
.drop-body {
	position: absolute;
	inset: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 6px;
	padding: 24px;
	box-sizing: border-box;
	text-align: center;
	background: rgba(248, 248, 247, 0.55);
	border: 2px dashed #85B7EB;
	color: #5F5E5A;
}
.drop-body.hot {
	background: rgba(248, 248, 247, 0.78);
	color: #1F1F1E;
}
.drop-body .main,
.drop-body .more {
	margin: 0;
}
.drop-body .main {
	font-size: 15px;
	font-weight: 500;
}
.drop-body .more {
	font-size: 13px;
	color: #9A9893;
}
.drop-bar {
	position: fixed;
	z-index: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	box-sizing: border-box;
	padding: 0 16px;
	border: 2px dashed #378ADD;
	background: rgba(230, 241, 251, 0.9);
	color: #185FA5;
	font-size: 13px;
	font-weight: 600;
	white-space: nowrap;
}
.drop-bar.hot {
	border-style: solid;
	background: rgba(230, 241, 251, 0.96);
}
</style>
