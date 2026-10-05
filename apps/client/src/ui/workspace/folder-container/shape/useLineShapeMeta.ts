import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import {
	is_line_shape,
	parse_line_meta,
	type LineShapeMeta,
} from '@/services/board/shapes'
import { useShapeContent } from './useShapeContent'

/**
 * Reactive line/arrow metadata from the shape SVG cache.
 * Pass `enabled=false` for non-shape widgets so we never read folders/files as SVG.
 */
export function useLineShapeMeta(
	fileId: MaybeRefOrGetter<string>,
	enabled: MaybeRefOrGetter<boolean> = true,
) {
	const activeId = computed(() => (toValue(enabled) ? toValue(fileId) : ''))
	const { svgHtml, loading } = useShapeContent(activeId)

	const isLine = computed(
		() => toValue(enabled) && is_line_shape(svgHtml.value),
	)

	const meta = computed<LineShapeMeta | null>(() => {
		if (!toValue(enabled) || !svgHtml.value || !isLine.value) return null
		return parse_line_meta(svgHtml.value)
	})

	return { isLine, meta, loading, svgHtml }
}
