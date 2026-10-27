<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { locale, t } from '@/i18n'
import { report_error } from '@/store/helpers/reportError'
import { explorer_drives } from '@/store/explorer/drives'
import { explorer_navigation } from '@/store/explorer/navigation'
import { explorer_language } from '@/store/explorer/language'
import store, { adopt_workspace } from '@/store'
import Segmented from '@/ui/kit/Segmented.vue'
import SettingsPanel from '@/ui/workspace/sidebar/workspaces-list/SettingsPanel.vue'
import TooltipLayer from '@/ui/kit/TooltipLayer.vue'
import './tokens.css'

const previous_lang = document.documentElement.lang
const restore_workspace = store.workspace
let alive = true

const language_options = computed(() => [
	{ value: 'system' as const, label: t('settings.language_system') },
	{ value: 'ru' as const, label: 'Русский' },
	{ value: 'en' as const, label: 'English' },
])

const shell_error = computed(() => store.workspace?.last_error ?? store.last_error)

function dismiss_error() {
	store.workspace?.clear_error()
	store.clear_error()
}

// The old interface stays English. The document language follows the Explorer
// only while its shell is on screen.
watch(locale, (value) => {
	document.documentElement.lang = value
}, { immediate: true })

onMounted(async () => {
	try {
		await explorer_navigation.open_at_launch()
	} catch (error) {
		if (alive) report_error(store, error)
	}
	if (!alive) adopt_workspace(restore_workspace)
})

onUnmounted(() => {
	alive = false
	explorer_navigation.cancel()
	explorer_drives.dispose_all()
	adopt_workspace(restore_workspace)
	document.documentElement.lang = previous_lang
})
</script>

<template>
	<!-- Replaces WorkspaceWindow while the flag is on. The flag's only switch
	     lives in the old settings, so they stay on this empty frame until the
	     Explorer settings page exists. Menus and dialogs portal into this
	     element so they inherit its tokens. -->
	<div class="explorer flex h-full flex-col items-start gap-4 p-6">
		<p v-if="shell_error" class="shell-error" role="alert">
			<span>{{ shell_error }}</span>
			<button type="button" @click="dismiss_error">{{ t('dialog.close') }}</button>
		</p>
		<div class="flex flex-col gap-2">
			<span>{{ t('settings.language') }}</span>
			<Segmented v-model="explorer_language" :options="language_options" />
		</div>
		<SettingsPanel />
		<TooltipLayer />
	</div>
</template>

<style scoped>
.shell-error {
	display: flex;
	align-items: center;
	gap: 12px;
	max-width: 36rem;
	margin: 0;
	color: var(--text-danger);
	font-size: 13px;
}
.shell-error button {
	border: 0;
	background: none;
	color: inherit;
	font: inherit;
	cursor: pointer;
	text-decoration: underline;
}
</style>
