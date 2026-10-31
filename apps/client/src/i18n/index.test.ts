import { afterEach, describe, expect, test } from 'vitest'
import { explorer_language } from '@/store/explorer/language'
import { count_items, resolve_locale, t } from './index'

describe('resolve_locale', () => {
	test('follows an explicit language and otherwise the system language', () => {
		expect(resolve_locale('ru', 'en-US')).toBe('ru')
		expect(resolve_locale('en', 'ru-RU')).toBe('en')
		expect(resolve_locale('system', 'ru-RU')).toBe('ru')
		expect(resolve_locale('system', 'en-US')).toBe('en')
	})
})

describe('t', () => {
	afterEach(() => {
		explorer_language.value = 'system'
	})

	test('reads the dictionary for the chosen language and fills placeholders', () => {
		explorer_language.value = 'en'
		expect(t('top.back')).toBe('Back')
		expect(t('bookmarks.added', { name: 'Notes' })).toBe('“Notes” bookmarked')
		expect(t('updates.latest', { version: '2.3.0' })).toBe('Pile Commander 2.3.0 is the latest version')
		expect(t('rename_dialog.title')).toBe('New name')
		expect(t('board_chrome.combine')).toBe('Combine')
		expect(t('empty_pane.remembered')).toBe('I remembered')

		explorer_language.value = 'ru'
		expect(t('top.back')).toBe('Назад')
		expect(t('bookmarks.added', { name: 'Заметки' })).toBe('«Заметки» в закладках')
		expect(t('updates.latest', { version: '2.3.0' })).toBe('Pile Commander 2.3.0 — последняя версия')
		expect(t('rename_dialog.title')).toBe('Новое имя')
		expect(t('board_chrome.combine')).toBe('Объединить в папку')
		expect(t('empty_pane.remembered')).toBe('Я запомнил')
	})

	test('returns the key when the dictionary has no such string', () => {
		explorer_language.value = 'en'
		expect(t('top.missing')).toBe('top.missing')
	})

	test('counts items in the current language', () => {
		explorer_language.value = 'en'
		expect(count_items(1)).toBe('1 item')
		expect(count_items(5)).toBe('5 items')

		explorer_language.value = 'ru'
		expect(count_items(1)).toBe('1 элемент')
		expect(count_items(3)).toBe('3 элемента')
		expect(count_items(5)).toBe('5 элементов')
		expect(count_items(11)).toBe('11 элементов')
	})
})
