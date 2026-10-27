import { computed } from 'vue'
import { explorer_language, type ExplorerLanguage } from '@/store/explorer/language'
import { ru } from './ru'
import { en } from './en'

/**
 * All Explorer strings live in one dictionary per language. `t()` reads the
 * current language, so templates update when it changes.
 */
const DICTIONARIES = { ru, en }

export type Locale = keyof typeof DICTIONARIES

export function resolve_locale(language: ExplorerLanguage, navigator_language: string): Locale {
	if (language === 'ru' || language === 'en') return language
	return navigator_language.toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

export const locale = computed<Locale>(() => resolve_locale(explorer_language.value, navigator.language))

export function t(key: string, params?: Record<string, string | number>): string {
	const value = key
		.split('.')
		.reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], DICTIONARIES[locale.value])
	if (typeof value !== 'string') {
		if (import.meta.env.DEV) console.warn('[i18n] missing key', key)
		return key
	}
	if (!params) return value
	return value.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))
}

/** "1 элемент / 3 элемента / 5 элементов", "1 item / 5 items" */
export function count_items(n: number): string {
	const mod10 = n % 10
	const mod100 = n % 100
	const form =
		locale.value === 'en'
			? n === 1 ? 'one' : 'many'
			: mod10 === 1 && mod100 !== 11 ? 'one' : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20) ? 'few' : 'many'
	return t(`plural.items.${form}`, { n })
}
