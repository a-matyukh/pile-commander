<script setup lang="ts">
import { computed } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { useFolderContainerScope } from './useFolderContainerScope'
import { useEmptyPaneHintDismissed } from './emptyPaneHintDismissed'
import { useWorkspace } from '@/ui/workspace/useWorkspace'

const props = defineProps<{
	empty: boolean
}>()

const workspace = useWorkspace()

const dismissed = useEmptyPaneHintDismissed()
const { isEmbedded } = useFolderContainerScope()
// Same audience as menu kbd hints: desktop with mouse/trackpad, not touch-only.
const hasPhysicalKeyboard = useMediaQuery(
	'(min-width: 768px) and (hover: hover) and (pointer: fine)',
)

const visible = computed(
	() => props.empty && !isEmbedded && !dismissed.value && hasPhysicalKeyboard.value
		&& workspace.value?.can_write !== false,
)

function dismiss() {
	dismissed.value = true
}
</script>

<template>
	<div
		v-if="visible"
		class="empty-pane-hint board-no-drag"
		aria-live="polite"
	>
		<div
			class="empty-pane-hint__card"
			@click.stop
			@pointerdown.stop
		>
			<ul class="empty-pane-hint__list">
				<li>
					<span class="empty-pane-hint__label">New note</span>
					<span class="empty-pane-hint__shortcut">Double click</span>
				</li>
				<li>
					<span class="empty-pane-hint__label">New folder</span>
					<span class="empty-pane-hint__shortcut">Shift + double click</span>
				</li>
			</ul>
			<UButton
				color="neutral"
				variant="soft"
				size="sm"
				label="I remembered"
				@click="dismiss"
			/>
		</div>
	</div>
</template>

<style scoped>
.empty-pane-hint {
	position: absolute;
	inset: 0;
	z-index: 4;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 1.5rem;
	pointer-events: none;
}

.empty-pane-hint__card {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 1rem;
	max-width: 20rem;
	padding: 1rem 1.25rem;
	border: 1px solid var(--pc-border, #e5e7eb);
	border-radius: 0.5rem;
	background: color-mix(in oklab, #fff 92%, transparent);
	color: #111827;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
	pointer-events: auto;
	user-select: none;
	-webkit-user-select: none;
}

.empty-pane-hint__list {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	width: 100%;
	margin: 0;
	padding: 0;
	list-style: none;
	font-size: 0.875rem;
	line-height: 1.35;
}

.empty-pane-hint__list li {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 1rem;
}

.empty-pane-hint__label {
	font-weight: 600;
}

.empty-pane-hint__shortcut {
	color: var(--pc-text-muted, #737373);
	white-space: nowrap;
}
</style>
