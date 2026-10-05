<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { GridItem, GridLayout } from 'vue-grid-layout-v3'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { useRequireWorkspace, useWorkspace } from '@/ui/workspace/useWorkspace'
import { useFolderContainerScope } from '../useFolderContainerScope'
import { provideEditingNoteId } from '../widgets/useEditingNoteId'
import { useClickOutsideEditingNote } from '../widgets/useClickOutsideEditingNote'
import { registerPaneEditingNoteSetter } from '../panePosition'
import WidgetTypeSwitch from '../widgets/WidgetTypeSwitch.vue'
import { backgroundStyle } from '../widgets/resolveBackground'
import {
	MASONRY_GAP,
	MASONRY_UNIT,
	colNumFromWidth,
	layoutReadingOrder,
	widgetsToLayout,
	whToSize,
	type MasonryLayoutItem,
} from './masonryLayout'

const { folderId, container, isEmbedded } = useFolderContainerScope()

const requireWorkspace = useRequireWorkspace()
const workspace = useWorkspace()

const editingNoteId = ref<string | null>(null)
provideEditingNoteId(editingNoteId)

const sectionEl = useTemplateRef<HTMLElement>('sectionEl')
const layout = ref<MasonryLayoutItem[]>([])
const colNum = ref(12)
const isInteracting = ref(false)
const isPersisting = ref(false)

const children = computed(() => container.value?.children ?? [])

const can_write = computed(() => workspace.value?.can_write !== false)

const widgetById = computed(() => {
	const map = new Map<string, FolderContainerWidgetChild>()
	for (const child of children.value) {
		map.set(child.id, child)
	}
	return map
})

const sectionStyle = computed(() => backgroundStyle(container.value?.background, 'white'))

const margin = [MASONRY_GAP, MASONRY_GAP] as [number, number]

function childrenSyncKey(list: FolderContainerWidgetChild[]): string {
	return list
		.map(c => [
			c.id,
			c.size?.width ?? '',
			c.size?.height ?? '',
			c.position?.x ?? '',
			c.position?.y ?? '',
		].join(':'))
		.join('|')
}

function rebuildLayout() {
	layout.value = widgetsToLayout(children.value, colNum.value)
}

watch(
	() => [childrenSyncKey(children.value), colNum.value] as const,
	() => {
		if (isInteracting.value || isPersisting.value) return
		rebuildLayout()
	},
	{ immediate: true },
)

function updateColNum() {
	const el = sectionEl.value
	if (!el) return
	const next = colNumFromWidth(el.clientWidth)
	if (next !== colNum.value) {
		colNum.value = next
	}
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
	registerPaneEditingNoteSetter(folderId.value, (noteId) => {
		editingNoteId.value = noteId
	})
	updateColNum()
	const el = sectionEl.value
	if (!el) return
	resizeObserver = new ResizeObserver(() => updateColNum())
	resizeObserver.observe(el)
})

onBeforeUnmount(() => {
	registerPaneEditingNoteSetter(folderId.value, null)
	resizeObserver?.disconnect()
	resizeObserver = null
})

function onInteractionStart() {
	isInteracting.value = true
}

async function persistLayout() {
	if (isPersisting.value) return
	if (workspace.value?.can_write === false) return
	isPersisting.value = true
	isInteracting.value = false
	try {
		const ws = requireWorkspace()
		const items = layout.value
		for (const item of items) {
			await ws.change_position(item.i, { x: item.x, y: item.y })
			await ws.change_size(item.i, whToSize({ w: item.w, h: item.h }))
		}
		await ws.reorder_children(folderId.value, layoutReadingOrder(items))
	} finally {
		isPersisting.value = false
	}
}

function onMoved() {
	void persistLayout()
}

function onResized() {
	void persistLayout()
}

const { onSectionClick } = useClickOutsideEditingNote('.masonry-note-widget', editingNoteId)
</script>

<template>
	<section
		ref="sectionEl"
		class="masonry"
		:style="sectionStyle"
		:data-path="folderId"
		@click="onSectionClick"
	>
		<div v-if="children.length === 0" class="masonry-empty">
			<p class="text-muted">No items</p>
		</div>
		<GridLayout
			v-else
			v-model:layout="layout"
			class="masonry-grid"
			:col-num="colNum"
			:row-height="MASONRY_UNIT"
			:margin="margin"
			:is-draggable="can_write"
			:is-resizable="can_write"
			:vertical-compact="true"
			:use-css-transforms="true"
			:auto-size="true"
		>
			<GridItem
				v-for="(item, index) in layout"
				:key="item.i"
				:i="item.i"
				:x="item.x"
				:y="item.y"
				:w="item.w"
				:h="item.h"
				:min-w="1"
				:min-h="1"
				drag-allow-from=".masonry-drag-handle"
				drag-ignore-from="a, button, textarea, input"
				resize-ignore-from="a, button, textarea, input, .masonry-drag-handle"
				@move="onInteractionStart"
				@resize="onInteractionStart"
				@moved="onMoved"
				@resized="onResized"
			>
				<WidgetTypeSwitch
					v-if="widgetById.get(item.i)"
					layout="masonry"
					:widget="widgetById.get(item.i)!"
					:index="index"
				/>
			</GridItem>
		</GridLayout>
	</section>
	<USeparator v-if="!isEmbedded" />
</template>

<style scoped>
.masonry {
	min-height: 100%;
}

.masonry-empty {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 2rem;
}

.masonry-grid {
	min-height: 100%;
}

.masonry :deep(.vue-grid-item) {
	touch-action: none;
}

/* Fill the cell with the widget only — never stretch .vue-resizable-handle
   (that would cover the whole item and steal drag). */
.masonry :deep(.vue-grid-item > .masonry-widget),
.masonry :deep(.vue-grid-item > :not(.vue-resizable-handle):not(.vue-rtl-resizable-handle)) {
	width: 100%;
	height: 100%;
	min-width: 0;
	min-height: 0;
}

.masonry :deep(.vue-grid-item.vue-grid-placeholder) {
	background: var(--ui-primary, #3b82f6);
	opacity: 0.15;
	border-radius: 5px;
}

.masonry :deep(.vue-grid-item > .vue-resizable-handle) {
	width: 20px;
	height: 20px;
	opacity: 0.45;
	z-index: 3;
}

.masonry :deep(.vue-grid-item:hover > .vue-resizable-handle) {
	opacity: 0.85;
}

.masonry :deep(.vue-grid-item:has(.is_edit) > .vue-resizable-handle) {
	pointer-events: none;
	visibility: hidden;
}
</style>
