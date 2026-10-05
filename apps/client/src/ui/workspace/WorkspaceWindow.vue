<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import { useMediaQuery } from '@vueuse/core'
import Sidebar from './sidebar/Sidebar.vue'
import PublishDialog from './sidebar/PublishDialog.vue'
import ShareDialog from './sidebar/ShareDialog.vue'
import TrashDialog from './sidebar/TrashDialog.vue'
import { workspaceDialogsKey } from './sidebar/workspaceDialogs'
import AccountPanel from './sidebar/workspaces-list/AccountPanel.vue'
import WorkspacesPopover from './sidebar/workspaces-list/WorkspacesPopover.vue'
import FolderContainer from './folder-container/FolderContainer.vue'
import FolderChrome from './folder-container/FolderChrome.vue'
import FolderChromeActionButton from './folder-container/FolderChromeActionButton.vue'
import ClipboardBanner from './folder-container/ClipboardBanner.vue'
import { provideFolderContainerScope, createScopeFromStore } from './folder-container/useFolderContainerScope'
import { provideBoardPlacement } from './folder-container/board/boardShapePlacement'
import { useClipboardShortcuts } from './folder-container/useClipboardShortcuts'
import { resolve_public_route } from '@/services/publicRoute'
import HubView from '@/ui/hub/HubView.vue'
import HubReportButton from '@/ui/hub/HubReportButton.vue'
import ProfileView from '@/ui/hub/ProfileView.vue'
import InviteView from '@/ui/workspace/InviteView.vue'
import { hub_open } from '@/ui/hub/hubUi'
import { resolveExternalDropPosition } from '@/ui/workspace/folder-container/externalDropPosition'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import WindowControls from '@/ui/window/WindowControls.vue'
import { useWindowContext } from '@/ui/window/windowContext'
import desktops from '@/store/desktops'
import { desktops_enabled } from '@/store/experiments'
import bridge, { take_bridge_intent } from '@/store/bridge'
import type { WorkspaceTab } from '@/domain/Store'
import ImportProgressOverlay from '@/ui/workspace/folder-container/ImportProgressOverlay.vue'

const workspace = useWorkspace()
const scope = createScopeFromStore()
provideFolderContainerScope(scope)
provideBoardPlacement()
// every window mounts this listener; only the focused one may act
// (in desktops mode store.workspace is the focused window's store)
useClipboardShortcuts(workspace, () => workspace.value === store.workspace)

const folderView = computed(() => scope.container.value?.view ?? 'list')
const has_multi_selection = computed(() => {
	const ws = workspace.value
	const children = scope.container.value?.children ?? []
	if (!ws) return false
	const childIds = new Set(children.map(child => child.id))
	return ws.selection.filter(id => childIds.has(id)).length >= 2
})

// Cloud root folders have an empty name (rpc create_workspace); at the root
// show the workspace name instead, deeper — the folder name. The name reads
// from the folders cache so renames (apply_id_changed rekeys it) stay reactive.
const tab_title = (tab: WorkspaceTab) => {
	const ws = workspace.value
	if (!ws) return ''
	return tab.folder_id === ws.id ? ws.name : (ws.folders[tab.folder_id]?.name ?? '')
}

const props = withDefaults(
	defineProps<{
		show_controls: boolean
		/** Rendered inside an app Window: no OS-level listeners, no viewport sizing. */
		embedded?: boolean
	}>(),
	{ embedded: false },
)

// App fullscreen root (no enclosing window) or a fullscreen-state window:
// WindowControls live in this header. Floating windows carry them in their
// own chrome instead (Window.vue). Hidden on phones/tablets — desktops-mode
// chrome is for mouse/trackpad, even when the viewport is iPad-landscape wide.
const window_context = useWindowContext()
const window_load_error = computed(() => window_context?.load_error.value ?? null)
const is_local_window_workspace = computed(() => {
	const content = window_context?.content.value
	return content?.kind === 'workspace' && content.item.type === 'local'
})
const is_slug_window = computed(() => window_context?.content.value.kind === 'slug')
const isCoarsePointer = useMediaQuery('(pointer: coarse)')
// The fullscreen app root shows them only with the desktops experiment on
// (store/experiments.ts): its Toggle fullscreen button is the way into
// desktops mode.
const show_window_controls = computed(
	() => !isCoarsePointer.value && (window_context
		? window_context.state.value === 'fullscreen'
		: desktops_enabled.value),
)

const toast = useToast()
const dragOver = ref(false)
const importProgress = computed(() => workspace.value?.import_progress ?? null)

// Fullscreen: store.is_workspace_loading. Desktops: Window.vue's loading ref
// (load_workspace returns before the store exists, so the global flag never
// flips). Shown both for the first open and when replacing the current workspace.
const workspace_loading = computed(() =>
	store.is_workspace_loading || !!window_context?.loading.value,
)

// Header spinner next to the folder title: shown only when opening a folder
// takes a while (warm cloud reads are ~100ms, cold ones reach seconds) —
// the delay keeps fast navigations flicker-free
const folderOpening = computed(() => !!workspace.value?.opening_folder_id)
const showOpeningSpinner = ref(false)
let openingSpinnerTimer: ReturnType<typeof setTimeout> | null = null
watch(folderOpening, (opening) => {
	if (openingSpinnerTimer) {
		clearTimeout(openingSpinnerTimer)
		openingSpinnerTimer = null
	}
	if (opening) {
		openingSpinnerTimer = setTimeout(() => {
			showOpeningSpinner.value = true
		}, 250)
	} else {
		showOpeningSpinner.value = false
	}
})
const sidebarOpen = ref(false)
const sidebarCollapsed = ref(false)
const publish_dialog = ref<InstanceType<typeof PublishDialog>>()
const share_dialog = ref<InstanceType<typeof ShareDialog>>()
const trash_dialog = ref<InstanceType<typeof TrashDialog>>()

/** Drawer + UModal both set body pointer-events:none; overlapping them can
 *  snapshot `none` as the restore value, so header taps do nothing afterwards. */
function unlock_document_pointers() {
	const clear = () => document.body.style.removeProperty('pointer-events')
	clear()
	requestAnimationFrame(clear)
	window.setTimeout(clear, 0)
}

function open_workspace_dialog(open: () => void) {
	const wait_for_drawer = useDrawerSidebar.value && sidebarOpen.value
	sidebarOpen.value = false
	if (!wait_for_drawer) {
		open()
		return
	}
	void nextTick(() => {
		unlock_document_pointers()
		open()
	})
}

// Dialogs sit outside UDashboardSidebar: on mobile that sidebar is a Vaul
// drawer, and a nested UModal cannot focus inputs (drawer preventDefault()s
// pointerdown on the portaled dialog).
provide(workspaceDialogsKey, {
	open_publish: (id) => open_workspace_dialog(() => publish_dialog.value?.open(id)),
	open_share: (id) => open_workspace_dialog(() => share_dialog.value?.open(id)),
	open_trash: (id) => open_workspace_dialog(() => trash_dialog.value?.open(id)),
})

// A local workspace just copied into the cloud opens here: finish what the
// copy started from (Share, Publish) and say the local workspace stayed as it was
function consume_bridge_intent() {
	const ws = workspace.value
	if (ws?.type !== 'cloud') return
	const intent = take_bridge_intent(ws.uid)
	if (!intent) return
	toast.add({
		title: 'Copied to the cloud',
		description: intent.door === 'device'
			? 'Your local workspace is unchanged. Sign in with this account on the other device to open it.'
			: 'Your local workspace is unchanged.',
		color: 'success',
		icon: 'i-lucide:cloud-upload',
	})
	if (intent.door === 'share') open_workspace_dialog(() => share_dialog.value?.open(ws.uid))
	if (intent.door === 'publish') open_workspace_dialog(() => publish_dialog.value?.open(ws.uid))
}
watch(() => [workspace.value?.uid, bridge.pending_intent] as const, consume_bridge_intent)
onMounted(consume_bridge_intent)
// Public routes (/demo, /hub, /<username>, /<username>/<slug>) open content
// directly — the workspaces modal must not pop over the loading screen
const public_route = resolve_public_route(window.location.pathname)
const is_public_route = public_route.kind !== 'app'
// Gallery routes (/hub, /<username>) render a standalone page: no sidebar,
// no workspace panel — just the header and the view. Opening a workspace from
// a gallery card (profile → publication) flips to the regular workspace layout.
// Embedded windows keep the in-app chrome even when the address bar still
// holds /hub or /username (window-fullscreen keeps the public path).
const gallery_mode = ref(
	!props.embedded && (
		public_route.kind === 'hub'
		|| public_route.kind === 'profile'
		|| public_route.kind === 'invite'
	),
)
// Embedded windows load their workspace asynchronously via the registry;
// the workspaces modal must not flash over the loading state
const wsListOpen = ref(!props.embedded && !workspace.value && !is_public_route)
/** Sign-in / My account modal on public and gallery routes — separate from the workspaces popover. */
const accountOpen = ref(false)

// Public /<username>/<slug> page: the sidebar (workspace tree) stays for
// navigation. Sign in opens the account modal (AuthForm lives inside).
// publication_view is a global singleton — in desktops mode only the slug
// window shows the public chrome.
const is_public_window = computed(
	() => !window_context || window_context.content.value.kind === 'slug',
)
const public_view = computed(() => (is_public_window.value ? cloud.publication_view : null))
const public_not_found = computed(() => (is_public_window.value ? cloud.public_not_found : null))
const public_mode = computed(() => !!public_view.value || !!public_not_found.value)
/** Public URL view or a privately shared viewer — mutations are gated in the store. */
const view_only = computed(() => !!workspace.value && !workspace.value.can_write)

/** Fullscreen app: Hub replaces the folder panel, header popover stays. */
const app_hub_open = ref(false)
// Fullscreen in-app navigation (Hub cards) fills cloud.profile_view without a
// window to host it — the fullscreen root derives the profile view from the store.
const showing_profile = computed(() =>
	window_context
		? window_context.content.value.kind === 'profile'
		: !!cloud.profile_view || !!cloud.profile_not_found,
)
/** Fullscreen in-place Hub, or a window whose content is `{ kind: 'hub' }`. */
const showing_hub = computed(
	() =>
		!showing_profile.value
		&& !public_mode.value
		&& (app_hub_open.value || hub_open.value || window_context?.content.value.kind === 'hub'),
)
/** Hub or profile: no sidebar, no folder tabs — just the header and the view. */
const showing_catalog = computed(
	() => showing_hub.value || showing_profile.value,
)
/** Catalog views have no workspace panel under them — the badge would be stale. */
const show_view_only = computed(() => view_only.value && !showing_catalog.value)
// Below md: overlay drawer (browser, Tauri, and phone). Wider: inline sidebar.
const isNarrowViewport = useMediaQuery('(max-width: 767px)')
const useDrawerSidebar = computed(() => isNarrowViewport.value)
// Touch phones/tablets: Select lives on the right of the header (window
// controls are hidden there). Folder previews do not get this button.
const show_touch_select = computed(
	() => isCoarsePointer.value
		&& !!workspace.value?.can_write
		&& !workspace.value?.selection_mode
		&& folderView.value !== 'canvas'
		&& !showing_catalog.value
		&& !public_mode.value,
)

function go_home() {
	window.location.href = '/'
}

function open_sign_in() {
	accountOpen.value = true
}

const forking = ref(false)
const fork_label = computed(() =>
	public_view.value && public_view.value.fork_count > 0
		? `Fork (${public_view.value.fork_count})`
		: 'Fork',
)

async function fork() {
	if (!public_view.value || forking.value) return
	// forking needs an account to copy into; the account modal carries AuthForm
	if (!cloud.user) {
		open_sign_in()
		return
	}
	forking.value = true
	try {
		await cloud.fork()
	} finally {
		forking.value = false
	}
}

const downloading = ref(false)
const hub_report = ref<{ start_report: () => void } | null>(null)
const hub_report_visible = ref(false)

const public_actions_items = computed<DropdownMenuItem[]>(() => {
	const view = public_view.value
	if (!view) return []
	const items: DropdownMenuItem[] = []
	if (view.can_edit_source) {
		items.push({
			label: 'Edit',
			icon: 'i-lucide:square-pen',
			onSelect: () => {
				void cloud.open_source_for_edit()
			},
		})
	} else if (show_view_only.value) {
		items.push({
			label: 'View only',
			disabled: true,
		})
	}
	if (view.can_fork && !view.can_edit_source) {
		items.push({
			label: fork_label.value,
			icon: 'i-lucide:git-fork',
			disabled: forking.value,
			onSelect: () => {
				void fork()
			},
		})
		items.push({
			label: 'Download as .pile',
			icon: 'i-lucide:download',
			disabled: !workspace.value || downloading.value,
			onSelect: () => {
				void download_pile()
			},
		})
	}
	if (!view.can_edit_source && hub_report_visible.value) {
		items.push({
			label: 'Report',
			icon: 'i-lucide:flag',
			onSelect: () => hub_report.value?.start_report(),
		})
	}
	return items
})

// Download as .pile takes an account, like a fork: the originals are charged
// to whoever downloads them, never to the author
async function download_pile() {
	const ws = workspace.value
	if (!public_view.value?.can_fork || !ws || downloading.value) return
	if (!cloud.user) {
		open_sign_in()
		return
	}
	downloading.value = true
	try {
		await store.download_public_workspace(ws)
	} finally {
		downloading.value = false
	}
}

function open_app_hub() {
	// entering the catalog leaves the publication/profile views behind —
	// otherwise their chrome (Fork, Back to Hub) stays over the Hub
	cloud.publication_view = null
	cloud.public_not_found = null
	cloud.profile_view = null
	cloud.profile_not_found = null
	app_hub_open.value = true
	// shared flag so exiting fullscreen can open a Hub window
	hub_open.value = true
	void cloud.fetch_hub()
}

function back_to_hub() {
	if (window_context) {
		cloud.publication_view = null
		cloud.public_not_found = null
		desktops.set_window_content(window_context.window_id, { kind: 'hub' })
		if (window_context.state.value === 'fullscreen' && window.location.pathname !== '/hub') {
			history.pushState(null, '', '/hub')
		}
		return
	}
	open_app_hub()
}

function retry_window_load() {
	window_context?.retry_load()
}

function close_window() {
	if (window_context) desktops.close_window(window_context.window_id)
}

function prevent_open_autofocus(event: Event) {
	event.preventDefault()
}

watch(
	() => [workspace.value, store.is_workspace_loading, cloud.invite_view] as const,
	([ws, loading, invite]) => {
		if (ws) {
			wsListOpen.value = false
			// opening a workspace leaves the in-app Hub/profile/gallery views behind
			app_hub_open.value = false
			hub_open.value = false
			gallery_mode.value = false
			return
		}
		if (!invite && public_route.kind === 'invite' && loading) {
			gallery_mode.value = false
		}
		if (!loading && !public_mode.value && !showing_catalog.value && !gallery_mode.value && !props.embedded) {
			wsListOpen.value = true
		}
	},
)

function toggleSidebar(event?: Event) {
	if (!useDrawerSidebar.value) {
		sidebarCollapsed.value = !sidebarCollapsed.value
		return
	}
	const next = !sidebarOpen.value
	sidebarOpen.value = next
	// Drawer sets aria-hidden on #app; blur the toggle so focus is not trapped under it.
	if (next && event?.currentTarget instanceof HTMLElement) {
		event.currentTarget.blur()
	}
}

watch(useDrawerSidebar, (drawer) => {
	if (!drawer) sidebarOpen.value = false
})

const { macOS } = useKbd()

// svh-based sizing belongs to the fullscreen root; inside an app window the
// window's own box constrains the layout
const sidebar_ui = computed(() => {
	const drawer = useDrawerSidebar.value
	return {
		root: `relative ${drawer ? 'hidden' : 'flex'} flex-col ${props.embedded ? 'h-full' : 'min-h-svh'} w-(--width) shrink-0 overflow-hidden border-e border-default data-[collapsed=true]:min-w-0 data-[collapsed=true]:border-e-0`,
		header: 'p-0 h-auto items-stretch',
		body: 'p-0 gap-0 flex flex-col min-h-0 flex-1 overflow-hidden px-0 sm:px-0',
		handle: drawer ? 'hidden' : 'block',
		content: drawer
			? 'inset-y-0 left-0 h-svh max-h-svh rounded-none ring-0 shadow-none !w-[min(100vw,18rem)] !max-w-none'
			: 'hidden',
		overlay: drawer ? undefined : 'hidden',
	}
})

// Nuxt UI's DashboardGroup/DashboardPanel assume the viewport (`fixed inset-0`,
// `min-h-svh`); embedded in an app window they must fill the window's box instead
const dashboard_group_ui = computed(() =>
	props.embedded ? { base: 'absolute inset-0' } : undefined,
)
const dashboard_panel_ui = computed(() =>
	props.embedded ? { root: 'min-h-0' } : undefined,
)

defineShortcuts(computed(() => {
	if (!workspace.value) return {}
	// Cmd+B / Cmd+← on macOS; Alt+B / Alt+← elsewhere
	// (Nuxt UI maps meta→ctrl on non-Mac, so branch explicitly).
	return {
		[macOS.value ? 'meta_b' : 'alt_b']: () => {
			// one global listener per window — only the focused one reacts
			if (workspace.value !== store.workspace) return
			toggleSidebar()
		},
		[macOS.value ? 'meta_arrowleft' : 'alt_arrowleft']: () => {
			if (workspace.value !== store.workspace) return
			void workspace.value?.go_back()
		},
	}
}))

// Browser build: HTML5 drag&drop of files into the opened folder. The desktop
// build handles drops through Tauri events (listenFolderDrop) instead.
const on_browser_dragover = (event: DragEvent) => {
	if (is_desktop) return
	if (event.dataTransfer?.types.includes('Files')) dragOver.value = true
}
const on_browser_dragleave = (event: DragEvent) => {
	if (is_desktop) return
	// dragleave also fires when moving over children; leaving the window has no relatedTarget
	if (!event.relatedTarget) dragOver.value = false
}
const on_browser_drop = (event: DragEvent) => {
	if (is_desktop) return
	dragOver.value = false
	const files = [...(event.dataTransfer?.files ?? [])]
	if (files.length === 0) return
	if (!workspace.value) {
		store.last_error = 'Open a workspace before importing files'
		return
	}
	if (!workspace.value.can_write) return
	const position = resolveExternalDropPosition(event.clientX, event.clientY)
	void workspace.value.import_files(workspace.value.opened_folder_id, files, position ?? undefined)
}

onUnmounted(() => {
	if (openingSpinnerTimer) clearTimeout(openingSpinnerTimer)
})

watch(
	() => workspace.value?.last_error ?? store.last_error,
	(message) => {
		if (!message) return
		toast.add({
			title: 'Error',
			description: message,
			color: 'error',
			icon: 'mdi:alert-circle-outline',
		})
		workspace.value?.clear_error()
		store.clear_error()
	},
)
</script>

<template>
	<UApp>
		<div
			class="relative h-full min-h-0 min-w-0"
			:class="{ 'folder-drop-over': dragOver, 'min-h-svh': !embedded }"
			@dragover.prevent="on_browser_dragover"
			@dragleave="on_browser_dragleave"
			@drop.prevent="on_browser_drop"
		>
			<Teleport to="body">
				<div
					v-if="dragOver"
					class="pointer-events-none fixed inset-0 z-[9999] flex items-center justify-center border-2 border-dashed border-primary bg-default/60 text-sm text-default"
				>
					{{ is_desktop
						? 'Drop a folder to open, a .pile to import, or files into the workspace'
						: 'Drop files to import them into the opened folder' }}
				</div>
			</Teleport>
			<div v-if="gallery_mode && !public_mode" class="flex h-full flex-col" :class="{ 'min-h-svh': !embedded }">
				<header class="workspace-header flex shrink-0 items-center gap-2 border-b border-default px-4">
					<a href="/" class="text-sm font-semibold text-default">Pile Commander</a>
					<a
						v-if="public_route.kind === 'profile'"
						href="/hub"
						class="text-sm text-muted hover:text-default"
					>Hub</a>
					<div class="ml-auto flex shrink-0 items-center gap-2">
						<UButton
							v-if="cloud.user"
							label="Open the app"
							size="xs"
							color="neutral"
							variant="outline"
							@click="go_home"
						/>
						<UButton
							v-else
							label="Sign in"
							icon="i-lucide:log-in"
							size="xs"
							color="neutral"
							variant="outline"
							@click="open_sign_in"
						/>
						<!-- Public gallery for anonymous visitors: no app window chrome
						     (the fullscreen button would yank them into desktops mode) -->
						<WindowControls v-if="show_window_controls && cloud.user" />
					</div>
				</header>
				<div class="min-h-0 flex-1 overflow-y-auto">
					<InviteView v-if="cloud.invite_view" />
					<HubView v-else-if="(public_route.kind === 'hub' || showing_hub) && !showing_profile" />
					<ProfileView v-else />
				</div>
				<UModal
					v-model:open="accountOpen"
					title="My account"
					:content="{ onOpenAutoFocus: prevent_open_autofocus }"
				>
					<template #body>
						<AccountPanel />
					</template>
				</UModal>
			</div>
			<!-- panel sizes are persisted per window in desktops mode — a shared
			     key would make every window fight over the same sidebar width -->
			<UDashboardGroup
				v-else
				storage="local"
				:storage-key="window_context ? `workspace-${window_context.window_id}` : 'workspace'"
				unit="rem"
				:ui="dashboard_group_ui"
			>
				<UDashboardSidebar
					v-if="!showing_catalog"
					v-model:open="sidebarOpen"
					v-model:collapsed="sidebarCollapsed"
					mode="drawer"
					:menu="{
						direction: 'left',
						handle: false,
						inset: false,
						shouldScaleBackground: false,
					}"
					collapsible
					:collapsed-size="0"
					resizable
					:min-size="12"
					:default-size="18"
					:max-size="28"
				:ui="sidebar_ui"
				>
					<Sidebar :show_controls />
				</UDashboardSidebar>
				<UDashboardPanel :ui="dashboard_panel_ui">
					<div class="workspace-panel flex h-full flex-col" :class="{ 'min-h-svh': !embedded }">
						<header class="workspace-header flex shrink-0 items-center gap-1 border-b border-default px-2">
							<template v-if="!workspace?.selection_mode">
								<div class="flex shrink-0 items-center gap-1">
									<WorkspacesPopover
										v-model:open="wsListOpen"
										open_as="replace"
										:content="{ side: 'bottom', align: 'start', onOpenAutoFocus: prevent_open_autofocus }"
										@hub="open_app_hub"
										@opened="app_hub_open = false"
									>
										<UButton
											icon="boxicons:home-alt"
											color="neutral"
											:variant="wsListOpen ? 'soft' : 'ghost'"
											aria-label="Open workspaces"
										/>
									</WorkspacesPopover>
									<UIcon
										v-if="workspace_loading && !showing_catalog"
										name="i-lucide:loader-circle"
										class="size-4 shrink-0 animate-spin text-muted"
										aria-label="Loading workspace"
									/>
									<span
										v-else-if="!workspace && !showing_catalog && !public_mode"
										class="truncate text-sm text-muted"
									>Select workspace</span>
								</div>
								<template v-if="workspace && !showing_catalog">
								<UTooltip
									v-if="workspace"
									text="Toggle sidebar"
									:kbds="macOS ? ['meta', 'B'] : ['alt', 'B']"
									:ui="{ kbds: 'inline-flex' }"
								>
									<UButton
										icon="ri:node-tree"
										color="neutral"
										variant="ghost"
										class="shrink-0"
										aria-label="Toggle sidebar"
										@click="toggleSidebar"
									/>
								</UTooltip>
							<UTooltip
								v-if="workspace"
								text="Go back"
								:kbds="macOS ? ['meta', 'arrowleft'] : ['alt', 'arrowleft']"
								:ui="{ kbds: 'inline-flex' }"
							>
								<UButton
									icon="weui:back-filled"
									color="neutral"
									variant="ghost"
									class="shrink-0"
									aria-label="Go back"
									:disabled="!workspace.can_go_back"
									@click="workspace.go_back()"
								/>
							</UTooltip>
						<div
							v-if="workspace"
							class="workspace-tabs flex min-w-0 self-stretch items-stretch gap-0 border-s border-default max-md:border-s-0"
							role="tablist"
						>
							<div
								v-for="tab in workspace.tabs"
								:key="tab.id"
								class="workspace-tab flex min-w-0 cursor-pointer items-center gap-1 border-e border-default px-2 select-none max-md:border-e-0"
								:class="[
									tab.id === workspace?.active_tab_id
										? 'workspace-tab--active bg-default text-default max-md:bg-transparent'
										: 'text-muted hover:bg-default/60',
									has_multi_selection && tab.id === workspace?.active_tab_id
										? 'max-w-none'
										: 'max-w-64',
								]"
								role="tab"
								:aria-selected="tab.id === workspace?.active_tab_id"
								@click="void workspace?.activate_tab(tab.id)"
							>
								<span
									v-if="!(has_multi_selection && tab.id === workspace?.active_tab_id)"
									class="min-w-0 truncate text-sm font-medium p-1"
								>
									{{ tab_title(tab) }}
								</span>
								<UIcon
									v-if="showOpeningSpinner && tab.id === workspace?.active_tab_id && !has_multi_selection"
									name="i-lucide:loader-circle"
									class="size-4 shrink-0 animate-spin text-muted"
									aria-label="Loading folder"
								/>
								<span
									v-if="workspace?.can_write && tab.id === workspace?.active_tab_id"
									class="workspace-header-chrome"
									:class="{ 'workspace-header-chrome--selection': has_multi_selection }"
								>
									<FolderChrome :view="folderView" />
								</span>
								<UButton
									v-if="workspace && workspace.tabs.length > 1"
									class="workspace-tab-close"
									icon="i-lucide:x"
									color="neutral"
									variant="ghost"
									size="xs"
									aria-label="Close tab"
									@click.stop="void workspace?.close_tab(tab.id)"
								/>
							</div>
								</div>
								</template>
						</template>
						<span
							v-if="workspace && workspace.can_write && workspace.selection_mode"
							class="workspace-header-chrome workspace-header-chrome--selection"
						>
							<FolderChrome :view="folderView" />
						</span>
							<div
								v-if="show_view_only || public_mode || show_window_controls || show_touch_select"
								class="workspace-window-controls ml-auto flex shrink-0 items-center justify-end gap-2 self-stretch pl-3"
							>
								<UBadge
									v-if="show_view_only && !public_mode"
									label="View only"
									color="neutral"
									variant="subtle"
									size="sm"
								/>
								<template v-if="public_mode">
									<UDropdownMenu
										v-if="public_actions_items.length"
										:items="public_actions_items"
										:content="{ align: 'end' }"
									>
										<UButton
											:label="isNarrowViewport ? undefined : 'Actions'"
											icon="i-lucide:ellipsis"
											size="xs"
											color="neutral"
											variant="outline"
											aria-label="Actions"
										/>
									</UDropdownMenu>
									<HubReportButton
										v-if="public_view && !public_view.can_edit_source"
										:key="public_view.workspace_id"
										ref="hub_report"
										variant="modal"
										:workspace_id="public_view.workspace_id"
										:username="public_view.username"
										:slug="public_view.slug"
										:name="workspace?.name || public_view.slug"
										@visible-change="hub_report_visible = $event"
										@vue:unmounted="hub_report_visible = false"
									/>
									<UButton
										:label="isNarrowViewport ? undefined : 'Back to Hub'"
										icon="i-lucide:compass"
										size="xs"
										color="neutral"
										variant="outline"
										aria-label="Back to Hub"
										@click="back_to_hub"
									/>
									<UButton
										v-if="public_view && !cloud.user"
										label="Sign in"
										icon="i-lucide:log-in"
										size="xs"
										color="neutral"
										variant="outline"
										@click="open_sign_in"
									/>
								</template>
								<FolderChromeActionButton
									v-if="show_touch_select"
									icon="i-lucide-mouse-pointer-2"
									label="Select"
									@click="workspace?.enter_selection_mode()"
								/>
								<WindowControls v-if="show_window_controls" />
							</div>
						</header>
					<div class="relative min-h-0 flex-1">
						<div
							v-if="public_not_found"
							class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
						>
							<p class="text-lg font-medium text-default">Workspace not found</p>
							<p class="text-sm text-muted">
								<span class="font-mono">/{{ public_not_found }}</span>
								is not a published workspace (anymore)
							</p>
							<UButton label="Open the app" color="neutral" variant="outline" @click="go_home" />
						</div>
						<div
							v-else-if="window_load_error && !showing_catalog"
							class="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-error"
						>
							<p>{{ window_load_error }}</p>
							<div class="flex gap-2">
								<UButton size="xs" variant="soft" label="Retry" @click="retry_window_load" />
								<UButton
									v-if="is_slug_window"
									size="xs"
									color="neutral"
									variant="ghost"
									label="Back to Hub"
									@click="back_to_hub"
								/>
								<UButton
									v-if="is_local_window_workspace"
									size="xs"
									variant="ghost"
									label="Close window"
									@click="close_window"
								/>
							</div>
						</div>
						<template v-else>
							<HubView v-if="showing_hub" class="h-full overflow-y-auto" />
							<ProfileView v-else-if="showing_profile" class="h-full overflow-y-auto" />
							<template v-else>
								<FolderContainer v-if="workspace" :key="workspace.uid" />
								<ClipboardBanner v-if="workspace" />
							</template>
						</template>
					</div>
					<ImportProgressOverlay :progress="importProgress" />
					<UModal
						v-if="public_mode"
						v-model:open="accountOpen"
						title="My account"
						:content="{ onOpenAutoFocus: prevent_open_autofocus }"
					>
						<template #body>
							<AccountPanel />
						</template>
					</UModal>
					</div>
				</UDashboardPanel>
			</UDashboardGroup>
			<PublishDialog ref="publish_dialog" @closed="unlock_document_pointers" />
			<ShareDialog ref="share_dialog" @closed="unlock_document_pointers" />
			<TrashDialog ref="trash_dialog" @closed="unlock_document_pointers" />
		</div>
	</UApp>
</template>

<style scoped>
.workspace-header {
	height: 45px;
	background-color: var(--pc-gray-surface);
	position: relative;
	z-index: 2;
	overflow: visible;
}

/* Desktop / fine pointer: show chrome while the cursor is over the open folder panel. */
@media (hover: hover) and (pointer: fine) {
	.workspace-header-chrome:not(.workspace-header-chrome--selection) {
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.15s ease;
	}

	.workspace-panel:hover .workspace-header-chrome:not(.workspace-header-chrome--selection) {
		opacity: 1;
		pointer-events: auto;
	}

	/* Window controls: reveal only when hovering the right side of the header. */
	.workspace-window-controls {
		transform: translateZ(0);
	}

	.workspace-window-controls :deep(.window-controls) {
		height: 100%;
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transition: opacity 0.15s ease, visibility 0s linear 0.15s;
	}

	.workspace-window-controls:hover :deep(.window-controls) {
		opacity: 1;
		visibility: visible;
		pointer-events: auto;
		transition: opacity 0.15s ease, visibility 0s;
	}

	.workspace-tab:not(:hover):not(:focus-within) .workspace-tab-close {
		display: none;
	}
}
</style>