<script setup lang="ts">
import { computed } from 'vue'
import type { Position } from '@/domain/Widget'
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
import MenuItem from '@/ui/kit/MenuItem.vue'

/**
 * The folder's AI actions, the same in its header's "AI" button and in the
 * board's menus: a summary of the folder, names by content, sorting into
 * folders and ideas as new notes (an empty folder too). Without a provider
 * and a model it says so and leads to the AI settings
 */
const props = defineProps<{
	workspace: WorkspaceStore
	folder_id: string
	/** Where a board's menu was opened: the summary and the ideas go there */
	anchor?: Position | null
}>()

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
		position: props.anchor ?? summary_position(folder.children),
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
		anchor: props.anchor ?? null,
	})
}

/** The settings page, on its AI tab */
function open_settings() {
	settings_tab.value = 'ai'
	void explorer_navigation.open_page('settings')
}
</script>

<template>
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
		<MenuItem icon="tabler:bulb" :label="anchor ? t('board_menu.generate_ideas_here') : t('ai.folder.ideas')" @select="generate_ideas" />
	</template>
</template>

<style scoped>
.hint {
	margin: 0;
	padding: 6px 8px 8px;
	font-size: 12px;
	line-height: 1.4;
	color: var(--text-secondary);
	white-space: normal;
}
</style>
