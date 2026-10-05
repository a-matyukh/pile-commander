<script setup lang="ts">
import { computed } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import FileMenu from '@/ui/workspace/menu/FileMenu.vue'
import FolderMenu from '@/ui/workspace/menu/FolderMenu.vue'
import { useMenuNode } from '../widgets/useMenuNode'
import { useWidgetInteraction } from '../widgets/useWidgetInteraction'
import { widgetIcon } from '../widgets/widgetIcon'
import StackRowChrome from './StackRowChrome.vue'

const props = defineProps<{
	widget: FolderContainerWidgetChild
}>()

const iconName = computed(() => widgetIcon(() => props.widget))

const menuNode = useMenuNode(() => props.widget)

const { onDblClick } = useWidgetInteraction(() => props.widget, 'open')
</script>

<template>
	<StackRowChrome :widget-id="widget.id">
		<div class="stack-row-main" @dblclick="onDblClick">
			<UIcon :name="iconName" class="size-5 shrink-0" />
			<p class="min-w-0 truncate font-medium text-highlighted">
				{{ widget.name }}
			</p>
		</div>
		<template #menu>
			<FileMenu
				v-if="widget.type === 'file'"
				:node="menuNode"
				:is-preview="widget.is_preview ?? false"
				:show-preview-toggle="true"
			/>
			<FolderMenu
				v-else
				:node="menuNode"
				:is-preview="widget.is_preview ?? false"
				:show-preview-toggle="true"
			/>
		</template>
	</StackRowChrome>
</template>
