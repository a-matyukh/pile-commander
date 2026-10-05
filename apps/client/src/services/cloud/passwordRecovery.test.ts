import { describe, expect, test } from 'vitest'
import { note_auth_event, take_password_recovery } from './passwordRecovery'

describe('password recovery flag', () => {
	test('remembers only PASSWORD_RECOVERY, once', () => {
		note_auth_event('SIGNED_IN')
		note_auth_event('INITIAL_SESSION')
		expect(take_password_recovery()).toBe(false)

		note_auth_event('PASSWORD_RECOVERY')
		expect(take_password_recovery()).toBe(true)
		expect(take_password_recovery()).toBe(false)
	})
})
