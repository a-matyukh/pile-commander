import { describe, expect, it } from 'vitest'
import {
	auth_storage_key,
	cloud_failure_message,
	CLOUD_UNAVAILABLE,
	CLOUD_WORKSPACE_OFFLINE,
	cloud_status_message,
	fetch_with_timeout,
	is_offline_error,
	is_transient_empty_session,
	read_cached_session_user,
} from './client'
import { cloud_board_epoch, request_cloud_board_reload } from '@/store/cloudBoardReload'

const SUPABASE_URL = 'https://abcd.supabase.co'

function memory_storage(seed: Record<string, string> = {}) {
	const items = new Map(Object.entries(seed))
	return {
		getItem: (key: string) => items.get(key) ?? null,
	}
}

describe('cached supabase session', () => {
	it('uses the supabase-js storage key', () => {
		expect(auth_storage_key(SUPABASE_URL)).toBe('sb-abcd-auth-token')
	})

	it('reads the user without touching the network', () => {
		const storage = memory_storage({
			[auth_storage_key(SUPABASE_URL)]: JSON.stringify({
				access_token: 'token',
				refresh_token: 'refresh',
				user: { id: 'user-1', email: 'a@b.c' },
			}),
		})
		expect(read_cached_session_user(storage, SUPABASE_URL)?.id).toBe('user-1')
	})

	it('returns null when the stored session is missing or malformed', () => {
		expect(read_cached_session_user(memory_storage(), SUPABASE_URL)).toBeNull()
		expect(read_cached_session_user(
			memory_storage({ [auth_storage_key(SUPABASE_URL)]: '{' }),
			SUPABASE_URL,
		)).toBeNull()
		expect(read_cached_session_user(
			memory_storage({ [auth_storage_key(SUPABASE_URL)]: JSON.stringify({ user: {} }) }),
			SUPABASE_URL,
		)).toBeNull()
	})
})

describe('empty auth session', () => {
	const cached = { id: 'user-1' }

	it('keeps the account when the initial session is empty but storage still has one', () => {
		expect(is_transient_empty_session('INITIAL_SESSION', cached)).toBe(true)
	})

	it('signs out on SIGNED_OUT even if storage still has a session', () => {
		expect(is_transient_empty_session('SIGNED_OUT', cached)).toBe(false)
	})

	it('signs out when nothing is cached', () => {
		expect(is_transient_empty_session('INITIAL_SESSION', null)).toBe(false)
	})
})

describe('offline cloud errors', () => {
	it('recognises a failed fetch and an aborted request', () => {
		expect(is_offline_error(new TypeError('Failed to fetch'))).toBe(true)
		expect(is_offline_error(new TypeError('Load failed'))).toBe(true)
		expect(is_offline_error(new Error('get_my_profile failed: TypeError: Load failed'))).toBe(true)
		expect(is_offline_error(new DOMException('The operation was aborted.', 'AbortError'))).toBe(true)
		expect(is_offline_error(new Error('No access to workspace “Board”'))).toBe(false)
	})

	it('turns a WebKit load failure into the account and list message', () => {
		expect(cloud_status_message('get_my_profile failed: TypeError: Load failed'))
			.toBe(CLOUD_UNAVAILABLE)
		expect(cloud_status_message('username is taken')).toBe('username is taken')
	})

	it('replaces an offline failure with the connection message', () => {
		expect(cloud_failure_message(new TypeError('Failed to fetch'), CLOUD_WORKSPACE_OFFLINE))
			.toBe(CLOUD_WORKSPACE_OFFLINE)
		expect(cloud_failure_message(new Error('slug is taken'), CLOUD_WORKSPACE_OFFLINE))
			.toBe('slug is taken')
	})
})

describe('supabase fetch timeout', () => {
	it('aborts a request that outlives the timeout', async () => {
		const original = globalThis.fetch
		globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
			const signal = init?.signal
			if (!signal) return
			if (signal.aborted) {
				reject(signal.reason)
				return
			}
			signal.addEventListener('abort', () => reject(signal.reason), { once: true })
		})) as typeof fetch
		try {
			await expect(fetch_with_timeout('https://example.test', undefined, 20))
				.rejects.toMatchObject({ name: 'TimeoutError' })
		} finally {
			globalThis.fetch = original
		}
	})
})

describe('cloud board reload', () => {
	it('bumps the epoch so a failed board can open again', () => {
		const before = cloud_board_epoch.value
		request_cloud_board_reload()
		expect(cloud_board_epoch.value).toBe(before + 1)
	})
})
