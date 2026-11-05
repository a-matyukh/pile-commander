import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reset_root_info_memory, root_info_with_kept } from './rootInfoMemory'

const board = { view: '"board"', subfolders: ['a'] }
const gallery = { view: '"gallery"', subfolders: [] }

describe('root_info_with_kept', () => {
	beforeEach(() => {
		const rows = new Map<string, string>()
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => rows.get(key) ?? null,
			setItem: (key: string, value: string) => { rows.set(key, value) },
		})
		reset_root_info_memory()
	})

	afterEach(() => vi.unstubAllGlobals())

	it('shows the fresh answer and keeps it', () => {
		expect(root_info_with_kept('u1', ['r1'], { r1: board })).toEqual({ r1: board })
		expect(root_info_with_kept('u1', ['r1'], null)).toEqual({ r1: board })
	})

	it('a failed read shows what was kept, also after a restart', () => {
		root_info_with_kept('u1', ['r1', 'r2'], { r1: board, r2: gallery })
		reset_root_info_memory()
		expect(root_info_with_kept('u1', ['r1', 'r2'], null)).toEqual({ r1: board, r2: gallery })
	})

	it('a root the fresh answer misses keeps its last info', () => {
		root_info_with_kept('u1', ['r1', 'r2'], { r1: board, r2: gallery })
		expect(root_info_with_kept('u1', ['r1', 'r2'], { r1: { subfolders: [] } })).toEqual({
			r1: { subfolders: [] },
			r2: gallery,
		})
	})

	it('forgets roots no longer listed', () => {
		root_info_with_kept('u1', ['r1', 'r2'], { r1: board, r2: gallery })
		root_info_with_kept('u1', ['r1'], { r1: board })
		expect(root_info_with_kept('u1', ['r1', 'r2'], null)).toEqual({ r1: board })
	})

	it('never shows another account its folders', () => {
		root_info_with_kept('u1', ['r1'], { r1: board })
		reset_root_info_memory()
		expect(root_info_with_kept('u2', ['r1'], null)).toEqual({})
	})

	it('signed out: only the fresh answer, nothing kept', () => {
		expect(root_info_with_kept(null, ['r1'], { r1: board })).toEqual({ r1: board })
		expect(root_info_with_kept(null, ['r1'], null)).toEqual({})
	})
})
