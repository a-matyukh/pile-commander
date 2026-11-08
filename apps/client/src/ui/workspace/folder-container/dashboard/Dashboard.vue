<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { GridItem, GridLayout } from 'vue-grid-layout-v3'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { useRequireWorkspace, useWorkspace } from '@/ui/workspace/useWorkspace'
import { t } from '@/i18n'
import { record_action } from '@/store/history'
import { useFolderContainerScope } from '../useFolderContainerScope'
import { provideEditingNoteId } from '../widgets/useEditingNoteId'
import { useClickOutsideEditingNote } from '../widgets/useClickOutsideEditingNote'
import { registerPaneEditingNoteSetter } from '../panePosition'
import WidgetTypeSwitch from '../widgets/WidgetTypeSwitch.vue'
import { backgroundStyle, defaultViewBackground } from '../widgets/resolveBackground'
import PileImagePending from '../widgets/PileImagePending.vue'
import { useResolvedFill } from '../widgets/useResolvedFill'
import {
	DASHBOARD_COLS,
	DASHBOARD_GAP,
	DASHBOARD_ROW_HEIGHT,
	compactDashboardLayout,
	dashboardCellsToWrite,
	widgetsToDashboardLayout,
	type DashboardLayoutItem,
} from './dashboardLayout'

const { folderId, container, isEmbedded } = useFolderContainerScope()

const requireWorkspace = useRequireWorkspace()
const workspace = useWorkspace()

const editingNoteId = ref<string | null>(null)
provideEditingNoteId(editingNoteId)

const layout = ref<DashboardLayoutItem[]>([])
const isInteracting = ref(false)
const isPersisting = ref(false)

const children = computed(() => container.value?.children ?? [])
const can_write = computed(() => workspace.value?.can_write !== false)
const compact = computed(() => container.value?.dashboard_compact === true)

const widgetById = computed(() => {
	const map = new Map<string, FolderContainerWidgetChild>()
	for (const child of children.value) map.set(child.id, child)
	return map
})

const paneFill = useResolvedFill(folderId, () => container.value?.background)
const sectionStyle = computed(() => backgroundStyle(paneFill.value, defaultViewBackground))
const margin = [DASHBOARD_GAP, DASHBOARD_GAP] as [number, number]

function childrenSyncKey(list: FolderContainerWidgetChild[]): string {
	return list
		.map(c => [
			c.id,
			c.dashboard?.x ?? '',
			c.dashboard?.y ?? '',
			c.dashboard?.w ?? '',
			c.dashboard?.h ?? '',
			c.dashboard ? '' : `${c.size?.width ?? ''}x${c.size?.height ?? ''}`,
		].join(':'))
		.join('|')
}

function rebuildLayout() {
	const next = widgetsToDashboardLayout(children.value)
	layout.value = compact.value ? compactDashboardLayout(next) : next
}

watch(
	() => childrenSyncKey(children.value),
	() => {
		if (isInteracting.value || isPersisting.value) return
		rebuildLayout()
	},
	{ immediate: true },
)

// The flag lives on the folder. vue-grid does not watch verticalCompact,
// so the pull-up is applied here. Cells on disk stay until a card is moved.
watch(compact, () => {
	if (isInteracting.value || isPersisting.value) return
	rebuildLayout()
})

onMounted(() => {
	registerPaneEditingNoteSetter(folderId.value, (noteId) => {
		editingNoteId.value = noteId
	})
	window.addEventListener('pointerup', onInteractionEnd)
	window.addEventListener('pointercancel', onInteractionEnd)
})

onBeforeUnmount(() => {
	registerPaneEditingNoteSetter(folderId.value, null)
	window.removeEventListener('pointerup', onInteractionEnd)
	window.removeEventListener('pointercancel', onInteractionEnd)
})

function onInteractionStart() {
	isInteracting.value = true
}

/**
 * vue-grid emits moved/resized only when the cell actually changed.
 * A drop back on the same cell leaves isInteracting set, and the children
 * watch then ignores new files until the folder is reopened.
 * Pointer-up runs after that emit, so a real move is already persisting.
 */
function onInteractionEnd() {
	queueMicrotask(() => {
		if (isPersisting.value || !isInteracting.value) return
		isInteracting.value = false
		rebuildLayout()
	})
}

async function persistLayout() {
	if (isPersisting.value) return
	if (workspace.value?.can_write === false) {
		isInteracting.value = false
		return
	}
	isPersisting.value = true
	isInteracting.value = false
	try {
		const ws = requireWorkspace()
		const current = new Map(children.value.map(child => [child.id, child.dashboard]))
		const cells = dashboardCellsToWrite(layout.value, current)
		// The grid moves the neighbours along: the whole new layout is one undo
		await record_action(ws, { entry_id: cells[0]?.i }, t('undo.layout'), async (tx) => {
			for (const item of cells) {
				await ws.change_dashboard_cell(item.i, {
					x: Math.round(item.x),
					y: Math.round(item.y),
					w: Math.max(1, Math.round(item.w)),
					h: Math.max(1, Math.round(item.h)),
				}, { tx })
			}
		})
	} finally {
		isPersisting.value = false
	}
}

const { onSectionClick: exitEditing } = useClickOutsideEditingNote('.dashboard-note-widget', editingNoteId)

/** A click on the gaps and the padding clears the selection, as in List and Gallery. */
function onSectionClick(event: MouseEvent) {
	exitEditing(event)
	const target = event.target as Element | null
	// The resize handle sits on the card, outside the item itself.
	if (target?.closest('[data-item-id], .vue-grid-item')) return
	workspace.value?.clear_selection()
}
</script>

<template>
	<section
		class="dashboard"
		:style="sectionStyle"
		:data-path="folderId"
		@click="onSectionClick"
	>
		<PileImagePending :folder_id="folderId" role="background" />
		<div v-if="children.length === 0" class="dashboard-empty">
			<p class="text-muted">No items</p>
		</div>
		<GridLayout
			v-else
			v-model:layout="layout"
			class="dashboard-grid"
			:col-num="DASHBOARD_COLS"
			:row-height="DASHBOARD_ROW_HEIGHT"
			:margin="margin"
			:is-draggable="can_write"
			:is-resizable="can_write"
			:vertical-compact="compact"
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
				drag-allow-from=".dashboard-drag-handle"
				drag-ignore-from="a, button, textarea, input, [contenteditable]"
				resize-ignore-from="a, button, textarea, input, [contenteditable], .dashboard-drag-handle"
				@move="onInteractionStart"
				@resize="onInteractionStart"
				@moved="persistLayout"
				@resized="persistLayout"
			>
				<WidgetTypeSwitch
					v-if="widgetById.get(item.i)"
					layout="dashboard"
					:widget="widgetById.get(item.i)!"
					:index="index"
				/>
			</GridItem>
		</GridLayout>
	</section>
	<USeparator v-if="!isEmbedded" />
</template>

<style scoped>
.dashboard {
	position: relative;
	min-height: 100%;
}

.dashboard-empty {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 2rem;
}

.dashboard-grid {
	min-height: 100%;
}

.dashboard :deep(.vue-grid-item) {
	touch-action: none;
}

.dashboard :deep(.vue-grid-item > .dashboard-widget),
.dashboard :deep(.vue-grid-item > :not(.vue-resizable-handle):not(.vue-rtl-resizable-handle)) {
	width: 100%;
	height: 100%;
	min-width: 0;
	min-height: 0;
}

.dashboard :deep(.vue-grid-item.vue-grid-placeholder) {
	background: var(--ui-primary, #3b82f6);
	opacity: 0.15;
	border-radius: 5px;
}

.dashboard :deep(.vue-grid-item > .vue-resizable-handle) {
	width: 20px;
	height: 20px;
	opacity: 0.45;
	z-index: 3;
}

.dashboard :deep(.vue-grid-item:hover > .vue-resizable-handle) {
	opacity: 0.85;
}

.dashboard :deep(.vue-grid-item:has(.is_edit) > .vue-resizable-handle) {
	pointer-events: none;
	visibility: hidden;
}
</style>
