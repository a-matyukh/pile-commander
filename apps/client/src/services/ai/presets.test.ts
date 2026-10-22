import { describe, expect, test } from 'vitest'
import { model_label, preset_for_url } from './presets'

describe('preset_for_url', () => {
	test('recognizes a preset address, with or without the trailing slash', () => {
		expect(preset_for_url('http://localhost:11434/v1')).toBe('ollama')
		expect(preset_for_url('https://openrouter.ai/api/v1/')).toBe('openrouter')
		expect(preset_for_url('https://api.fireworks.ai/inference/v1')).toBe('fireworks')
		expect(preset_for_url('https://example.com/v1')).toBe('custom')
	})

	test('in the browser a desktop-only address is custom', () => {
		expect(preset_for_url('http://localhost:11434/v1', { web: true })).toBe('custom')
		expect(preset_for_url('http://localhost:1234/v1', { web: true })).toBe('custom')
		expect(preset_for_url('https://openrouter.ai/api/v1', { web: true })).toBe('openrouter')
	})
})

describe('model_label', () => {
	test('drops the Fireworks account path and leaves other ids alone', () => {
		expect(model_label('accounts/fireworks/models/deepseek-v4p1')).toBe('deepseek-v4p1')
		expect(model_label('accounts/my-team/models/tuned-qwen')).toBe('tuned-qwen')
		expect(model_label('openai/gpt-4o-mini')).toBe('openai/gpt-4o-mini')
		expect(model_label('qwen3.5:4b')).toBe('qwen3.5:4b')
	})
})
