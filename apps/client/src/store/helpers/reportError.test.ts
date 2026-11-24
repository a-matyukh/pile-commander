import { describe, expect, test, vi } from 'vitest'
import { explorer_language } from '@/store/explorer/language'
import { error_message, report_error } from './reportError'

vi.mock('@/store/quotaWall', () => ({ open_quota_wall_from_error: () => false }))

describe('report_error', () => {
	test('a refused write to a protected folder is told in the app\'s own words', () => {
		explorer_language.value = 'en'
		const store = { last_error: null as string | null }
		const log = vi.spyOn(console, 'error').mockImplementation(() => {})

		report_error(store, 'forbidden path: /Users/ann/Library/LaunchAgents/a.plist')

		expect(store.last_error).toBe('Pile Commander only reads this folder. It doesn’t change system and hidden folders of your home folder.')
		log.mockRestore()
	})

	test('the sentence follows the language', () => {
		explorer_language.value = 'ru'
		expect(error_message('protected folder: Pile Commander does not change “/Users/ann/.zshrc”'))
			.toBe('Эту папку Pile Commander только читает. Системные и скрытые папки домашней папки он не меняет.')
		explorer_language.value = 'en'
	})

	test('any other error keeps its own text', () => {
		expect(error_message(new Error('"a.txt" already exists in this folder'))).toBe('"a.txt" already exists in this folder')
		expect(error_message('plain text')).toBe('plain text')
	})
})
