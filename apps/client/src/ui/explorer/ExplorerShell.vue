<script setup lang="ts">
import { computed, onUnmounted, watch } from 'vue'
import { locale, t } from '@/i18n'
import { explorer_language } from '@/store/explorer/language'
import Segmented from '@/ui/kit/Segmented.vue'
import SettingsPanel from '@/ui/workspace/sidebar/workspaces-list/SettingsPanel.vue'
import TooltipLayer from '@/ui/kit/TooltipLayer.vue'
import './tokens.css'

const previous_lang = document.documentElement.lang

const language_options = computed(() => [
	{ value: 'system' as const, label: t('settings.language_system') },
	{ value: 'ru' as const, label: 'Русский' },
	{ value: 'en' as const, label: 'English' },
])

// The old interface stays English. The document language follows the Explorer
// only while its shell is on screen.
watch(locale, (value) => {
	document.documentElement.lang = value
}, { immediate: true })

onUnmounted(() => {
	document.documentElement.lang = previous_lang
})
</script>

<template>
	<!-- Replaces WorkspaceWindow while the flag is on. The flag's only switch
	     lives in the old settings, so they stay on this empty frame until the
	     Explorer settings page exists. Menus and dialogs portal into this
	     element so they inherit its tokens. -->
	<div class="explorer flex h-full flex-col items-start gap-4 p-6">
		<div class="flex flex-col gap-2">
			<span>{{ t('settings.language') }}</span>
			<Segmented v-model="explorer_language" :options="language_options" />
		</div>
		<SettingsPanel />
		<TooltipLayer />
	</div>
</template>
