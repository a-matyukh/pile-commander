<script setup lang="ts">
import { computed, ref } from 'vue'
import { focused_window, window_title, type AppWindow } from '@/domain/Desktop'
import desktops from '@/store/desktops'
import { workspace_registry } from '@/store/workspaceRegistry'
import WorkspacesPopover from '@/ui/workspace/sidebar/workspaces-list/WorkspacesPopover.vue'

const start_open = ref(false)

const windows = computed(() => desktops.selected_desktop?.windows ?? [])

function taskbar_title(window: AppWindow) {
	return window_title(window, workspace_registry.get(window.id)?.name)
}

function on_window_click(window: AppWindow) {
	if (window.state === 'minimized') {
		desktops.restore_window(window.id)
		return
	}
	desktops.focus_window(window.id)
}

// the focused (top-most visible) window of the selected desktop;
// none while the board itself holds the keyboard focus
const focused_window_id = computed(() => {
	const desktop = desktops.selected_desktop
	if (!desktop || desktops.is_board_focused(desktop.id)) return null
	return focused_window(desktop)?.id ?? null
})

const drag_from = ref<number | null>(null)
const drop_target = ref<number | null>(null)

function on_dragstart(index: number, event: DragEvent) {
	drag_from.value = index
	event.dataTransfer?.setData('text/plain', String(index))
	if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function on_dragover(index: number, event: DragEvent) {
	if (drag_from.value === null) return
	event.preventDefault()
	drop_target.value = index
}

function on_drop(index: number) {
	if (drag_from.value !== null && drag_from.value !== index) {
		desktops.reorder_windows(drag_from.value, index)
	}
	drag_from.value = null
	drop_target.value = null
}

function on_dragend() {
	drag_from.value = null
	drop_target.value = null
}
</script>

<template>
	<div
		class="absolute inset-x-0 bottom-0 z-50 flex h-12 items-center gap-2 px-2"
	>
		<WorkspacesPopover
			v-model:open="start_open"
			open_as="new-window"
			:content="{ side: 'top', align: 'start' }"
		>
			<UButton
				icon="boxicons:home-alt"
				color="neutral"
				variant="soft"
				aria-label="Start"
			/>
		</WorkspacesPopover>

		<div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
			<div
				v-for="(window, index) in windows"
				:key="window.id"
				class="group flex max-w-48 min-w-0 cursor-pointer items-center gap-1 rounded-md px-2.5 py-1.5 select-none bg-elevated transition-colors hover:bg-accented/75 active:bg-accented/75"
				:class="[
					window.id === focused_window_id
						? 'text-highlighted'
						: 'text-muted hover:text-default',
					drop_target === index && drag_from !== index ? 'ring-1 ring-primary' : '',
				]"
				draggable="true"
				@click="on_window_click(window)"
				@dragstart="on_dragstart(index, $event)"
				@dragover="on_dragover(index, $event)"
				@drop="on_drop(index)"
				@dragend="on_dragend"
			>
				<span class="min-w-0 truncate text-sm">{{ taskbar_title(window) }}</span>
				<UButton
					icon="i-lucide:x"
					color="neutral"
					variant="ghost"
					size="xs"
					class="opacity-0 group-hover:opacity-100"
					aria-label="Close window"
					@click.stop="desktops.close_window(window.id)"
				/>
			</div>
		</div>
	</div>
</template>
