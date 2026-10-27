import { afterEach, describe, expect, test } from 'vitest'
import { explain_folder_error } from './fsErrorMessage'
import { explorer_language } from './language'

afterEach(() => { explorer_language.value = 'system' })

describe('folder error message', () => {
	test('a protected folder is explained in the Explorer language, other errors pass through', () => {
		const eperm = new Error('Operation not permitted (os error 1)')
		explorer_language.value = 'ru'
		const ru = explain_folder_error(eperm, '/Users/me/Library/Mail') as Error
		expect(ru.message).toBe('Нет доступа к папке «Mail». Разрешите Pile Commander доступ в Системных настройках → Конфиденциальность и безопасность → Полный доступ к диску')
		expect(ru.cause).toBe(eperm)

		explorer_language.value = 'en'
		expect((explain_folder_error(eperm, '/Users/me/Library/Mail', 'Почта') as Error).message)
			.toContain('“Почта”')

		const other = new Error('No such file or directory (os error 2)')
		expect(explain_folder_error(other, '/x')).toBe(other)
	})
})
