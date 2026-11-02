<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useFolderContainerScope } from '../useFolderContainerScope'
import { provideEditingNoteId } from '../widgets/useEditingNoteId'
import { useClickOutsideEditingNote } from '../widgets/useClickOutsideEditingNote'
import { registerPaneEditingNoteSetter } from '../panePosition'
import { backgroundStyle, defaultViewBackground } from '../widgets/resolveBackground'
import MasonryCard from './MasonryCard.vue'
import {
	MASONRY_GAP,
	layoutMasonry,
	masonryColumnCount,
	masonryColumnWidth,
	sameMasonryColumns,
} from './masonryLayout'

const { folderId, container, isEmbedded } = useFolderContainerScope()

const editingNoteId = ref<string | null>(null)
provideEditingNoteId(editingNoteId)

const sectionEl = useTemplateRef<HTMLElement>('sectionEl')
const paneWidth = ref(0)
const columnsOf = ref<number[][]>([])
const heightById = new Map<string, number>()
let lastIds = ''
let lastCount = -1
let frame = 0
let resizeObserver: ResizeObserver | null = null
const observed = new Set<Element>()

const children = computed(() => container.value?.children ?? [])
const childKey = computed(() => children.value.map(child => child.id).join('\0'))
const columnWidth = computed(() => masonryColumnWidth(container.value?.masonry_column_width))
const maxColumns = computed(() => {
	const stored = container.value?.masonry_columns
	return typeof stored === 'number' && stored >= 1 ? stored : null
})
const columnCount = computed(() => masonryColumnCount(paneWidth.value, columnWidth.value, maxColumns.value))

const sectionStyle = computed(() => backgroundStyle(container.value?.background, defaultViewBackground))

const stripStyle = computed(() => {
	const count = Math.max(1, columnsOf.value.length || columnCount.value)
	const width = count * columnWidth.value + Math.max(0, count - 1) * MASONRY_GAP
	return {
		width: `${width}px`,
		gap: `${MASONRY_GAP}px`,
	}
})

const colStyle = computed(() => ({
	width: `${columnWidth.value}px`,
	gap: `${MASONRY_GAP}px`,
}))

function heightsOf(): number[] {
	return children.value.map(child => heightById.get(child.id) ?? 0)
}

function assign(force: boolean) {
	const next = layoutMasonry(heightsOf(), columnCount.value)
	if (force || !sameMasonryColumns(columnsOf.value, next)) columnsOf.value = next
	lastIds = childKey.value
	lastCount = columnCount.value
}

function measureAndApply() {
	const root = sectionEl.value
	if (!root) return
	paneWidth.value = root.clientWidth
	// Editing freezes only height-driven reflow. A new child or a new column
	// count still lays out, or the new card never appears and a resize keeps
	// the old number of columns.
	const structural = childKey.value !== lastIds || columnCount.value !== lastCount
	if (editingNoteId.value && !structural) return
	for (const el of root.querySelectorAll<HTMLElement>('[data-masonry-card]')) {
		const id = el.dataset.itemId
		if (id) heightById.set(id, el.offsetHeight)
	}
	assign(structural)
}

function schedule() {
	if (frame) return
	frame = requestAnimationFrame(() => {
		frame = 0
		measureAndApply()
		void nextTick(syncObserved)
	})
}

function syncObserved() {
	const root = sectionEl.value
	if (!root || !resizeObserver) return
	const next = new Set<Element>([root, ...root.querySelectorAll('[data-masonry-card]')])
	for (const el of observed) {
		if (!next.has(el)) resizeObserver.unobserve(el)
	}
	for (const el of next) {
		if (!observed.has(el)) resizeObserver.observe(el)
	}
	observed.clear()
	for (const el of next) observed.add(el)
}

watch([childKey, columnCount], () => {
	assign(true)
	void nextTick(() => {
		syncObserved()
		schedule()
	})
}, { immediate: true })

watch(editingNoteId, (id, prev) => {
	if (prev && !id) schedule()
})

onMounted(() => {
	registerPaneEditingNoteSetter(folderId.value, (noteId) => {
		editingNoteId.value = noteId
	})
	const el = sectionEl.value
	if (!el) return
	resizeObserver = new ResizeObserver(() => schedule())
	resizeObserver.observe(el)
	syncObserved()
	schedule()
})

onBeforeUnmount(() => {
	registerPaneEditingNoteSetter(folderId.value, null)
	if (frame) cancelAnimationFrame(frame)
	resizeObserver?.disconnect()
	resizeObserver = null
	observed.clear()
})

const { onSectionClick } = useClickOutsideEditingNote('.masonry-note', editingNoteId)
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
		<div v-else class="masonry-strip" :style="stripStyle">
			<div
				v-for="(column, colIndex) in columnsOf"
				:key="colIndex"
				class="masonry-col"
				:style="colStyle"
			>
				<MasonryCard
					v-for="index in column"
					:key="children[index]!.id"
					:widget="children[index]!"
				/>
			</div>
		</div>
	</section>
	<USeparator v-if="!isEmbedded" />
</template>

<style scoped>
.masonry {
	min-height: 100%;
	display: flex;
	justify-content: center;
	align-items: flex-start;
}

.masonry-empty {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 2rem;
	width: 100%;
}

.masonry-strip {
	display: flex;
	align-items: flex-start;
	max-width: 100%;
}

.masonry-col {
	display: flex;
	flex-direction: column;
	flex: none;
	min-width: 0;
}
</style>
