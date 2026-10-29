<script setup lang="ts">
import { computed } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import FileMenu from '@/ui/workspace/menu/FileMenu.vue'
import FolderMenu from '@/ui/workspace/menu/FolderMenu.vue'
import { useMenuNode } from '../widgets/useMenuNode'
import { useWidgetInteraction } from '../widgets/useWidgetInteraction'
import { widgetIcon } from '../widgets/widgetIcon'
import StackRowChrome from './StackRowChrome.vue'
import { Icon } from '@iconify/vue'
import { explorer_mounted } from '@/store/explorer/public_view'
import { use_widget_glyph } from '@/ui/explorer/views/use_widget_glyph'

const props = defineProps<{
	widget: FolderContainerWidgetChild
}>()

const iconName = computed(() => widgetIcon(() => props.widget))

/** In the Explorer the row's icon is List's */
const glyph = use_widget_glyph(() => props.widget)

const menuNode = useMenuNode(() => props.widget)

const { onDblClick } = useWidgetInteraction(() => props.widget, 'open')
</script>

<template>
	<StackRowChrome :widget-id="widget.id">
		<div class="stack-row-main" @dblclick="onDblClick">
			<Icon
				v-if="explorer_mounted && glyph"
				:icon="glyph.icon"
				class="ex-row-icon"
				:class="{ plain: glyph.plain }"
				:style="{ color: glyph.color }"
			/>
			<UIcon v-else :name="iconName" class="size-5 shrink-0" />
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
