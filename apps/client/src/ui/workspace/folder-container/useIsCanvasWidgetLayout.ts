import { computed, inject } from 'vue'
import { widgetLayoutModeKey } from './injectKeys'
import { resolveIsCanvasWidgetLayout } from './resolveIsCanvasWidgetLayout'
import { useFolderContainerScope } from './useFolderContainerScope'

export function useIsCanvasWidgetLayout() {
	const layoutMode = inject(widgetLayoutModeKey, 'board')
	const { container, isEmbedded } = useFolderContainerScope()

	return computed(() =>
		resolveIsCanvasWidgetLayout(
			layoutMode,
			isEmbedded,
			container.value?.view,
		),
	)
}
