<script setup lang="ts">
import { computed } from 'vue'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import { is_desktop } from '@/isDesktop'
import DesktopUpdateControls from '@/ui/app/DesktopUpdateControls.vue'
import { t } from '@/i18n'
import { explorer_enabled } from '@/store/explorer/enabled'
import { explorer_language } from '@/store/explorer/language'
import { explorer_settings, path_in_header, settings_tab, SETTINGS_TABS as TABS } from '@/store/explorer/settings'
import { show_hidden_files } from '@/store/showHiddenFiles'
import AiSettingsSection from '@/ui/ai/AiSettingsSection.vue'
import Segmented from '@/ui/kit/Segmented.vue'
import Switch from '@/ui/kit/Switch.vue'
import SettingRow from './SettingRow.vue'
import ViewChoice from './ViewChoice.vue'

const tabs = computed(() => TABS.filter(tab => is_desktop || tab !== 'updates'))

/**
 * The settings page, as in the prototype: "Interface" (path, bookmarks,
 * size, colors…), "AI" (the current app's AI settings) and "Other".
 * Each setting applies at once and stays on this device
 */
</script>

<template>
	<TabsRoot v-model="settings_tab" class="settings">
		<TabsList class="tabs" :aria-label="t('page.settings')">
			<TabsTrigger v-for="tab in tabs" :key="tab" :value="tab" class="tab">{{ t(`settings.tabs.${tab}`) }}</TabsTrigger>
		</TabsList>
		<TabsContent value="interface" class="pane">
			<div class="sh">{{ t('settings.path') }}</div>
			<div class="card">
				<SettingRow :title="t('settings.path_visible')" :description="t('settings.path_visible_d')">
					<ViewChoice
						v-model="explorer_settings.path_visible"
						:options="[
							{ value: true, label: t('settings.show'), mini: 'path_shown' },
							{ value: false, label: t('settings.hide'), mini: 'path_hidden' },
						]"
					/>
				</SettingRow>
				<SettingRow :title="t('settings.path_place')" :description="t('settings.path_place_d')" :disabled="!explorer_settings.path_visible">
					<ViewChoice
						v-model="explorer_settings.path_place"
						:disabled="!explorer_settings.path_visible"
						:options="[
							{ value: 'header', label: t('settings.path_place_header'), mini: 'path_header' },
							{ value: 'top', label: t('settings.path_place_top'), mini: 'path_top' },
						]"
					/>
				</SettingRow>
				<SettingRow :title="t('settings.path_full')" :description="t('settings.path_full_d')" :disabled="!explorer_settings.path_visible">
					<ViewChoice
						v-model="explorer_settings.path_full"
						:disabled="!explorer_settings.path_visible"
						:options="[
							{ value: true, label: t('settings.path_full_yes'), mini: 'path_full' },
							{ value: false, label: t('settings.path_full_no'), mini: 'path_name' },
						]"
					/>
				</SettingRow>
				<SettingRow :title="t('settings.header_style')" :description="t('settings.header_style_d')" :disabled="!path_in_header">
					<ViewChoice
						v-model="explorer_settings.header_style"
						:disabled="!path_in_header"
						:options="[
							{ value: 'two_lines', label: t('settings.header_two_lines'), mini: 'header_two_lines' },
							{ value: 'compact', label: t('settings.header_compact'), mini: 'header_compact' },
						]"
					/>
				</SettingRow>
				<SettingRow
					:title="t('settings.actions')"
					:description="path_in_header ? t('settings.actions_d_locked') : t('settings.actions_d')"
					:disabled="path_in_header"
				>
					<ViewChoice
						v-model="explorer_settings.actions_on_top"
						:disabled="path_in_header"
						:options="[
							{ value: false, label: t('settings.actions_separate'), mini: 'actions_separate' },
							{ value: true, label: t('settings.actions_top'), mini: 'actions_top' },
						]"
					/>
				</SettingRow>
			</div>

			<div class="sh">{{ t('settings.bookmarks') }}</div>
			<div class="card">
				<SettingRow :title="t('settings.bookmarks_bar')" :description="t('settings.bookmarks_bar_d')">
					<ViewChoice
						v-model="explorer_settings.bookmarks_visible"
						:options="[
							{ value: true, label: t('settings.show'), mini: 'bookmarks_shown' },
							{ value: false, label: t('settings.hide'), mini: 'bookmarks_hidden' },
						]"
					/>
				</SettingRow>
				<SettingRow
					:title="t('settings.bookmarks_style')"
					:description="t('settings.bookmarks_style_d')"
					:disabled="!explorer_settings.bookmarks_visible"
				>
					<ViewChoice
						v-model="explorer_settings.bookmarks_style"
						:disabled="!explorer_settings.bookmarks_visible"
						:options="[
							{ value: 'pills', label: t('settings.bookmarks_pills'), mini: 'bookmarks_pills' },
							{ value: 'list', label: t('settings.bookmarks_list'), mini: 'bookmarks_list' },
						]"
					/>
				</SettingRow>
			</div>

			<div class="sh">{{ t('settings.interface') }}</div>
			<div class="card">
				<SettingRow :title="t('settings.new_interface')" :description="t('settings.new_interface_d')">
					<Switch v-model="explorer_enabled" />
				</SettingRow>
				<SettingRow :title="t('settings.language')" :description="t('settings.language_d')">
					<Segmented
						v-model="explorer_language"
						class="seg-row"
						:options="[
							{ value: 'system', label: t('settings.language_system') },
							{ value: 'ru', label: 'Русский' },
							{ value: 'en', label: 'English' },
						]"
					/>
				</SettingRow>
				<SettingRow
					:title="t('settings.size')"
					:description="t('settings.size_d')"
				>
					<ViewChoice
						v-model="explorer_settings.size"
						:options="[
							{ value: 'normal', label: t('settings.size_normal'), mini: 'size_normal' },
							{ value: 'large', label: t('settings.size_large'), mini: 'size_large' },
						]"
					/>
				</SettingRow>
				<SettingRow :title="t('settings.text_smoothing')" :description="t('settings.text_smoothing_d')">
					<Segmented
						v-model="explorer_settings.text_smoothing"
						class="seg-row"
						:options="[
							{ value: 'system', label: t('settings.text_system') },
							{ value: 'thin', label: t('settings.text_thin') },
						]"
					/>
				</SettingRow>
				<SettingRow :title="t('settings.footer')" :description="t('settings.footer_d')">
					<ViewChoice
						v-model="explorer_settings.footer_buttons"
						:options="[
							{ value: 'icon', label: t('settings.footer_icons'), mini: 'footer_icons' },
							{ value: 'text', label: t('settings.footer_text'), mini: 'footer_text' },
							{ value: 'both', label: t('settings.footer_both'), mini: 'footer_both' },
						]"
					/>
				</SettingRow>
				<SettingRow :title="t('settings.trash')" :description="t('settings.trash_d')">
					<ViewChoice
						v-model="explorer_settings.trash_button"
						:options="[
							{ value: 'icon', label: t('settings.trash_icon'), mini: 'trash_icon' },
							{ value: 'text', label: t('settings.trash_text'), mini: 'trash_text' },
						]"
					/>
				</SettingRow>
				<SettingRow :title="t('settings.home')" :description="t('settings.home_d')">
					<Segmented
						v-model="explorer_settings.home_icon"
						class="seg-row"
						:options="[
							{ value: 'tilde', label: t('settings.home_tilde'), glyph: '~' },
							{ value: 'house', label: t('settings.home_house'), icon: 'tabler:home' },
						]"
					/>
				</SettingRow>
			</div>

			<div class="sh">{{ t('settings.colors') }}</div>
			<div class="card">
				<SettingRow :title="t('settings.panels')" :description="t('settings.panels_d')">
					<ViewChoice
						v-model="explorer_settings.gray_panels"
						:options="[
							{ value: false, label: t('settings.white'), mini: 'panels_white' },
							{ value: true, label: t('settings.gray'), mini: 'panels_gray' },
						]"
					/>
				</SettingRow>
				<SettingRow :title="t('settings.content')" :description="t('settings.content_d')">
					<ViewChoice
						v-model="explorer_settings.gray_content"
						:options="[
							{ value: false, label: t('settings.white'), mini: 'content_white' },
							{ value: true, label: t('settings.gray'), mini: 'content_gray' },
						]"
					/>
				</SettingRow>
			</div>

		</TabsContent>
		<TabsContent value="ai" class="pane">
			<div class="card">
				<AiSettingsSection bare />
			</div>

		</TabsContent>
		<TabsContent value="other" class="pane">
			<div class="sh">{{ t('settings.files') }}</div>
			<div class="card">
				<SettingRow :title="t('settings.hidden_files')" :description="t('settings.hidden_files_d')">
					<Switch v-model="show_hidden_files" />
				</SettingRow>
			</div>


			</TabsContent>
		<TabsContent v-if="is_desktop" value="updates" class="pane">
			<div class="card pad">
				<DesktopUpdateControls />
			</div>
		</TabsContent>
	</TabsRoot>
</template>

<style scoped>
.settings {
	padding: 16px 16px 32px;
	display: flex;
	flex-direction: column;
	gap: 14px;
	max-width: 720px;
}
.tabs {
	display: flex;
	gap: 4px;
	border-bottom: 0.5px solid var(--border);
	margin: -4px 0 2px;
}
.tab {
	position: relative;
	height: 34px;
	padding: 0 12px;
	border: none;
	background: none;
	font: inherit;
	color: var(--text-secondary);
	cursor: pointer;
}
.tab[data-state='active'] {
	color: var(--text-primary);
	font-weight: 500;
}
.tab[data-state='active']::after {
	content: '';
	position: absolute;
	left: 8px;
	right: 8px;
	bottom: -0.5px;
	height: 2px;
	border-radius: 1px;
	background: var(--text-primary);
}
.tab:focus-visible {
	outline: 2px solid var(--fill-accent);
	outline-offset: -2px;
	border-radius: 6px;
}
.pane {
	display: flex;
	flex-direction: column;
	gap: 14px;
	outline: none;
}
.explorer.lg .tab {
	height: 42px;
	font-size: 15px;
}
@media (hover: hover) {
	.tab:hover {
		color: var(--text-primary);
	}
}
.sh {
	font-size: 11px;
	color: var(--text-muted);
	padding: 0 4px;
	min-height: 28px;
	display: flex;
	align-items: center;
}
.card {
	border: 0.5px solid var(--border);
	border-radius: 12px;
	background: var(--surface-2);
}
.card.pad {
	padding: 14px 16px;
}
.note {
	font-size: 12px;
	color: var(--text-muted);
	margin-top: 10px;
}
.demo {
	display: flex;
	align-items: center;
	gap: 10px;
	margin-top: 12px;
	flex-wrap: wrap;
	font-size: 11px;
	color: var(--text-muted);
}
.seg-demo {
	width: 180px;
}
.seg-row {
	width: 280px;
	flex: none;
}
.explorer.lg .sh {
	font-size: 12px;
	min-height: 38px;
}
</style>
