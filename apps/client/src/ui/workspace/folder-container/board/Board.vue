<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue'
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
import { backgroundStyle, defaultViewBackground } from '../widgets/resolveBackground'
import PileImagePending from '../widgets/PileImagePending.vue'
import { useResolvedFill } from '../widgets/useResolvedFill'
import { useBoardMarqueeSelection } from './useBoardMarqueeSelection'
import { isEmptyBoardPointerTarget } from './isEmptyBoardPointerTarget'
import { useMoveSelectedWidgets } from '../useMoveSelectedWidgets'
import BoardMarqueeOverlay from './BoardMarqueeOverlay.vue'
import EmptyPaneHint from '../EmptyPaneHint.vue'
import BoardOffEdgeHint from './BoardOffEdgeHint.vue'
import { useRevealEditingNote } from '../revealEditingNote'
import { useLineDrawMode } from '../useLineDrawMode'
import { useTextPlaceMode } from '../useTextPlaceMode'
import { LINE_ARROW_SIZE } from '@/services/board/shapes'
import { setExternalDropPositionResolver } from '../externalDropPosition'
import {
	registerPaneEditingNoteSetter,
	registerPanePositionResolver,
} from '../panePosition'

const { folderId, container, isEmbedded } = useFolderContainerScope()
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
	createTextAt,
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

// T arms one text block for the next click on empty pane.
const textPlace = useTextPlaceMode({ isEmbedded })

// One placement tool at a time: arming a line or picking a shape drops the text one.
watch(() => lineDraw.armed.value, (kind) => {
	if (kind) textPlace.disarm()
})
watch(textPlace.armed, (armed) => {
	if (armed) lineDraw.disarm()
})
watch(boardPlacementTemplate, (template) => {
	if (template) textPlace.disarm()
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
		Boolean(boardPlacementTemplate.value)
		|| Boolean(lineDraw.armed.value)
		|| textPlace.armed.value,
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

/**
 * A click is on the empty board only if its press was too. A text selection
 * dragged out past a note's or a shape's edge is released on the board, and
 * its click lands there: it must not end the editing.
 */
let pressOnEmptyBoard = false

function onBoardPointerDownCapture(event: PointerEvent) {
	pressOnEmptyBoard = isEmptyBoardPointerTarget(event.target, boardRef.value)
}

function onBoardPaneClick(event: MouseEvent) {
	if (!pressOnEmptyBoard) return
	if (consumeSuppressedPaneClick()) return
	if (textPlace.armed.value) {
		textPlace.disarm()
		void createTextAt(event)
		return
	}
	void onPaneClick(event)
}

// A note opened for typing on a phone stays above the keyboard. The board
// pads its bottom by the keyboard's height, or a note near the end of the
// content could not scroll up out from under it.
const keyboardInset = ref(0)
useRevealEditingNote({
	editingNoteId,
	paneElement: () => boardRef.value,
	pan: (dx, dy) => boardRef.value?.scrollBy({ left: -dx, top: -dy }),
	enabled: () => !isEmbedded,
	onKeyboardInset: (inset) => {
		keyboardInset.value = inset
	},
})

const paneFill = useResolvedFill(folderId, () => container.value?.background)
const boardChromeStyle = computed(() => ({
	...backgroundStyle(paneFill.value, defaultViewBackground),
	cursor: lineDraw.cursor.value
		?? (boardPlacementTemplate.value ? 'crosshair' : undefined)
		?? (textPlace.armed.value ? 'text' : undefined),
	...(keyboardInset.value > 0 ? { paddingBottom: `${20 + keyboardInset.value}px` } : {}),
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
			@pointerdown.capture="onBoardPointerDownCapture"
			@pointerdown="onBoardPointerDown"
			@pointermove="onPointerMove"
			@pointerup="onPointerUp"
			@pointercancel="onPointerCancel"
			@click.self="onBoardPaneClick"
			@dblclick.self="onBoardDblClick"
			@contextmenu.self="onBoardContextMenu"
		>
			<PileImagePending :folder_id="folderId" role="background" />
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
		<BoardOffEdgeHint v-if="!isEmbedded" :folder-id="folderId" :children="children" />
	</div>
	</FolderContainerCtxMenu>
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
