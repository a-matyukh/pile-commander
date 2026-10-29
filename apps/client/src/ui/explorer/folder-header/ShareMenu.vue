<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import { t } from '@/i18n'
import { copy_to_cloud, export_folder, share_items } from '@/store/explorer/share'
import DropMenu from '@/ui/kit/DropMenu.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import MenuItem from '@/ui/kit/MenuItem.vue'
import { publish_dialog, share_dialog } from '../dialogs'

/**
 * "Share", as in the prototype. A cloud folder opens the old interface's
 * dialogs for its top-level folder. A folder on this Mac or in browser
 * storage is copied to the cloud first, then the same dialog opens there
 */
const props = defineProps<{ folder: FolderRef; name: string; align: 'start' | 'end' }>()

const open = ref(false)
const items = computed(() => share_items(props.folder))
const cloud_folder = computed(() => props.folder.drive_id === 'cloud')

function share_with() {
	if (cloud_folder.value) share_dialog.value?.open(props.folder.root_id)
	else copy_to_cloud(props.folder, props.name, 'share')
}

function publish() {
	if (cloud_folder.value) publish_dialog.value?.open(props.folder.root_id)
	else copy_to_cloud(props.folder, props.name, 'publish')
}
</script>

<template>
	<DropMenu v-if="items.export || items.share_with || items.publish" v-model:open="open" :width="230" :align="align">
		<template #trigger>
			<IconButton
				class="hb"
				:active="open"
				icon="tabler:share-2"
				:icon_size="18"
				:aria-label="t('actions.share')"
				:data-tip="t('actions.share')"
			/>
		</template>
		<MenuItem v-if="items.export" icon="tabler:file-export" :label="t('share.export')" @select="export_folder(folder, name)" />
		<MenuItem v-if="items.share_with" icon="tabler:user-plus" :label="t('share.share_with')" @select="share_with" />
		<MenuItem v-if="items.publish" icon="tabler:world-upload" :label="t('share.publish')" @select="publish" />
	</DropMenu>
</template>
