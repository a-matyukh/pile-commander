<script setup lang="ts">
import { computed, ref } from 'vue'
import { FOLDER_VIEWS, type FolderView } from '@/domain/Widget'
import type { WorkspaceStore } from '@/domain/Store'
import { t } from '@/i18n'
import { FOLDER_VIEW_META } from '@/store/explorer/folder_header'
import { entry_view } from '@/store/explorer/tree_view'
import DropMenu from '@/ui/kit/DropMenu.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import MenuItem from '@/ui/kit/MenuItem.vue'
import MenuLabel from '@/ui/kit/MenuLabel.vue'

/** Folder view switch. Stored in the folder's attributes, so it survives a restart */
const props = defineProps<{ workspace: WorkspaceStore; folder_id: string; align: 'start' | 'end' }>()

const open = ref(false)
/** Keeps the checkmark on the choice while the attribute is written */
const pending = ref<FolderView | null>(null)

const current = computed<FolderView>(() => {
	if (pending.value) return pending.value
	return entry_view(props.workspace.resolve_folder_data(props.folder_id) ?? undefined)
})
const meta = computed(() => FOLDER_VIEW_META[current.value])

function set_view(view: FolderView) {
	if (view === current.value) return
	pending.value = view
	// Errors land in workspace.last_error, which the shell shows
	void props.workspace.change_folder_view(props.folder_id, view)
		.catch(() => {})
		.finally(() => { pending.value = null })
}
</script>

<template>
	<IconButton
		v-if="!workspace.can_write"
		class="hb"
		disabled
		:icon="meta.icon"
		:icon_color="meta.color ?? undefined"
		:icon_size="18"
		:aria-label="t('actions.view')"
		:data-tip="t('actions.view')"
	/>
	<DropMenu v-else v-model:open="open" :width="250" :align="align">
		<template #trigger>
			<IconButton
				class="hb"
				:active="open"
				:icon="meta.icon"
				:icon_color="meta.color ?? undefined"
				:icon_size="18"
				:aria-label="t('actions.view')"
				:data-tip="t('actions.view')"
			/>
		</template>
		<MenuLabel :label="t('view_menu.title')" />
		<MenuItem
			v-for="key in FOLDER_VIEWS"
			:key="key"
			:icon="FOLDER_VIEW_META[key].icon"
			:icon_color="FOLDER_VIEW_META[key].color ?? undefined"
			:label="t(FOLDER_VIEW_META[key].label_key)"
			:checked="key === current"
			keep_open
			@select="set_view(key)"
		/>
	</DropMenu>
</template>
