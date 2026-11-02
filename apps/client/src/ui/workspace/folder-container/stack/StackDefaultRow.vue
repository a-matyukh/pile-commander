<script setup lang="ts">
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import FileMenu from '@/ui/workspace/menu/FileMenu.vue'
import FolderMenu from '@/ui/workspace/menu/FolderMenu.vue'
import { useMenuNode } from '../widgets/useMenuNode'
import { useWidgetInteraction } from '../widgets/useWidgetInteraction'
import StackRowChrome from './StackRowChrome.vue'
import { Icon } from '@iconify/vue'
import { use_widget_glyph } from '@/ui/explorer/views/use_widget_glyph'

const props = defineProps<{
	widget: FolderContainerWidgetChild
}>()

/** The row's icon, as List draws it */
const glyph = use_widget_glyph(() => props.widget)

const menuNode = useMenuNode(() => props.widget)

const { onDblClick } = useWidgetInteraction(() => props.widget, 'open')
</script>

<template>
	<StackRowChrome :widget-id="widget.id">
		<div class="stack-row-main" @dblclick="onDblClick">
			<Icon
				v-if="glyph"
				:icon="glyph.icon"
				class="ex-row-icon"
				:class="{ plain: glyph.plain }"
				:style="{ color: glyph.color }"
			/>
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
