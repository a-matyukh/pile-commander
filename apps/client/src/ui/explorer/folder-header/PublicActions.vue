<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import { t } from '@/i18n'
import store from '@/store'
import cloud from '@/store/cloud'
import { explorer_navigation } from '@/store/explorer/navigation'
import { public_roots } from '@/store/explorer/public_roots'
import { publication_view_of } from '@/store/explorer/public_view'
import HubReportButton from '@/ui/hub/HubReportButton.vue'
import Button from '@/ui/kit/Button.vue'
import DropMenu from '@/ui/kit/DropMenu.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import MenuItem from '@/ui/kit/MenuItem.vue'

/**
 * A publication's own actions in the folder header, as the old public
 * viewer had them: "Copy to my cloud" (Fork) or "Edit" for its owner and
 * editors, and in "⋯" downloading a .pile and reporting it. Its author is
 * in the path above its name
 */
const props = defineProps<{ workspace: WorkspaceStore; folder: FolderRef; align: 'start' | 'end' }>()

const root = computed(() => public_roots.get(props.folder.root_id) ?? null)
const open = ref(false)
const busy = ref(false)
const report = ref<InstanceType<typeof HubReportButton> | null>(null)
const can_report = ref(false)

/** cloud.fork() and "Edit" read the publication from the cloud store */
function as_current() {
	if (root.value) cloud.publication_view = publication_view_of(root.value)
}

async function fork() {
	if (!root.value || busy.value) return
	// a copy needs an account to land in
	if (!cloud.user) {
		void explorer_navigation.open_page('account')
		return
	}
	as_current()
	busy.value = true
	try {
		await cloud.fork()
	} finally {
		busy.value = false
	}
}

function edit() {
	as_current()
	void cloud.open_source_for_edit()
}

async function download() {
	if (busy.value) return
	busy.value = true
	try {
		await store.download_public_workspace(props.workspace)
	} finally {
		busy.value = false
	}
}
</script>

<template>
	<template v-if="root">
		<Button v-if="root.can_edit_source" icon="tabler:pencil" @click="edit">{{ t('public_view.edit') }}</Button>
		<Button v-else-if="root.can_fork" variant="primary" icon="tabler:git-fork" :loading="busy" @click="fork">
			{{ t('public_view.fork') }}
		</Button>
		<DropMenu v-if="!root.can_edit_source && (root.can_fork || can_report)" v-model:open="open" :width="220" :align="align">
			<template #trigger>
				<IconButton class="hb" :active="open" icon="tabler:dots" :aria-label="t('actions.folder_menu')" :data-tip="t('actions.folder_menu')" />
			</template>
			<MenuItem v-if="root.can_fork" icon="tabler:download" :label="t('public_view.download')" @select="download" />
			<MenuItem v-if="can_report" icon="tabler:flag" :label="t('public_view.report')" @select="report?.start_report()" />
		</DropMenu>
		<HubReportButton
			v-if="!root.can_edit_source"
			:key="root.id"
			ref="report"
			variant="modal"
			:workspace_id="root.id"
			:username="root.username"
			:slug="root.slug"
			:name="root.name"
			@visible-change="can_report = $event"
		/>
	</template>
</template>
