<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { explorer_settings } from '@/store/explorer/settings'
import { splitFileName } from '@/ui/workspace/folder-container/widgets/fileNameParts'
import type { ItemGlyph } from './item_glyph'

/**
 * A tile of Gallery and of the cloud page, shaped as the old grid's. A file
 * is a portrait card as the old one: its name at the top left, its type's
 * icon at the bottom left (List's), the extension in gray at the bottom
 * right. A folder is a landscape card with a tab: its own icon or its
 * view's at the size the View menu sets, the name below. The "⋯" sits in
 * the corner, shown on hover or while selected
 */
const props = defineProps<{ glyph: ItemGlyph; name: string; folder?: boolean; selected?: boolean; dim?: boolean }>()

/** Both shapes are as tall; a folder's tab takes from its body */
const height = computed(() => Math.round(explorer_settings.gallery_icon * 1.5 + 64))
const width = computed(() => Math.round(height.value * (props.folder ? 1.3 : 0.85)))
const parts = computed(() => splitFileName(props.name))

/** Finder's tab: a rounded top left corner, a smooth slope down on the right; the folder's top line stays under it */
const TAB_H = 13
const tab_w = computed(() => Math.round(width.value * 0.42))
const tab_path = computed(() => {
	const w = tab_w.value
	const h = TAB_H
	const slope = 16
	return `M0.5 ${h} V6.5 Q0.5 0.5 6.5 0.5 H${w - slope} C${w - slope / 2} 0.5 ${w - slope / 2} ${h} ${w} ${h} Z`
})
</script>

<template>
	<div
		class="tile"
		:class="{ folder, s: selected, dim }"
		:style="{ '--ic': explorer_settings.gallery_icon + 'px', width: width + 'px', height: height + 'px' }"
	>
		<svg v-if="folder" class="tab" :width="tab_w" :height="TAB_H" aria-hidden="true">
			<path :d="tab_path" />
		</svg>
		<div v-if="folder" class="body">
			<div class="dots"><slot name="menu" /></div>
			<Icon :icon="glyph.icon" class="ic" :class="{ plain: glyph.plain }" :style="{ color: glyph.color }" />
			<span class="nm" :title="name">{{ name }}</span>
		</div>
		<div v-else class="body file" :title="name">
			<div class="dots"><slot name="menu" /></div>
			<span class="stem">{{ parts.stem }}</span>
			<div class="foot">
				<Icon :icon="glyph.icon" class="fi" :class="{ plain: glyph.plain }" :style="{ color: glyph.color }" />
				<span v-if="parts.extension" class="ext">{{ parts.extension }}</span>
			</div>
		</div>
	</div>
</template>

<style scoped>
.tile {
	--line: var(--border);
	--fill: var(--surface-2);
	position: relative;
	flex: none;
	display: flex;
	flex-direction: column;
	color: var(--text-primary);
	cursor: default;
	user-select: none;
	-webkit-user-select: none;
}
.body {
	position: relative;
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 8px;
	padding: 10px 8px;
	border: 1px solid var(--line);
	border-radius: 10px;
	background: var(--fill);
}
.tab {
	flex: none;
	display: block;
	overflow: visible;
}
.tab path {
	fill: var(--fill);
	stroke: var(--line);
	stroke-width: 1;
}
.body.file {
	align-items: stretch;
	justify-content: space-between;
	padding: 10px;
}
.stem {
	padding-right: 14px;
	font-size: 13px;
	line-height: 1.3;
	overflow: hidden;
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 4;
	line-clamp: 4;
	overflow-wrap: break-word;
}
.foot {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 6px;
	min-width: 0;
}
.fi {
	font-size: 16px;
	flex: none;
}
.ext {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 12px;
	color: var(--text-muted);
}
/* As Finder's: the tab's left side runs straight into the folder's */
.folder .body {
	border-top-left-radius: 0;
}
.ic {
	font-size: var(--ic);
	flex: none;
}
.plain {
	color: var(--text-secondary);
}
.nm {
	max-width: 100%;
	text-align: center;
	font-size: 12px;
	line-height: 1.3;
	overflow: hidden;
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
	line-clamp: 2;
	overflow-wrap: anywhere;
}
.dots {
	position: absolute;
	top: 3px;
	right: 3px;
	visibility: hidden;
}
.tile.s {
	--line: var(--border-accent);
	--fill: var(--bg-accent);
}
.tile.s .nm,
.tile.s .stem {
	color: var(--text-accent);
}
.tile.s .dots,
.dots:has(.on) {
	visibility: visible;
}
.tile.dim .ic,
.tile.dim .nm,
.tile.dim .stem,
.tile.dim .foot {
	opacity: .5;
}
.explorer.lg .nm {
	font-size: 14px;
}
.explorer.lg .stem {
	font-size: 15px;
}
.explorer.lg .fi {
	font-size: 19px;
}
.explorer.lg .ext {
	font-size: 13px;
}
@media (hover: hover) {
	.tile:not(.s):hover {
		--line: var(--border-strong);
	}
	.tile:hover .dots {
		visibility: visible;
	}
}
</style>
