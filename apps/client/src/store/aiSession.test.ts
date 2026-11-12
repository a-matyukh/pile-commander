import { describe, expect, test } from 'vitest'
import { close_agent_previews, own_ai_session_open, register_ai_session_kind } from './aiSession'

describe('AI session registry', () => {
	test('any own session holds the slot, and every agent preview closes', () => {
		let own_notes = false
		const closed: string[] = []
		register_ai_session_kind({ own_open: () => own_notes, close_agent_preview: () => { closed.push('notes') } })
		register_ai_session_kind({ own_open: () => false, close_agent_preview: () => { closed.push('moves') } })

		expect(own_ai_session_open()).toBe(false)
		own_notes = true
		expect(own_ai_session_open()).toBe(true)

		close_agent_previews()
		expect(closed).toEqual(['notes', 'moves'])
	})
})
