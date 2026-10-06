<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { public_window_path, window_title, type AppWindow, type Desktop } from '@/domain/Desktop'
import desktops from '@/store/desktops'
import cloud from '@/store/cloud'
import { workspace_registry } from '@/store/workspaceRegistry'
import { CLOUD_WORKSPACE_OFFLINE, is_offline_error } from '@/services/cloud/client'
import { provideWorkspaceStore } from '@/ui/workspace/useWorkspace'
import { provideWindowContext } from './windowContext'
import { useWindowInteract } from './useWindowInteract'
import WindowControls from './WindowControls.vue'
import WorkspaceWindow from '@/ui/workspace/WorkspaceWindow.vue'

const props = defineProps<{
	window: AppWindow
	desktop: Desktop
}>()

const window_state = computed(() => props.window.state)
const window_content = computed(() => props.window.content)
const loading = ref(false)
const load_error = ref<string | null>(null)

const workspace = computed(() =>
	props.window.content.kind === 'workspace' || props.window.content.kind === 'slug'
		? workspace_registry.get(props.window.id)
		: null,
)
provideWorkspaceStore(workspace)

// a window restored from a cloud desktop may point at a local workspace
// that does not exist on this device — say it plainly instead of showing
// the raw filesystem error
const is_local_workspace = computed(() =>
	props.window.content.kind === 'workspace' && props.window.content.item.type === 'local',
)
const is_cloud_content = computed(() => {
	const content = props.window.content
	if (content.kind === 'workspace') return content.item.type === 'cloud'
	return content.kind === 'slug'
})
const shown_error = computed(() => {
	if (!load_error.value) return null
	if (is_local_workspace.value) return 'This local workspace is not available on this device'
	if (is_cloud_content.value && is_offline_error(load_error.value)) return CLOUD_WORKSPACE_OFFLINE
	return load_error.value
})

/** Stable key for the workspace/slug identity — changes when the header list replaces in place. */
const content_key = computed(() => {
	const content = props.window.content
	if (content.kind === 'workspace') return `workspace:${content.item.type}:${content.item.id}`
	if (content.kind === 'slug') return `slug:${content.username}/${content.slug}`
	return content.kind
})

function workspace_matches_item(
	store: NonNullable<ReturnType<typeof workspace_registry.get>>,
	item: { type: string; id: string },
) {
	return store.type === item.type && store.uid === item.id
}

async function load_content() {
	const content = props.window.content
	load_error.value = null
	if (content.kind !== 'workspace' && content.kind !== 'slug') {
		workspace_registry.dispose_for_window(props.window.id)
	}
	if (content.kind === 'workspace') {
		const existing = workspace_registry.get(props.window.id)
		if (existing && workspace_matches_item(existing, content.item)) return
		loading.value = true
		try {
			await workspace_registry.load_for_window(props.window.id, content.item)
		} catch (error) {
			// drop a leftover store from the previous content so the header
			// shows "Select workspace" instead of stale tabs
			workspace_registry.dispose_for_window(props.window.id)
			load_error.value = error instanceof Error ? error.message : String(error)
		} finally {
			loading.value = false
		}
	} else if (content.kind === 'slug') {
		const view = cloud.publication_view
		const view_matches = view?.username === content.username && view?.slug === content.slug
		if (workspace_registry.get(props.window.id) && view_matches) return
		loading.value = true
		const ok = await cloud.open_public_for_window(
			props.window.id,
			content.username,
			content.slug,
		)
		loading.value = false
		if (!ok && !workspace_registry.get(props.window.id)) {
			load_error.value =
				cloud.last_error ?? `Workspace ${content.username}/${content.slug} is not available`
		}
	} else if (content.kind === 'profile') {
		void cloud.open_profile(content.username)
	} else if (content.kind === 'hub') {
		void cloud.fetch_hub()
	}
}

provideWindowContext({
	window_id: props.window.id,
	state: window_state,
	content: window_content,
	loading,
	load_error: shown_error,
	retry_load: () => { void load_content() },
})

function on_online() {
	if (!load_error.value || !is_cloud_content.value) return
	void load_content()
}

onMounted(() => {
	void load_content()
	window.addEventListener('online', on_online)
})
onUnmounted(() => {
	window.removeEventListener('online', on_online)
})
watch(content_key, () => { void load_content() })
watch(workspace, (ws) => {
	if (ws) load_error.value = null
})

const { root, live_x, live_y, live_width, live_height, resize_cursor } = useWindowInteract(
	props.window,
	() => props.desktop.xattrs,
)

const title = computed(() => {
	const content = props.window.content
	if (content.kind === 'slug') return workspace.value?.name || content.name || ''
	return window_title(props.window)
})
const public_path = computed(() => public_window_path(props.window))

const window_style = computed(() => {
	if (props.window.state === 'fullscreen') return {}
	return {
		left: `${live_x.value}px`,
		top: `${live_y.value}px`,
		width: `${live_width.value}px`,
		height: `${live_height.value}px`,
	}
})

const window_class = computed(() => ({
	'window--fullscreen': props.window.state === 'fullscreen',
	'window--resize-ew': resize_cursor.value === 'ew-resize',
	'window--resize-ns': resize_cursor.value === 'ns-resize',
	'window--resize-nwse': resize_cursor.value === 'nwse-resize',
}))

function focus() {
	desktops.focus_window(props.window.id)
}

function on_chrome_dblclick() {
	desktops.toggle_fullscreen(props.window.id)
}
</script>

<template>
	<section
		v-if="window.state !== 'minimized'"
		ref="root"
		class="window absolute flex flex-col overflow-hidden rounded-lg border border-default bg-default shadow-xl"
		:class="window_class"
		:style="window_style"
		:data-window-id="window.id"
		@pointerdown="focus"
		@contextmenu.stop
	>
		<header
			v-if="window.state === 'floating'"
			class="window-chrome flex h-9 shrink-0 cursor-grab select-none items-center gap-3 border-b border-default bg-elevated px-3 active:cursor-grabbing"
			@dblclick="on_chrome_dblclick"
		>
			<div class="flex min-w-0 flex-1 items-baseline gap-2">
				<span
					v-if="title"
					class="min-w-0 truncate text-sm font-medium text-highlighted"
				>{{ title }}</span>
				<span
					v-if="public_path"
					class="min-w-0 truncate text-sm"
					:class="title ? 'text-muted' : 'font-medium text-highlighted'"
				>{{ public_path }}</span>
			</div>
			<WindowControls class="ml-auto shrink-0" />
		</header>
		<div class="min-h-0 flex-1">
			<WorkspaceWindow
				embedded
				class="h-full"
			/>
		</div>
		<template v-if="window.state === 'floating'">
			<div class="window-resize-edge window-resize-edge--right" aria-hidden="true" />
			<div class="window-resize-edge window-resize-edge--bottom" aria-hidden="true" />
			<div class="window-resize-edge window-resize-edge--corner" aria-hidden="true" />
		</template>
	</section>
</template>

<style scoped>
.window--fullscreen {
	inset: 0;
	border: none;
	border-radius: 0;
}

/* Force the resize cursor through board/chrome children that set their own. */
.window--resize-ew,
.window--resize-ew :deep(*) {
	cursor: ew-resize !important;
}

.window--resize-ns,
.window--resize-ns :deep(*) {
	cursor: ns-resize !important;
}

.window--resize-nwse,
.window--resize-nwse :deep(*) {
	cursor: nwse-resize !important;
}

/* Event shields over the interact resize margin. */
.window-resize-edge {
	position: absolute;
	z-index: 50;
	pointer-events: auto;
}

.window-resize-edge--right {
	top: 0;
	right: 0;
	width: 8px;
	height: 100%;
}

.window-resize-edge--bottom {
	left: 0;
	bottom: 0;
	width: 100%;
	height: 8px;
}

.window-resize-edge--corner {
	right: 0;
	bottom: 0;
	width: 14px;
	height: 14px;
}
</style>
