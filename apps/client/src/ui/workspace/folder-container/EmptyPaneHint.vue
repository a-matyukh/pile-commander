<script setup lang="ts">
import { computed } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { useFolderContainerScope } from './useFolderContainerScope'
import { useEmptyPaneHintDismissed } from './emptyPaneHintDismissed'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import Button from '@/ui/kit/Button.vue'
import { t } from '@/i18n'

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
					<span class="empty-pane-hint__label">{{ t('add.new_note_name') }}</span>
					<span class="empty-pane-hint__shortcut">{{ t('empty_pane.double_click') }}</span>
				</li>
				<li>
					<span class="empty-pane-hint__label">{{ t('add.new_folder_name') }}</span>
					<span class="empty-pane-hint__shortcut">{{ t('empty_pane.shift_double_click') }}</span>
				</li>
			</ul>
			<Button @click="dismiss">{{ t('empty_pane.remembered') }}</Button>
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
	gap: 14px;
	max-width: 20rem;
	padding: 16px 18px;
	border: 0.5px solid var(--border-strong);
	border-radius: 12px;
	background: var(--surface-3);
	color: var(--text-primary);
	box-shadow: 0 8px 24px rgba(0, 0, 0, .08);
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
	line-height: 1.35;
}

.empty-pane-hint__list li {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 1rem;
}

.empty-pane-hint__label {
	font-weight: 500;
}

.empty-pane-hint__shortcut {
	color: var(--text-muted);
	white-space: nowrap;
}
</style>
