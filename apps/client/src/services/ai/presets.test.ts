import { describe, expect, test } from 'vitest'
import { preset_for_url } from './presets'

describe('preset_for_url', () => {
	test('recognizes a preset address, with or without the trailing slash', () => {
		expect(preset_for_url('http://localhost:11434/v1')).toBe('ollama')
		expect(preset_for_url('https://openrouter.ai/api/v1/')).toBe('openrouter')
		expect(preset_for_url('https://example.com/v1')).toBe('custom')
	})

	test('in the browser a desktop-only address is custom', () => {
		expect(preset_for_url('http://localhost:11434/v1', { web: true })).toBe('custom')
		expect(preset_for_url('http://localhost:1234/v1', { web: true })).toBe('custom')
		expect(preset_for_url('https://openrouter.ai/api/v1', { web: true })).toBe('openrouter')
	})
})
