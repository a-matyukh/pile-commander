<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { get_media_kind } from '@/services/board/media'
import { standard_folder_icon } from '@/store/explorer/folder_cover'
import { file_glyph, folder_glyph } from '@/ui/explorer/views/item_glyph'
import { useMediaSrc } from '@/ui/workspace/folder-container/media/useMediaSrc'
import { use_home } from './use_folder_place'

/** A layer row's mark: a picture's thumbnail, otherwise the icon List uses. */
const props = defineProps<{
	workspace: WorkspaceStore
	folder: FolderRef
	child: FolderContainerWidgetChild
}>()

const home = use_home()
const is_image = computed(() => props.child.type === 'file' && get_media_kind(props.child.name) === 'image')
const { src, error } = useMediaSrc(
	() => (is_image.value ? props.child.id : ''),
	() => props.child.name,
)
const shows = computed(() => Boolean(is_image.value && src.value && !error.value))

const glyph = computed(() => {
	if (props.child.type === 'file') return file_glyph(props.child.name)
	const own = props.workspace.folders[props.child.id]?.xattrs
	const listed = props.workspace.folders[props.folder.folder_id]?.children
		?.find(entry => entry.id === props.child.id)?.xattrs
	return folder_glyph(
		own ?? listed,
		standard_folder_icon({ ...props.folder, folder_id: props.child.id }, home.value),
	)
})
</script>

<template>
	<img v-if="shows" class="th" :src="src" alt="" draggable="false">
	<Icon
		v-else
		:icon="glyph.icon"
		class="gi"
		:class="{ plain: glyph.plain }"
		:style="glyph.color ? { color: glyph.color } : undefined"
	/>
</template>

<style scoped>
.gi {
	font-size: 16px;
	flex: none;
}
.plain {
	color: var(--text-secondary);
}
.th {
	width: 18px;
	height: 18px;
	object-fit: cover;
	border-radius: 3px;
	flex: none;
}
.explorer.lg .gi {
	font-size: 19px;
}
.explorer.lg .th {
	width: 22px;
	height: 22px;
}
</style>
