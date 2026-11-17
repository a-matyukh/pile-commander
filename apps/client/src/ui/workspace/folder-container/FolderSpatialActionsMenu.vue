<script setup lang="ts">
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import { useFolderContainerMenuItems } from '@/ui/workspace/menu/useFolderContainerMenuItems'
import { useFolderContainerScope } from './useFolderContainerScope'
import ItemsDropMenu from '@/ui/kit/ItemsDropMenu.vue'
import { item_look, view_label } from '@/ui/kit/items_menu_labels'
import { resolvePaneCenterPosition } from './panePosition'
import { t } from '@/i18n'
import MenuSub from '@/ui/kit/MenuSub.vue'
import { use_folder_place } from '@/ui/explorer/folder-header/use_folder_place'
import AiItems from '@/ui/explorer/folder-header/AiItems.vue'
import BackgroundItems from '@/ui/explorer/folder-header/BackgroundItems.vue'

const { folderId } = useFolderContainerScope()
const workspace = useWorkspace()
/** The open folder is named as its header names it */
const { folder_name } = use_folder_place()

const { items } = useFolderContainerMenuItems({
	position: () => resolvePaneCenterPosition(folderId.value),
})
</script>

<template>
	<ItemsDropMenu :items="items">
		<template #grid-background>
			<BackgroundItems v-if="workspace" :workspace="workspace" :folder_id="folderId" />
		</template>
		<template #ai>
			<MenuSub v-if="workspace" icon="tabler:text-scan-ai" :label="t('actions.ai')" :width="300">
				<AiItems :workspace="workspace" :folder_id="folderId" :name="folderId === workspace.opened_folder_id ? folder_name : undefined" :anchor="resolvePaneCenterPosition(folderId) ?? null" />
			</MenuSub>
		</template>
		<template #view-trailing="{ item }">{{ view_label((item as { currentViewLabel?: string }).currentViewLabel) }}</template>
	</ItemsDropMenu>
</template>
