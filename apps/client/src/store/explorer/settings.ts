import { computed, ref } from 'vue'
import { toReactive, useStorage } from '@vueuse/core'

/**
 * The Explorer's interface settings, as in the prototype (store/settings.ts).
 * Per device. The language and "Show hidden files" keep their own storage
 * (explorer_language, show_hidden_files): they existed before this page
 */
export type ExplorerSettings = {
	/** Panels (top bar, sidebar, folder header) on gray */
	gray_panels: boolean
	/** Folder content area on gray */
	gray_content: boolean
	home_icon: 'tilde' | 'house'
	/** Account and settings buttons at the bottom of the sidebar */
	footer_buttons: 'icon' | 'text' | 'both'
	trash_button: 'icon' | 'text'
	size: 'normal' | 'large'
	/** `thin`: grayscale antialiasing instead of the system one (macOS) */
	text_smoothing: 'system' | 'thin'
	path_visible: boolean
	path_place: 'header' | 'top'
	path_full: boolean
	/** Path above the folder: title on its own line, or one compact line */
	header_style: 'two_lines' | 'compact'
	actions_on_top: boolean
	bookmarks_visible: boolean
	bookmarks_style: 'pills' | 'list'
	/** Icon size of Gallery and the cloud page's tiles, px (a slider, as in Finder) */
	gallery_icon: number
	/** Menus fade and grow in, as the current app's */
	menu_animation: boolean
	/** Menus cast a light shadow, as the current app's */
	menu_shadow: boolean
}

export const EXPLORER_SETTINGS_KEY = 'pile_commander_explorer_settings'

export const EXPLORER_SETTINGS_DEFAULTS: ExplorerSettings = {
	gray_panels: true,
	gray_content: false,
	home_icon: 'tilde',
	footer_buttons: 'icon',
	trash_button: 'icon',
	size: 'normal',
	text_smoothing: 'system',
	path_visible: true,
	path_place: 'header',
	path_full: true,
	header_style: 'two_lines',
	actions_on_top: false,
	bookmarks_visible: true,
	bookmarks_style: 'pills',
	gallery_icon: 40,
	menu_animation: true,
	menu_shadow: true,
}

export const explorer_settings = toReactive<ExplorerSettings>(
	useStorage<ExplorerSettings>(EXPLORER_SETTINGS_KEY, { ...EXPLORER_SETTINGS_DEFAULTS }, undefined, { mergeDefaults: true }),
)

/** "Updates" is the desktop app's only: the web version updates itself */
export const SETTINGS_TABS = ['interface', 'ai', 'other', 'updates'] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

/** The open tab of the settings page */
export const settings_tab = ref<SettingsTab>('interface')

/** The path sits above the folder content */
export const path_in_header = computed(() => explorer_settings.path_visible && explorer_settings.path_place === 'header')

/** The path sits in the top bar, next to the bookmarks */
export const path_on_top = computed(() => explorer_settings.path_visible && explorer_settings.path_place === 'top')

/** Folder actions in the top bar: only when the path is not above the folder */
export const actions_on_top = computed(() => !path_in_header.value && explorer_settings.actions_on_top)
