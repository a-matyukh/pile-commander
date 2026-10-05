<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import {
	SHAPE_TEMPLATE_LABELS,
	SHAPE_TEMPLATES,
	type ShapeTemplate,
} from '@/domain/shapes'
import { useBoardPlacement } from './board/boardShapePlacement'
import { useWorkspace } from '@/ui/workspace/useWorkspace'

const { boardPlacementTemplate, clearBoardPlacement } = useBoardPlacement()

const workspace = useWorkspace()
const can_write = computed(() => workspace.value?.can_write !== false)

function selectTemplate(template: ShapeTemplate) {
	boardPlacementTemplate.value = template
}

function onKeyDown(event: KeyboardEvent) {
	if (event.key === 'Escape') {
		clearBoardPlacement()
	}
}

onMounted(() => {
	window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
	clearBoardPlacement()
	window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
	<div v-if="can_write" class="board-shape-toolbar flex items-center gap-1">
		<UButton
			v-for="template in SHAPE_TEMPLATES"
			:key="template"
			size="xs"
			color="neutral"
			variant="ghost"
			:class="{ 'is-active': boardPlacementTemplate === template }"
			:title="SHAPE_TEMPLATE_LABELS[template]"
			@click="selectTemplate(template)"
		>
			<UIcon
				:name="template === 'rect' ? 'mdi:square-outline'
					: template === 'ellipse' ? 'mdi:circle-outline'
					: template === 'triangle' ? 'mdi:triangle-outline'
					: template === 'diamond' ? 'mdi:diamond-outline'
					: 'mdi:arrow-top-right'"
				class="size-4"
			/>
		</UButton>
	</div>
</template>

<style scoped>
.board-shape-toolbar :deep(.is-active) {
	background-color: var(--pc-bg-muted);
	outline: 1px solid #6366f1;
}
</style>
