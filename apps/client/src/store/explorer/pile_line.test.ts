import { describe, expect, test } from 'vitest'
import type { SyncStatus } from '@/services/cloud/sync/syncEngine'
import { pile_line_state, sync_badge } from './pile_line'

const status = (over: Partial<SyncStatus>): SyncStatus => ({
	phase: 'idle',
	conflicts: [],
	kept_for_hidden: [],
	skipped: [],
	errors: [],
	...over,
})

describe('a pile\'s line in the tree', () => {
	test('only at a pile\'s top folder', () => {
		expect(pile_line_state(false, status({}))).toBeNull()
	})

	test('calm in sync, or with no status here (synced on another computer)', () => {
		expect(pile_line_state(true, status({}))).toBe('idle')
		expect(pile_line_state(true, null)).toBe('idle')
	})

	test('flowing while syncing', () => {
		expect(pile_line_state(true, status({ phase: 'syncing' }))).toBe('syncing')
	})

	test('amber when it waits for the person, failed, or left files behind', () => {
		expect(pile_line_state(true, status({ phase: 'paused', reason: 'folder_missing' }))).toBe('attention')
		expect(pile_line_state(true, status({ phase: 'error' }))).toBe('attention')
		expect(pile_line_state(true, status({ errors: [{ relative: 'a.md', message: 'no' }] as SyncStatus['errors'] }))).toBe('attention')
	})
})

describe('the tree\'s cloud badge', () => {
	test('turns while syncing, and says when it waits or failed', () => {
		expect(sync_badge(null)).toEqual({ icon: 'tabler:cloud-check', spin: false, tip: null })
		expect(sync_badge(status({}))).toEqual({ icon: 'tabler:cloud-check', spin: false, tip: null })
		expect(sync_badge(status({ phase: 'syncing' }))).toEqual({ icon: 'tabler:refresh', spin: true, tip: 'sync.syncing_now' })
		expect(sync_badge(status({ phase: 'paused' })).icon).toBe('tabler:cloud-pause')
		expect(sync_badge(status({ phase: 'error' })).icon).toBe('tabler:cloud-off')
		expect(sync_badge(status({ errors: [{ relative: 'a.md', message: 'no' }] as SyncStatus['errors'] })).icon).toBe('tabler:cloud-exclamation')
	})
})
