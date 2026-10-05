import { describe, expect, it } from 'vitest'
import { splitFileName } from './fileNameParts'

describe('splitFileName', () => {
	it('splits stem and extension without the dot', () => {
		expect(splitFileName('1.txt')).toEqual({ stem: '1', extension: 'txt' })
		expect(splitFileName('archive.tar.gz')).toEqual({
			stem: 'archive.tar',
			extension: 'gz',
		})
	})

	it('keeps names without a usable extension intact', () => {
		expect(splitFileName('README')).toEqual({ stem: 'README', extension: '' })
		expect(splitFileName('.gitignore')).toEqual({
			stem: '.gitignore',
			extension: '',
		})
	})
})
