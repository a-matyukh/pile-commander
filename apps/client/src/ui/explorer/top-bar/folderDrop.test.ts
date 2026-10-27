import { describe, expect, test } from 'vitest'
import { local_bookmark_ref, point_in_rect } from './folderDrop'

const bar = { left: 0, top: 0, right: 800, bottom: 36 }

describe('folder drop target', () => {
	test('a point on the top bar is a bookmark, and a point below it opens', () => {
		expect(point_in_rect({ x: 40, y: 10 }, bar)).toBe(true)
		expect(point_in_rect({ x: 40, y: 80 }, bar)).toBe(false)
		expect(point_in_rect(null, bar)).toBe(false)
		expect(point_in_rect({ x: 40, y: 10 }, null)).toBe(false)
	})

	test('a path inside ~ is a folder of home, and a volume is its own root', () => {
		expect(local_bookmark_ref('/Users/me/docs/', '/Users/me')).toEqual({
			drive_id: 'local',
			root_id: '/Users/me',
			folder_id: '/Users/me/docs',
		})
		expect(local_bookmark_ref('/Volumes/Disk', '/Users/me')).toEqual({
			drive_id: 'local',
			root_id: '/Volumes/Disk',
			folder_id: '/Volumes/Disk',
		})
	})
})
