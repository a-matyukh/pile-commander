<script setup lang="ts">
import { computed } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import store from '@/store'
import desktops from '@/store/desktops'
import { useWindowContext } from './windowContext'

// Entry point into the desktops mode — hidden on phones/tablets only.
// Desktop (Tauri) and desktop browsers keep the buttons at any window width;
// the render mode itself is a persistent store state and never depends on
// the viewport.
const isCoarsePointer = useMediaQuery('(pointer: coarse)')
const show_on_this_device = computed(() => is_desktop || !isCoarsePointer.value)

const ctx = useWindowContext()
const is_fullscreen_window = computed(() => ctx?.state.value === 'fullscreen')
const can_eject = computed(() => {
	const kind = ctx?.content.value.kind
	return kind === 'workspace' || kind === 'slug'
})

function on_close() {
	if (ctx) desktops.close_window(ctx.window_id)
	else store.close_workspace()
}

function on_hide() {
	if (ctx) desktops.hide_window(ctx.window_id)
}

function on_toggle_fullscreen() {
	if (ctx) desktops.toggle_fullscreen(ctx.window_id)
	else store.enter_desktops_mode()
}

function on_eject() {
	if (ctx) store.eject_workspace(ctx.window_id)
}

const toggle_title = computed(() => {
	if (!ctx) return 'Desktops'
	return is_fullscreen_window.value ? 'Exit fullscreen' : 'Fullscreen'
})
</script>

<template>
	<div v-if="show_on_this_device" class="window-controls flex shrink-0 items-center gap-2" data-window-no-drag @dblclick.stop>
		<UTooltip v-if="can_eject" text="Eject workspace">
			<UButton
				class="window-controls__eject"
				icon="i-lucide:eject"
				color="neutral"
				variant="ghost"
				size="xs"
				aria-label="Eject workspace"
				@click.stop="on_eject"
			/>
		</UTooltip>
		<UTooltip
			:text="toggle_title"
			:kbds="ctx && !is_fullscreen_window ? ['Double-click window header'] : undefined"
			:ui="{ kbds: 'inline-flex' }"
		>
			<button
				class="window-controls__button window-controls__button--fullscreen"
				type="button"
				aria-label="Toggle fullscreen"
				@click.stop="on_toggle_fullscreen"
			>
				<UIcon :name="is_fullscreen_window ? 'i-lucide:minimize-2' : 'i-lucide:maximize-2'" />
			</button>
		</UTooltip>
		<UTooltip text="Minimize">
			<button
				class="window-controls__button window-controls__button--hide"
				type="button"
				aria-label="Minimize"
				:disabled="!ctx"
				@click.stop="on_hide"
			>
				<UIcon name="i-lucide:minus" />
			</button>
		</UTooltip>
		<UTooltip :text="ctx ? 'Close window' : 'Close workspace'">
			<button
				class="window-controls__button window-controls__button--close"
				type="button"
				aria-label="Close"
				@click.stop="on_close"
			>
				<UIcon name="i-lucide:x" />
			</button>
		</UTooltip>
	</div>
</template>

<style scoped>
.window-controls {
	line-height: 0;
}

.window-controls__eject {
	opacity: 0.5;
}

.window-controls:hover .window-controls__eject,
.window-controls:focus-within .window-controls__eject {
	opacity: 1;
}

.window-controls__button {
	box-sizing: border-box;
	width: 14px;
	height: 14px;
	padding: 0;
	border: 2px solid var(--ui-text-dimmed, var(--ui-text-muted, #737373));
	border-radius: 9999px;
	background-color: transparent;
	display: flex;
	flex-shrink: 0;
	align-items: center;
	justify-content: center;
	overflow: hidden;
	appearance: none;
	font-size: 9px;
	line-height: 0;
	color: transparent;
	transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.window-controls__button :deep(svg) {
	width: 9px;
	height: 9px;
	flex-shrink: 0;
}

.window-controls:hover .window-controls__button:not(:disabled),
.window-controls:focus-within .window-controls__button:not(:disabled) {
	background-color: var(--window-control-color);
	border-color: var(--window-control-color);
	color: rgb(0 0 0 / 0.6);
}

.window-controls__button:disabled {
	opacity: 0.4;
}

.window-controls__button--close {
	--window-control-color: #ff5f57;
}

.window-controls__button--hide {
	--window-control-color: #febc2e;
}

.window-controls__button--fullscreen {
	--window-control-color: #28c840;
}
</style>
