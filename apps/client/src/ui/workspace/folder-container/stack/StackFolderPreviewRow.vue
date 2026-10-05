<script setup lang="ts">
import type { FolderContainerWidget } from '@/domain/Widget'
import FolderMenu from '@/ui/workspace/menu/FolderMenu.vue'
import LazyFolderPreview from '../widgets/LazyFolderPreview.vue'
import { useMenuNode } from '../widgets/useMenuNode'
import StackRowChrome from './StackRowChrome.vue'

const props = defineProps<{
	widget: FolderContainerWidget
}>()

const menuNode = useMenuNode(() => props.widget)
</script>

<template>
	<StackRowChrome class="stack-folder-preview-row" :widget-id="widget.id">
		<div class="stack-folder-preview-main">
			<LazyFolderPreview :container="widget" />
		</div>
		<template #menu>
			<FolderMenu
				:node="menuNode"
				:is-preview="true"
				:show-preview-toggle="true"
			/>
		</template>
	</StackRowChrome>
</template>
