import { describe, expect, test } from 'vitest'
import { begin_pile_image, end_pile_image, pile_image_busy } from './pileImageUpload'

describe('the "uploading" mark of a folder picture', () => {
	test('a root cover uploading in one workspace does not mark the root of another (both are `/`)', () => {
		begin_pile_image('ws-a', '/', 'cover')
		expect(pile_image_busy('ws-a', '/', 'cover')).toBe(true)
		expect(pile_image_busy('ws-b', '/', 'cover')).toBe(false)
		expect(pile_image_busy('ws-a', '/', 'background')).toBe(false)
		end_pile_image('ws-a', '/', 'cover')
		expect(pile_image_busy('ws-a', '/', 'cover')).toBe(false)
	})

	test('two uploads of one folder: marked until both end', () => {
		begin_pile_image('ws-a', '/docs', 'cover')
		begin_pile_image('ws-a', '/docs', 'cover')
		end_pile_image('ws-a', '/docs', 'cover')
		expect(pile_image_busy('ws-a', '/docs', 'cover')).toBe(true)
		end_pile_image('ws-a', '/docs', 'cover')
		expect(pile_image_busy('ws-a', '/docs', 'cover')).toBe(false)
	})
})
