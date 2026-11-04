<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { t } from '@/i18n'
import cloud from '@/store/cloud'
import { export_anchor } from '@/store/explorer/exportPile'
import { SHARE_WINDOWS, close_share_publish, share_publish } from '@/store/explorer/sharePublishPanel'
import Button from '@/ui/kit/Button.vue'
import Modal from '@/ui/kit/Modal.vue'
import PanelFrame from './PanelFrame.vue'
import HubPanel from './share/HubPanel.vue'
import LinkPanel from './share/LinkPanel.vue'
import PeoplePanel from './share/PeoplePanel.vue'
import { create_publication, provide_publication } from './share/usePublication'
import { use_anchored_panel } from './useAnchoredPanel'

/**
 * The window under Share: one of people, public link or Hub at a time.
 * Each window is its own component; the link and Hub ones share the
 * folder's publication, loaded here.
 */
const pub = create_publication()
provide_publication(pub)

const { style } = use_anchored_panel(
	() => export_anchor.value,
	() => [share_publish.open, share_publish.window, share_publish.workspace_id, export_anchor.value],
)

const entry = computed(() => SHARE_WINDOWS.find(item => item.window === share_publish.window) ?? SHARE_WINDOWS[0]!)

const mark = computed(() => {
	if (!pub.username.value || pub.loading.value) return ''
	if (share_publish.window === 'link' && pub.is_public.value) return t('publish.open_badge')
	if (share_publish.window === 'hub' && pub.on_hub.value) return t('publish.listed_badge')
	return ''
})

const confirm_open = computed({
	get: () => pub.confirm_kind.value !== null,
	set: (value: boolean) => {
		if (!value) pub.confirm_kind.value = null
	},
})
const delist = computed(() => pub.confirm_kind.value === 'delist')

watch(
	() => share_publish.open ? share_publish.workspace_id : '',
	id => void pub.load(id),
	{ immediate: true },
)

onBeforeUnmount(pub.reset)

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
	if (!share_publish.open || event.key !== 'Escape') return
	if (document.querySelector('.mn[data-state="open"]')) return
	if (document.querySelector('.dlg[data-state="open"]')) return
	close_share_publish()
})
</script>

<template>
	<PanelFrame
		v-if="share_publish.open"
		kind="share"
		:icon="entry.icon"
		:title="t(entry.label)"
		:mark="mark"
		:style="style"
		@close="close_share_publish"
	>
		<div class="body">
			<p v-if="cloud.last_error" class="err">{{ cloud.last_error }}</p>
			<PeoplePanel v-if="share_publish.window === 'people'" />
			<LinkPanel v-else-if="share_publish.window === 'link'" />
			<HubPanel v-else />
		</div>
	</PanelFrame>
	<Modal
		v-model:open="confirm_open"
		:title="delist ? t('publish.delist_title') : t('publish.unpublish_title')"
		:description="delist ? t('publish.delist_body') : t('publish.unpublish_body')"
	>
		<template #footer>
			<Button @click="pub.confirm_kind.value = null">{{ t('dialog.cancel') }}</Button>
			<Button variant="danger" :loading="pub.saving.value" @click="pub.confirm">
				{{ delist ? t('publish.delist_confirm') : t('publish.unpublish_confirm') }}
			</Button>
		</template>
	</Modal>
</template>

<style scoped>
.body {
	display: flex;
	flex-direction: column;
	gap: 10px;
	max-height: min(72vh, 600px);
	margin-top: 10px;
	padding: 0 2px 2px;
	overflow: auto;
	line-height: 1.45;
}
.err {
	margin: 0;
	color: var(--text-danger);
}
</style>
