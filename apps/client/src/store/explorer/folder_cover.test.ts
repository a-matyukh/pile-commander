import { describe, expect, test } from 'vitest'
import { explorer_language } from './language'
import { read_folder_icon, standard_folder_icon, system_folder_name, write_folder_icon } from './folder_cover'

const HOME = '/Users/me'
const local = (folder_id: string) => ({ drive_id: 'local', root_id: HOME, folder_id })

describe('folder icon', () => {
	test('an icon with its color round-trips through the cover; a color or a picture is not an icon', () => {
		const cover = write_folder_icon({ icon: 'tabler:star', color: '#378ADD' })
		expect(cover).toBe('icon:tabler:star;#378ADD')
		expect(read_folder_icon(cover)).toEqual({ icon: 'tabler:star', color: '#378ADD' })
		expect(read_folder_icon(write_folder_icon({ icon: 'tabler:star', color: '' }))).toEqual({ icon: 'tabler:star', color: '' })
		expect(read_folder_icon('#FDE68A')).toBeNull()
		expect(read_folder_icon('https://example.com/a.png')).toBeNull()
		expect(read_folder_icon(undefined)).toBeNull()
	})

	test('macOS\'s own folders right in ~ have their icons; deeper or elsewhere they do not', () => {
		expect(standard_folder_icon(local(`${HOME}/Downloads`), HOME)).toBe('tabler:download')
		expect(standard_folder_icon(local(`${HOME}/Work/Downloads`), HOME)).toBeNull()
		expect(standard_folder_icon(local(`${HOME}/Projects`), HOME)).toBeNull()
		expect(standard_folder_icon({ drive_id: 'cloud', root_id: 'w', folder_id: '/Downloads' }, HOME)).toBeNull()
		expect(standard_folder_icon(local(`${HOME}/Music`), null)).toBeNull()
	})

	test('a system folder shows Finder\'s name in the interface language; others keep theirs', () => {
		explorer_language.value = 'ru'
		expect(system_folder_name(local(`${HOME}/Downloads`), HOME)).toBe('Загрузки')
		explorer_language.value = 'en'
		expect(system_folder_name(local(`${HOME}/Downloads`), HOME)).toBe('Downloads')
		expect(system_folder_name(local(`${HOME}/Projects`), HOME)).toBeNull()
	})
})
