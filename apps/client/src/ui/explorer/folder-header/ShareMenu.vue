<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import { t } from '@/i18n'
import { normalize_workspace_id } from '@/services/workspace/paths'
import bridge, { reveal_bridge } from '@/store/bridge'
import { bridge_hidden_tip } from '@/store/bridgePanel'
import { export_anchor, set_export_anchor } from '@/store/explorer/exportPile'
import { export_folder, open_shared_cloud, share_items } from '@/store/explorer/share'
import { SHARE_WINDOWS, type ShareWindow } from '@/store/explorer/sharePublishPanel'
import DropMenu from '@/ui/kit/DropMenu.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import MenuItem from '@/ui/kit/MenuItem.vue'

/**
 * "Share", as in the prototype. A cloud folder, or a folder on this Mac that
 * already syncs with one, opens the share panel for that cloud folder. A
 * folder that is not synced is copied to the cloud first
 */
const props = defineProps<{ folder: FolderRef; name: string; align: 'start' | 'end' }>()

const open = ref(false)
const anchor = ref<HTMLElement | null>(null)
const items = computed(() => share_items(props.folder))
const windows = computed(() => SHARE_WINDOWS.filter(item =>
	item.window === 'people' ? items.value.share_with : items.value.publish,
))
const source_id = computed(() => normalize_workspace_id(props.folder.folder_id))
const hidden_tip = computed(() => bridge_hidden_tip({
	open: bridge.open,
	step: bridge.step,
	door: bridge.door,
	source_id: bridge.source?.id ?? null,
	progress: bridge.progress,
}, source_id.value, 'share'))

let published: HTMLElement | null = null

function publish_anchor() {
	if (!anchor.value) {
		if (published && export_anchor.value?.el === published) set_export_anchor(null)
		published = null
		return
	}
	published = anchor.value
	set_export_anchor({ el: anchor.value, align: props.align })
}

onMounted(publish_anchor)
watch(anchor, publish_anchor)
watch(() => props.align, publish_anchor)
onBeforeUnmount(() => {
	if (published && export_anchor.value?.el === published) set_export_anchor(null)
})

function open_window(window: ShareWindow) {
	open_shared_cloud(props.folder, props.name, window)
}
</script>

<template>
	<div v-if="items.export || items.share_with || items.publish" ref="anchor" class="share">
		<IconButton
			v-if="hidden_tip"
			class="hb spin"
			icon="tabler:share-2"
			:icon_size="18"
			:aria-label="hidden_tip"
			:data-tip="hidden_tip"
			@click="reveal_bridge"
		/>
		<DropMenu v-else v-model:open="open" :width="280" :align="align">
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
			<MenuItem
				v-for="item in windows"
				:key="item.window"
				:icon="item.icon"
				:label="t(item.label)"
				@select="open_window(item.window)"
			/>
		</DropMenu>
	</div>
</template>

<style scoped>
.share {
	display: flex;
}
.spin :deep(svg) {
	animation: share-spin 1s linear infinite;
}
@keyframes share-spin {
	to {
		transform: rotate(360deg);
	}
}
</style>
