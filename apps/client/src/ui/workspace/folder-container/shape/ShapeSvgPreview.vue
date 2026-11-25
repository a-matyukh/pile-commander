<script setup lang="ts">
import { useTemplateRef, watch } from 'vue'
import { is_line_shape } from '@/services/board/shapes'
import { useShapeContent } from './useShapeContent'

const props = defineProps<{
	fileId: string
}>()

const { svgHtml, loading } = useShapeContent(() => props.fileId)

/**
 * The shape is drawn in a shadow root of its own. An SVG file may carry a
 * `<style>` block (recoloring edits it, so it cannot be dropped), and in the
 * app's document that block would apply to the whole app: a shape from
 * someone else's board could repaint the interface or cover it. Inside the
 * shadow root its rules reach the shape and nothing else.
 *
 * The same wall keeps the app's rules out, so what the board and the canvas
 * ask of a line (only its stroke and its head take the pointer; see
 * BoardWidgetShell.vue and CanvasWidgetNode.vue) is repeated here.
 */
const SHEET = [
	':host{display:block;width:100%;height:100%;min-width:0;min-height:0}',
	'svg{display:block;width:100%;height:100%}',
	':host([data-line]) *{pointer-events:none !important}',
	':host([data-line]) .pc-line-hit{pointer-events:stroke !important}',
	':host([data-line]) .pc-line-head{pointer-events:fill !important}',
	':host([data-line]) line:not(.pc-line-hit):not(.pc-line-stroke){pointer-events:stroke !important}',
].join('')

const host = useTemplateRef<HTMLElement>('host')

watch([host, svgHtml], ([element, html]) => {
	if (!element) return
	const root = element.shadowRoot ?? element.attachShadow({ mode: 'open' })
	// sanitized by prepare_svg_for_preview before it gets here
	root.innerHTML = html ? `<style>${SHEET}</style>${html}` : ''
	element.toggleAttribute('data-line', !!html && is_line_shape(html))
}, { immediate: true, flush: 'post' })
</script>

<template>
	<div class="shape-svg-preview">
		<div v-if="loading" class="shape-svg-loading text-muted text-sm">…</div>
		<div v-show="!loading && svgHtml" ref="host" class="shape-svg-inner" />
	</div>
</template>

<style scoped>
.shape-svg-preview {
	width: 100%;
	height: 100%;
	min-width: 0;
	min-height: 0;
	overflow: visible;
}

.shape-svg-inner {
	width: 100%;
	height: 100%;
	min-width: 0;
	min-height: 0;
}
</style>
