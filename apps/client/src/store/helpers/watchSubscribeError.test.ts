import { describe, expect, test } from 'vitest'
import {
	LIVE_UPDATES_UNAVAILABLE,
	user_message_for_watch_error,
} from './watchSubscribeError'

describe('user_message_for_watch_error', () => {
	test('hides the after-subscribe realtime race', () => {
		expect(user_message_for_watch_error(
			new Error("cannot add 'postgres_changes' callbacks for realtime:file-manager-watch:ws:1 after 'subscribe()'."),
		)).toBeNull()
	})

	test('rewrites subscribe CHANNEL_ERROR and TIMED_OUT', () => {
		expect(user_message_for_watch_error(
			new Error('entries watch subscribe failed: CHANNEL_ERROR'),
		)).toBe(LIVE_UPDATES_UNAVAILABLE)
		expect(user_message_for_watch_error(
			new Error('watch subscribe failed: TIMED_OUT'),
		)).toBe(LIVE_UPDATES_UNAVAILABLE)
	})

	test('passes other errors through', () => {
		expect(user_message_for_watch_error(new Error('folder not found'))).toBe('folder not found')
	})
})
