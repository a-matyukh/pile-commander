<script setup lang="ts">
import type { Position } from '@/domain/Widget'
import { useFolderContainerScope } from '@/ui/workspace/folder-container/useFolderContainerScope'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import { useFolderContainerMenuItems } from './useFolderContainerMenuItems'
import ItemsCtxMenu from '@/ui/kit/ItemsCtxMenu.vue'
import { item_look, view_label } from '@/ui/kit/items_menu_labels'
import BackgroundItems from '@/ui/explorer/folder-header/BackgroundItems.vue'

const props = defineProps<{
	loading?: boolean
	position?: Position | null
	/** Read-only panes render no menu at all (every item would be disabled). */
	disabled?: boolean
}>()

const { folderId } = useFolderContainerScope()
const workspace = useWorkspace()

const { items } = useFolderContainerMenuItems({
	position: () => props.position,
	loading: () => props.loading,
})
</script>

<template>
	<ItemsCtxMenu v-if="!props.disabled" :items="items" :width="240">
		<slot />
		<template #grid-background>
			<BackgroundItems v-if="workspace" :workspace="workspace" :folder_id="folderId" />
		</template>
		<template #view-trailing="{ item }">{{ view_label((item as { currentViewLabel?: string }).currentViewLabel) }}</template>
	</ItemsCtxMenu>
	<slot v-else />
</template>
