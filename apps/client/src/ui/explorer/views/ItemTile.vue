<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { explorer_settings } from '@/store/explorer/settings'
import type { ItemGlyph } from './item_glyph'

/**
 * A tile of Gallery and of the cloud page, shaped as the old grid's: a file
 * is a portrait card, a folder a landscape one with a tab. Inside, the
 * item's icon (its type, or a folder's own icon) at the size the View menu
 * sets, its name below. The "⋯" sits in the corner, shown on hover or while
 * selected
 */
const props = defineProps<{ glyph: ItemGlyph; name: string; folder?: boolean; selected?: boolean; dim?: boolean }>()

/** Both shapes are as tall; a folder's tab takes from its body */
const height = computed(() => Math.round(explorer_settings.gallery_icon * 1.5 + 64))
const width = computed(() => Math.round(height.value * (props.folder ? 1.3 : 0.8)))
</script>

<template>
	<div
		class="tile"
		:class="{ folder, s: selected, dim }"
		:style="{ '--ic': explorer_settings.gallery_icon + 'px', width: width + 'px', height: height + 'px' }"
	>
		<span v-if="folder" class="tab" aria-hidden="true" />
		<div class="body">
			<div class="dots"><slot name="menu" /></div>
			<Icon :icon="glyph.icon" class="ic" :class="{ plain: glyph.plain }" :style="{ color: glyph.color }" />
			<span class="nm" :title="name">{{ name }}</span>
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
	width: 42%;
	height: 9px;
	flex: none;
	border: 1px solid var(--line);
	border-bottom: none;
	border-radius: 6px 6px 0 0;
	background: var(--fill);
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
.tile.s .nm {
	color: var(--text-accent);
}
.tile.s .dots,
.dots:has(.on) {
	visibility: visible;
}
.tile.dim .ic,
.tile.dim .nm {
	opacity: .5;
}
.explorer.lg .nm {
	font-size: 14px;
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
