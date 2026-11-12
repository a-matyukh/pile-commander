import { describe, expect, test } from 'vitest'
import { connection_check, forget_connection_checks, record_connection_check } from './ai'

describe('remembered connection check', () => {
	test('kept per address and model, forgotten for the whole address', () => {
		record_connection_check('https://api.fireworks.ai/inference/v1', 'a', { ok: true, text: 'ok' })
		record_connection_check('https://api.fireworks.ai/inference/v1', 'b', { ok: false, text: 'no' })
		record_connection_check('https://openrouter.ai/api/v1', 'a', { ok: true, text: 'ok' })

		expect(connection_check('https://api.fireworks.ai/inference/v1', 'a')).toEqual({ ok: true, text: 'ok' })
		expect(connection_check('https://api.fireworks.ai/inference/v1', 'c')).toBeNull()

		forget_connection_checks('https://api.fireworks.ai/inference/v1')
		expect(connection_check('https://api.fireworks.ai/inference/v1', 'a')).toBeNull()
		expect(connection_check('https://api.fireworks.ai/inference/v1', 'b')).toBeNull()
		expect(connection_check('https://openrouter.ai/api/v1', 'a')).toEqual({ ok: true, text: 'ok' })

		record_connection_check('https://openrouter.ai/api/v1', 'a', null)
		expect(connection_check('https://openrouter.ai/api/v1', 'a')).toBeNull()
	})
})
