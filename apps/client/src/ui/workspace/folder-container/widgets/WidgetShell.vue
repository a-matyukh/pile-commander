<script setup lang="ts">
import { computed, useAttrs } from 'vue'
import BoardWidgetShell from './BoardWidgetShell.vue'
import MasonryWidgetShell from './MasonryWidgetShell.vue'
import type { WidgetShellVariantProps } from './widgetShellProps'

// v-if/v-else is a fragment root — attrs (dblclick, etc.) must be bound explicitly.
defineOptions({ inheritAttrs: false })

// Without an explicit default Vue casts the absent boolean prop to `false`,
// and spreading it below would pass that `false` on to the variant shells,
// overriding their own `interactionsEnabled: true` defaults.
const props = withDefaults(defineProps<WidgetShellVariantProps & {
	layout: 'board' | 'masonry'
}>(), {
	interactionsEnabled: true,
})

const attrs = useAttrs()

/** Props + fallthrough listeners for the active layout shell. */
const shellBind = computed(() => {
	const { layout: _layout, ...rest } = props
	return { ...rest, ...attrs }
})
</script>

<!-- Thin dispatcher: each layout variant owns its interact binding, chrome, and styles. -->
<template>
	<BoardWidgetShell v-if="layout === 'board'" v-bind="shellBind">
		<slot />
	</BoardWidgetShell>
	<MasonryWidgetShell v-else v-bind="shellBind">
		<slot />
	</MasonryWidgetShell>
</template>
