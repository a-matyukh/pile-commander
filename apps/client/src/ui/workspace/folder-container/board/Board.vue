<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref } from 'vue'
import type { Position, Size } from '@/domain/Widget'
import { useFolderContainerScope } from '../useFolderContainerScope'
import { useBoardSnapSettings } from '../useBoardSnapSettings'
import { boardDragStateKey, boardSnapSettingsKey } from '../injectKeys'
import { provideEditingNoteId } from '../widgets/useEditingNoteId'
import WidgetTypeSwitch from '../widgets/WidgetTypeSwitch.vue'
import { useFolderPaneActions } from '../useFolderPaneActions'
import FolderContainerCtxMenu from '@/ui/workspace/menu/FolderContainerCtxMenu.vue'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import { board_content_extent } from '@/services/board/layout'
import { backgroundStyle } from '../widgets/resolveBackground'
import { useBoardMarqueeSelection } from './useBoardMarqueeSelection'
import { isEmptyBoardPointerTarget } from './isEmptyBoardPointerTarget'
import { useMoveSelectedWidgets } from '../useMoveSelectedWidgets'
import { useDeleteSelectedWidgets } from '../useDeleteSelectedWidgets'
import BulkRemoveDialog from '@/ui/workspace/menu/BulkRemoveDialog.vue'
import BoardMarqueeOverlay from './BoardMarqueeOverlay.vue'
import EmptyPaneHint from '../EmptyPaneHint.vue'
import { useLineDrawMode } from '../useLineDrawMode'
import { LINE_ARROW_SIZE } from '@/services/board/shapes'
import { setExternalDropPositionResolver } from '../externalDropPosition'
import {
	registerPaneEditingNoteSetter,
	registerPanePositionResolver,
} from '../panePosition'

const { folderId, container, isEmbedded, fixedView } = useFolderContainerScope()
const workspace = useWorkspace()
const can_write = computed(() => workspace.value?.can_write !== false)

const dragPositions = ref<Record<string, Position>>({})
const dragSizes = ref<Record<string, Size>>({})
const editingNoteId = ref<string | null>(null)
const boardRef = ref<HTMLElement | null>(null)

const boardSnapSettings = useBoardSnapSettings()

provide(boardDragStateKey, { dragPositions, dragSizes })
provideEditingNoteId(editingNoteId)
provide(boardSnapSettingsKey, boardSnapSettings)

const children = computed(() => container.value?.children ?? [])

useMoveSelectedWidgets({
	children,
	editingNoteId,
	boardSnapSettings,
	enabled: () => !isEmbedded,
})

// FolderChrome owns Backspace in workspace windows; the desktop surface has
// no chrome, so this board is the only place that can confirm removal.
const { dialogRef, onConfirm } = useDeleteSelectedWidgets({
	children,
	editingNoteId,
	enabled: () => Boolean(fixedView),
})

function boardClickPosition(event: { clientX: number; clientY: number }): Position | null {
	const section = boardRef.value
	if (!section) return null

	const rect = section.getBoundingClientRect()
	return {
		x: event.clientX - rect.left + section.scrollLeft,
		y: event.clientY - rect.top + section.scrollTop,
	}
}

onMounted(() => {
	lineDraw.bind(boardRef.value)
	registerPanePositionResolver(folderId.value, (clientX, clientY) =>
		boardClickPosition({ clientX, clientY }),
	)
	registerPaneEditingNoteSetter(folderId.value, (noteId) => {
		editingNoteId.value = noteId
	})
	if (isEmbedded) return
	setExternalDropPositionResolver((clientX, clientY) =>
		boardClickPosition({ clientX, clientY }),
	)
})

onUnmounted(() => {
	lineDraw.bind(null)
	registerPanePositionResolver(folderId.value, null)
	registerPaneEditingNoteSetter(folderId.value, null)
	if (isEmbedded) return
	setExternalDropPositionResolver(null)
})

const {
	boardPlacementTemplate,
	contextMenuPosition,
	rememberContextMenuPosition,
	createNoteAt,
	createFolderAt,
	onPaneClick,
	onPaneContextMenu,
} = useFolderPaneActions({
	folderId,
	editingNoteId,
	resolvePosition: boardClickPosition,
})

const lineDraw = useLineDrawMode({
	folderId,
	isEmbedded,
	resolvePoint: boardClickPosition,
	isEmptyTarget: (target) => isEmptyBoardPointerTarget(target, boardRef.value),
})

const {
	marqueeStyle,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	onPointerCancel,
	consumeSuppressedPaneClick,
} = useBoardMarqueeSelection({
	boardRef,
	children,
	dragPositions,
	dragSizes,
	placementActive: computed(() =>
		Boolean(boardPlacementTemplate.value) || Boolean(lineDraw.armed.value),
	),
})

function onBoardPointerDown(event: PointerEvent) {
	// Seed create position before long-press opens the context menu (mobile
	// often never delivers a usable `contextmenu` coordinate event).
	if (can_write.value && isEmptyBoardPointerTarget(event.target, boardRef.value)) {
		rememberContextMenuPosition(event)
	}
	onPointerDown(event)
}

function onBoardContextMenu(event: MouseEvent) {
	// Read-only viewers get no menu at all — every mutation item would be
	// disabled anyway; preventDefault also suppresses the native browser menu.
	if (!can_write.value) {
		event.preventDefault()
		return
	}
	onPaneContextMenu(event)
}

function onBoardPaneClick(event: MouseEvent) {
	if (consumeSuppressedPaneClick()) return
	void onPaneClick(event)
}

const boardChromeStyle = computed(() => ({
	// On the desktop surface (fixedView) the background belongs to the
	// desktop — the board stays transparent unless the folder bg is set
	...backgroundStyle(
		container.value?.background,
		fixedView ? 'transparent' : 'white',
	),
	cursor: lineDraw.cursor.value
		?? (boardPlacementTemplate.value ? 'crosshair' : undefined),
}))

/** Arrowhead triangle for the live line preview (arrow mode only). */
const linePreviewArrowPoints = computed(() => {
	const line = lineDraw.preview.value
	if (!line || lineDraw.armed.value !== 'arrow') return ''
	const dx = line.end.x - line.start.x
	const dy = line.end.y - line.start.y
	const len = Math.hypot(dx, dy)
	if (len === 0) return ''
	const ux = dx / len
	const uy = dy / len
	const px = -uy
	const py = ux
	const back = LINE_ARROW_SIZE
	const half = LINE_ARROW_SIZE * 0.55
	const baseX = line.end.x - ux * back
	const baseY = line.end.y - uy * back
	return [
		`${line.end.x},${line.end.y}`,
		`${baseX + px * half},${baseY + py * half}`,
		`${baseX - px * half},${baseY - py * half}`,
	].join(' ')
})

function onBoardDblClick(event: MouseEvent) {
	if (lineDraw.armed.value) return
	if (event.shiftKey) {
		void createFolderAt(event)
		return
	}
	void createNoteAt(event)
}

/** In-flow spacer so absolute widgets expand the section scrollport. */
const boardExtentStyle = computed(() => {
	const { minWidth, minHeight } = board_content_extent(
		children.value,
		dragPositions.value,
		dragSizes.value,
	)
	return {
		...(minWidth > 0 ? { minWidth: `${minWidth}px` } : {}),
		...(minHeight > 0 ? { minHeight: `${minHeight}px` } : {}),
	}
})
</script>

<template>
	<FolderContainerCtxMenu :disabled="!can_write" :position="contextMenuPosition">
	<div class="board-frame">
		<section
			ref="boardRef"
			:style="boardChromeStyle"
			:data-path="folderId"
			@pointerdown="onBoardPointerDown"
			@pointermove="onPointerMove"
			@pointerup="onPointerUp"
			@pointercancel="onPointerCancel"
			@click.self="onBoardPaneClick"
			@dblclick.self="onBoardDblClick"
			@contextmenu.self="onBoardContextMenu"
		>
			<div
				class="board-extent"
				:style="boardExtentStyle"
				aria-hidden="true"
			/>
			<WidgetTypeSwitch
				v-for="(widget, index) in children"
				:key="widget.id"
				layout="board"
				:widget="widget"
				:index="index"
			/>
			<BoardMarqueeOverlay :rect-style="marqueeStyle" />
			<svg
				v-if="lineDraw.preview.value"
				class="line-draw-preview"
				aria-hidden="true"
			>
				<line
					:x1="lineDraw.preview.value.start.x"
					:y1="lineDraw.preview.value.start.y"
					:x2="lineDraw.preview.value.end.x"
					:y2="lineDraw.preview.value.end.y"
				/>
				<polygon
					v-if="linePreviewArrowPoints"
					class="line-draw-preview__head"
					:points="linePreviewArrowPoints"
				/>
			</svg>
		</section>
		<EmptyPaneHint :empty="children.length === 0" />
	</div>
	</FolderContainerCtxMenu>
	<BulkRemoveDialog ref="dialogRef" @confirm="onConfirm" />
</template>

<style scoped>
.board-frame {
	position: relative;
	height: 100%;
	min-height: 0;
	overflow: hidden;
	user-select: none;
	-webkit-user-select: none;
}

section {
	padding: 20px;
	position: relative;
	height: 100%;
	overflow: auto;
	box-sizing: border-box;
	user-select: none;
	-webkit-user-select: none;
	-webkit-touch-callout: none;
}

/* Expands scrollable size; widgets stay position:absolute and don't contribute. */
.board-extent {
	pointer-events: none;
}

.line-draw-preview {
	position: absolute;
	left: 0;
	top: 0;
	width: 100%;
	height: 100%;
	overflow: visible;
	pointer-events: none;
	z-index: 10000;
}

.line-draw-preview line {
	stroke: #4338ca;
	stroke-width: 6;
	stroke-linecap: round;
}

.line-draw-preview__head {
	fill: #4338ca;
}
</style>
