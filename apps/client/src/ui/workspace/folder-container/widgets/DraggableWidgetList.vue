<script setup lang="ts">
import draggable from 'vuedraggable'
import type { FolderContainerWidgetChild } from '@/domain/Widget'

withDefaults(defineProps<{
	/** Mutable array — Sortable splices in place (same as workspace TreeList). */
	list: FolderContainerWidgetChild[]
	handle: string
	ghostClass: string
	chosenClass: string
	disabled?: boolean
	group: { name: string }
	listClass?: string | Record<string, boolean>
	/** Optional per-item style on the Sortable root (e.g. masonry grid spans). */
	itemStyle?: (widget: FolderContainerWidgetChild) => Record<string, string>
	/**
	 * Sortable direction hint. CSS Grid needs `horizontal` so hit-testing
	 * does not treat the layout as a single vertical list.
	 */
	direction?: 'vertical' | 'horizontal'
}>(), {
	direction: 'vertical',
})

const emit = defineEmits<{
	start: []
	end: []
}>()
</script>

<!--
  The item slot MUST return a single real DOM vnode.
  Forwarding <slot> alone can yield a Fragment, so vuedraggable attaches
  data-draggable to a non-element and Sortable cannot drag.
-->
<template>
	<draggable
		:list="list"
		item-key="id"
		:handle="handle"
		:disabled="disabled"
		:group="group"
		:direction="direction"
		:animation="150"
		:force-fallback="true"
		:fallback-on-body="true"
		:swap-threshold="0.65"
		:invert-swap="direction === 'horizontal'"
		:ghost-class="ghostClass"
		:chosen-class="chosenClass"
		tag="div"
		:class="listClass"
		@start="emit('start')"
		@end="emit('end')"
	>
		<template #item="{ element, index }">
			<div
				class="draggable-item"
				:style="itemStyle?.(element)"
			>
				<slot
					name="item"
					:element="element"
					:index="index"
				/>
			</div>
		</template>
	</draggable>
</template>

<style scoped>
.draggable-item {
	min-width: 0;
	min-height: 0;
}
</style>
