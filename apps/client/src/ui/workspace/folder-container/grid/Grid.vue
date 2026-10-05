<script setup lang="ts">
import { computed } from 'vue'
import { useFolderContainerScope } from '../useFolderContainerScope'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'
import FileMenu from '@/ui/workspace/menu/FileMenu.vue'
import FolderMenu from '@/ui/workspace/menu/FolderMenu.vue'
import { menuNodeFor } from '../widgets/useMenuNode'
import { splitFileName } from '../widgets/fileNameParts'

const { folderId, container } = useFolderContainerScope()
const requireWorkspace = useRequireWorkspace()
const ws = requireWorkspace()

const children = computed(() => container.value?.children ?? [])

function onSelectClick(event: MouseEvent, id: string) {
	event.stopPropagation()
	if (!ws.can_select_with_click(event)) return
	ws.toggle_selection(id)
}

function onSelectStart(event: Event) {
	event.preventDefault()
}

function onDblClick(event: MouseEvent, widget: (typeof children.value)[number]) {
	event.preventDefault()
	window.getSelection()?.removeAllRanges()
	void ws.open(widget)
}
</script>

<template>
	<div class="grid-view">
		<section :data-path="folderId">
		<template
			v-for="widget in children"
			:key="widget.id"
		>
			<FileMenu
				v-if="widget.type === 'file'"
				:node="menuNodeFor(widget)"
			>
				<div
					class="entry entry--file"
					:class="{ 'pc-selected': ws.is_selected(widget.id), 'pc-cut': ws.is_cut(widget.id) }"
					@click="onSelectClick($event, widget.id)"
					@selectstart="onSelectStart"
					@dblclick="onDblClick($event, widget)"
				>
					<p class="entry-file-stem font-medium text-highlighted">
						{{ splitFileName(widget.name).stem }}
					</p>
					<p
						v-if="splitFileName(widget.name).extension"
						class="entry-file-ext font-medium text-highlighted"
					>
						{{ splitFileName(widget.name).extension }}
					</p>
				</div>
			</FileMenu>
			<FolderMenu
				v-else
				:node="menuNodeFor(widget)"
			>
				<div
					class="entry entry--folder"
					:class="{ 'pc-selected': ws.is_selected(widget.id), 'pc-cut': ws.is_cut(widget.id) }"
					@click="onSelectClick($event, widget.id)"
					@selectstart="onSelectStart"
					@dblclick="onDblClick($event, widget)"
				>
					<span class="entry-folder-tab" aria-hidden="true" />
					<p class="entry-folder-name font-medium text-highlighted">{{ widget.name }}</p>
				</div>
			</FolderMenu>
		</template>
		</section>
	</div>
</template>

<style scoped>
.grid-view {
	display: flex;
	flex-direction: column;
	width: 100%;
	height: 100%;
	min-height: 0;
}

section {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	padding: 20px;
	min-height: 0;
	overflow: auto;
	user-select: none;
	-webkit-user-select: none;
	-webkit-touch-callout: none;
}

section .entry {
	position: relative;
	width: 100px;
	height: 100px;
	border: 1px solid var(--pc-border);
	border-radius: 5px;
	cursor: pointer;
	font-size: 14px;
	padding: 10px;
	user-select: none;
	-webkit-user-select: none;
	-webkit-touch-callout: none;
	background-color: white;
	box-sizing: border-box;
}

section .entry--file {
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	gap: 0.25rem;
	min-height: 0;
}

section .entry--folder {
	display: flex;
	align-items: center;
	justify-content: center;
	text-align: center;
	/* Tab sits above the tile; shorten body so bottoms align with files. */
	margin-top: 8px;
	height: 92px;
	width: 120px;
	/* Border is painted on ::after so the tab can sit underneath it. */
	border-color: transparent;
	isolation: isolate;
}

section .entry--folder::after {
	content: '';
	position: absolute;
	inset: 0;
	border: 1px solid var(--pc-border);
	border-radius: 5px;
	pointer-events: none;
	z-index: 1;
}

.entry-folder-tab {
	position: absolute;
	top: -10px;
	left: 0;
	width: 48px;
	/* +1px overlaps the tile top border so the tab joins cleanly. */
	height: 12px;
	box-sizing: border-box;
	background-color: inherit;
	border: 1px solid var(--pc-border);
	border-bottom: none;
	border-radius: 4px 4px 0 0;
	pointer-events: none;
	z-index: 0;
}

.entry-folder-name {
	margin: 0;
	min-height: 0;
	overflow: hidden;
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 4;
	line-clamp: 4;
	word-break: break-word;
	overflow-wrap: anywhere;
	max-width: 100%;
}

.entry-file-stem {
	margin: 0;
	min-height: 0;
	overflow: hidden;
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 4;
	line-clamp: 4;
	word-break: break-word;
	overflow-wrap: anywhere;
	align-self: flex-start;
	max-width: 100%;
}

.entry-file-ext {
	margin: 0;
	flex-shrink: 0;
	align-self: flex-end;
	max-width: 100%;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	opacity: 0.7;
	font-size: 0.85em;
}
</style>
