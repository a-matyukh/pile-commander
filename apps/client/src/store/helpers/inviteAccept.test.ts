import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	invite_emails_match,
	recalled_invite_workspace,
	remember_invite_workspace,
} from './inviteAccept'

describe('invite_emails_match', () => {
	it('matches ignoring case and surrounding space', () => {
		expect(invite_emails_match('  A@x.com ', 'a@x.com')).toBe(true)
	})

	it('rejects a different address or a missing side', () => {
		expect(invite_emails_match('a@x.com', 'b@x.com')).toBe(false)
		expect(invite_emails_match(null, 'a@x.com')).toBe(false)
		expect(invite_emails_match('a@x.com', undefined)).toBe(false)
	})
})

describe('invite workspace session memory', () => {
	const token = 'ab'.repeat(32)
	const memory = new Map<string, string>()

	afterEach(() => {
		memory.clear()
		vi.unstubAllGlobals()
	})

	it('recalls a workspace id stored for the token', () => {
		vi.stubGlobal('sessionStorage', {
			getItem: (key: string) => memory.get(key) ?? null,
			setItem: (key: string, value: string) => { memory.set(key, value) },
			removeItem: (key: string) => { memory.delete(key) },
		})
		remember_invite_workspace(token, 'ws-1')
		expect(recalled_invite_workspace(token)).toBe('ws-1')
	})
})
