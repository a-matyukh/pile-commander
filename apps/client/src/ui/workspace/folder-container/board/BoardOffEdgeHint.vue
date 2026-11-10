<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { board_quadrant_shift, off_board_children } from '@/services/board/layout'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import { count_items, t } from '@/i18n'
import { record_action } from '@/store/history'

/**
 * A board starts at its top-left corner: what a canvas placed left of or
 * above it is out of reach. This says so, and "Показать" moves the whole
 * folder's content in, arrangement and ink kept, as one undo.
 */
const props = defineProps<{
	folderId: string
	children: FolderContainerWidgetChild[]
}>()

const workspace = useWorkspace()
const can_write = computed(() => workspace.value?.can_write !== false)
const hidden = computed(() => off_board_children(props.children))
const moving = ref(false)

async function bringIntoView() {
	const ws = workspace.value
	if (!ws || !ws.can_write || moving.value) return
	const placed = props.children.filter(child => !!child.position)
	const shift = board_quadrant_shift(placed.map(child => child.position!))
	if (shift.x === 0 && shift.y === 0) return

	moving.value = true
	try {
		const folder_id = props.folderId
		await ws.ensure_strokes(folder_id)
		const strokes = ws.strokes_for(folder_id)
		await record_action(ws, { folder_id }, t('undo.layout'), async (tx) => {
			for (const child of placed) {
				await ws.change_position(child.id, {
					x: child.position!.x + shift.x,
					y: child.position!.y + shift.y,
				}, { tx })
			}
			if (strokes.length > 0) {
				await ws.upsert_strokes(folder_id, strokes.map(stroke => ({
					...stroke,
					position: { x: stroke.position.x + shift.x, y: stroke.position.y + shift.y },
				})), { tx })
			}
		})
	} finally {
		moving.value = false
	}
}
</script>

<template>
	<div
		v-if="hidden.length > 0"
		class="board-off-edge-hint board-no-drag"
		role="status"
		@pointerdown.stop
		@click.stop
		@dblclick.stop
	>
		<UIcon name="i-lucide-eye-off" class="board-off-edge-hint__icon" />
		<span>{{ t('off_board.hint', { items: count_items(hidden.length) }) }}</span>
		<button
			v-if="can_write"
			type="button"
			class="board-off-edge-hint__action"
			:disabled="moving"
			@click="bringIntoView"
		>
			{{ t('off_board.show') }}
		</button>
	</div>
</template>

<style scoped>
.board-off-edge-hint {
	position: absolute;
	top: 8px;
	left: 8px;
	z-index: 20000;
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
	max-width: calc(100% - 16px);
	padding: 0.3125rem 0.375rem 0.3125rem 0.5rem;
	border: 1px solid rgba(0, 0, 0, 0.1);
	border-radius: 0.5rem;
	background: #fefefe;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
	color: #374151;
	font-size: 12px;
	line-height: 1.2;
}

.board-off-edge-hint__icon {
	width: 14px;
	height: 14px;
	flex-shrink: 0;
	color: #6b7280;
}

.board-off-edge-hint__action {
	flex-shrink: 0;
	padding: 0.25rem 0.5rem;
	border: none;
	border-radius: 0.375rem;
	background: var(--pc-gray-muted, #f3f4f6);
	color: #111827;
	font-size: 12px;
	cursor: pointer;
}

.board-off-edge-hint__action:hover:not(:disabled) {
	background: #e5e7eb;
}

.board-off-edge-hint__action:focus-visible {
	outline: 2px solid #2563eb;
	outline-offset: 1px;
}
</style>
