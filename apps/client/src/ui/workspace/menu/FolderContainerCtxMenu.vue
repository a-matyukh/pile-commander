<script setup lang="ts">
import type { Position } from '@/domain/Widget'
import { useFolderContainerScope } from '@/ui/workspace/folder-container/useFolderContainerScope'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import { useFolderContainerMenuItems } from './useFolderContainerMenuItems'
import ItemsCtxMenu from '@/ui/kit/ItemsCtxMenu.vue'
import { item_look, view_label } from '@/ui/kit/items_menu_labels'
import { t } from '@/i18n'
import MenuSub from '@/ui/kit/MenuSub.vue'
import { use_folder_place } from '@/ui/explorer/folder-header/use_folder_place'
import AiItems from '@/ui/explorer/folder-header/AiItems.vue'
import BackgroundItems from '@/ui/explorer/folder-header/BackgroundItems.vue'

const props = defineProps<{
	loading?: boolean
	position?: Position | null
	/** Read-only panes render no menu at all (every item would be disabled). */
	disabled?: boolean
}>()

const { folderId } = useFolderContainerScope()
const workspace = useWorkspace()
/** The open folder is named as its header names it */
const { folder_name } = use_folder_place()

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
		<template #ai>
			<MenuSub v-if="workspace" icon="tabler:text-scan-ai" :label="t('actions.ai')" :width="300">
				<AiItems :workspace="workspace" :folder_id="folderId" :name="folderId === workspace.opened_folder_id ? folder_name : undefined" :anchor="props.position ?? null" />
			</MenuSub>
		</template>
		<template #view-trailing="{ item }">{{ view_label((item as { currentViewLabel?: string }).currentViewLabel) }}</template>
	</ItemsCtxMenu>
	<slot v-else />
</template>
