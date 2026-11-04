import { describe, expect, it } from 'vitest'
import { SYNCED_ON_FRESH_MS, synced_on_from } from './syncedOn'

const NOW = Date.parse('2026-11-04T18:00:00Z')

describe('synced_on_from', () => {
	it('counts the other computers per workspace and keeps the latest pass', () => {
		const out = synced_on_from([
			{ workspace_id: 'w1', device_id: 'mac', last_pass_at: '2026-11-04T17:50:00Z' },
			{ workspace_id: 'w1', device_id: 'laptop', last_pass_at: '2026-11-03T09:00:00Z' },
			{ workspace_id: 'w2', device_id: 'mac', last_pass_at: '2026-11-04T12:00:00Z' },
		], 'browser', NOW)
		expect(out).toEqual({
			w1: { last_pass_at: Date.parse('2026-11-04T17:50:00Z'), devices: 2 },
			w2: { last_pass_at: Date.parse('2026-11-04T12:00:00Z'), devices: 1 },
		})
	})

	it('leaves out this copy of the app: its own link shows instead', () => {
		const out = synced_on_from([
			{ workspace_id: 'w1', device_id: 'this', last_pass_at: '2026-11-04T17:50:00Z' },
		], 'this', NOW)
		expect(out).toEqual({})
	})

	it('drops a copy that has not synced for a month, and an unreadable stamp', () => {
		const stale = new Date(NOW - SYNCED_ON_FRESH_MS - 1).toISOString()
		const out = synced_on_from([
			{ workspace_id: 'w1', device_id: 'old', last_pass_at: stale },
			{ workspace_id: 'w2', device_id: 'odd', last_pass_at: 'not a date' },
		], 'browser', NOW)
		expect(out).toEqual({})
	})
})
