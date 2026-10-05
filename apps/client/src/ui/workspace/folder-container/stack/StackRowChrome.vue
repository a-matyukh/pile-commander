<script setup lang="ts">
import DragHandle from '../widgets/DragHandle.vue'
import { useWidgetSelection } from '../widgets/useWidgetSelection'
import './stack-row.css'

const props = defineProps<{
	widgetId: string
}>()

const { isSelected, isCut, onSelectClick } = useWidgetSelection(() => props.widgetId)
</script>

<!-- Shared shell for stack rows: base row layout + drag handle + menu slot.
     Variant classes/styles fall through onto the root element. -->
<template>
	<div
		class="stack-row"
		:class="{ 'pc-selected': isSelected, 'pc-cut': isCut }"
		@click="onSelectClick"
	>
		<slot />
		<div class="stack-row-actions">
			<DragHandle handle-class="stack-drag-handle" />
			<slot name="menu" />
		</div>
	</div>
</template>
