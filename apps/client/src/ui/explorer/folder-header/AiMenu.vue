<script setup lang="ts">
import { computed, ref } from 'vue'
import type { WorkspaceStore } from '@/domain/Store'
import { t } from '@/i18n'
import { name_target_kind } from '@/services/ai/naming'
import { summary_entries, summary_position } from '@/services/ai/summarize'
import { to_folder_container } from '@/services/workspace/folderContainer'
import { ai_available, ai_base_check, ai_ready } from '@/store/ai'
import { open_bulk_rename } from '@/store/aiBulkRename'
import { open_ideas } from '@/store/aiIdeas'
import { open_sort } from '@/store/aiSort'
import { open_summary } from '@/store/aiSummary'
import { explorer_navigation } from '@/store/explorer/navigation'
import { settings_tab } from '@/store/explorer/settings'
import DropMenu from '@/ui/kit/DropMenu.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import MenuItem from '@/ui/kit/MenuItem.vue'
import MenuLabel from '@/ui/kit/MenuLabel.vue'

/**
 * "AI", as in the prototype, with the current app's AI actions: a summary
 * of the folder ("Summarize board"), names by content ("Suggest names") and
 * ideas as new notes ("Generate ideas", an empty folder too: the person can
 * say what about). The button is always there: without a provider and a
 * model the menu says so and leads to the AI settings
 */
const props = defineProps<{ workspace: WorkspaceStore; folder_id: string; name: string; align: 'start' | 'end' }>()

const open = ref(false)

const container = computed(() => {
	const folder = props.workspace.folders[props.folder_id]
	return folder ? to_folder_container(folder, props.workspace.preview_folders) : null
})
const children = computed(() => container.value?.children ?? [])
const usable = computed(() => ai_available(props.workspace))

/** Notes, folders and images: what a name can be suggested for */
const nameable = computed(() => children.value
	.map(child => ({
		id: child.id,
		name: child.name,
		type: (child.type === 'folder_container' || child.type === 'folder_cover' ? 'folder' : 'file') as 'file' | 'folder',
	}))
	.filter(entry => name_target_kind(entry) !== null))

function summarize() {
	const folder = container.value
	if (!folder) return
	open_summary({
		workspace: props.workspace,
		folder_id: folder.id,
		board_name: folder.name,
		entries: summary_entries(folder.children),
		position: summary_position(folder.children),
	})
}

function suggest_names() {
	open_bulk_rename(props.workspace, props.folder_id, nameable.value)
}

function sort_into_folders() {
	const folder = container.value
	if (!folder) return
	open_sort({
		workspace: props.workspace,
		folder_id: folder.id,
		board_name: folder.name,
		entries: summary_entries(folder.children),
	})
}

function generate_ideas() {
	const folder = container.value
	if (!folder) return
	open_ideas({
		workspace: props.workspace,
		folder_id: folder.id,
		board_name: folder.name,
		entries: summary_entries(folder.children),
		anchor: null,
	})
}

/** The settings page, on its AI tab */
function open_settings() {
	settings_tab.value = 'ai'
	void explorer_navigation.open_page('settings')
}
</script>

<template>
	<DropMenu v-model:open="open" :width="300" :align="align">
		<template #trigger>
			<IconButton
				class="hb"
				:active="open"
				icon="tabler:text-scan-ai"
				:icon_size="18"
				:aria-label="t('actions.ai')"
				:data-tip="t('actions.ai')"
			/>
		</template>
		<MenuLabel :label="t('ai.folder_title', { name })" />
		<template v-if="!ai_ready">
			<!-- What is missing, exactly: often only the model -->
			<p class="hint">{{ ai_base_check.ok ? t('ai.setup_model_hint') : t('ai.setup_hint') }}</p>
			<MenuItem icon="tabler:settings" :label="t('ai.open_settings')" @select="open_settings" />
		</template>
		<p v-else-if="!usable" class="hint">{{ t('ai.read_only') }}</p>
		<template v-else>
			<MenuItem v-if="children.length" icon="tabler:file-description" :label="t('ai.folder.about_folder')" @select="summarize" />
			<MenuItem
				v-if="nameable.length"
				icon="tabler:forms"
				:label="t('ai.folder.rename_by_content')"
				@select="suggest_names"
			/>
			<MenuItem v-if="children.length > 1" icon="tabler:folders" :label="t('ai.folder.tidy')" @select="sort_into_folders" />
			<MenuItem icon="tabler:bulb" :label="t('ai.folder.ideas')" @select="generate_ideas" />
		</template>
	</DropMenu>
</template>

<style scoped>
.hint {
	margin: 0;
	padding: 2px 8px 8px;
	font-size: 12px;
	line-height: 1.4;
	color: var(--text-secondary);
	white-space: normal;
}
</style>
