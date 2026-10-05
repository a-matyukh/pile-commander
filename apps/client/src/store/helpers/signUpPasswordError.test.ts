import { describe, expect, test } from 'vitest'
import { sign_up_error_message } from './signUpPasswordError'

describe('sign_up_error_message', () => {
	test('rewrites a breached password', () => {
		expect(sign_up_error_message({
			code: 'weak_password',
			reasons: ['pwned'],
			message: 'Password is known to be weak and easy to guess, please choose a different one.',
		})).toBe('This password has appeared in a data breach. Choose a different one.')
	})

	test('rewrites a too-short password from the server', () => {
		expect(sign_up_error_message({
			code: 'weak_password',
			reasons: ['length'],
			message: 'Password should be at least 8 characters.',
		})).toBe('Use at least 8 characters.')
	})

	test('mentions both length and a breach when the server reports both', () => {
		expect(sign_up_error_message({
			code: 'weak_password',
			reasons: ['length', 'pwned'],
			message: 'Password should be at least 8 characters.',
		})).toBe(
			'Use at least 8 characters. This password has appeared in a data breach. Choose a different one.',
		)
	})

	test('leaves other signup errors as the server wrote them', () => {
		expect(sign_up_error_message(new Error('User already registered'))).toBe('User already registered')
		expect(sign_up_error_message({
			code: 'weak_password',
			reasons: ['characters'],
			message: 'Password should contain at least one character of each.',
		})).toBe('Password should contain at least one character of each.')
	})
})
