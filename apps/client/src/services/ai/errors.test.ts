import { describe, expect, test } from 'vitest'
import { explain_ai_error, is_no_vision_error, is_reasoning_off_refusal } from './errors'
import { AiError, type AiErrorKind } from './types'

const error = (kind: AiErrorKind, message: string, status: number | null = null) =>
	new AiError({ kind, status, message })

describe('is_no_vision_error', () => {
	test('a provider that plainly refuses images', () => {
		expect(is_no_vision_error(error('bad_request', 'Invalid content type. image_url is only supported by certain models.', 400))).toBe(true)
		expect(is_no_vision_error(error('not_found', 'No endpoints found that support image input', 404))).toBe(true)
		expect(is_no_vision_error(error('bad_request', 'Model does not support images. Please use a model that does.', 400))).toBe(true)
		expect(is_no_vision_error(error('http', 'this model does not support vision', 415))).toBe(true)
	})

	test('a failure that proves nothing about images', () => {
		expect(is_no_vision_error(error('timeout', 'the provider stopped responding'))).toBe(false)
		expect(is_no_vision_error(error('connect', 'Connection refused'))).toBe(false)
		expect(is_no_vision_error(error('network', 'image upload failed: not supported'))).toBe(false)
		expect(is_no_vision_error(error('rate_limited', 'image requests are not supported right now', 429))).toBe(false)
		expect(is_no_vision_error(error('http', 'model does not support images', 500))).toBe(false)
		expect(is_no_vision_error(error('http', 'images not supported', 503))).toBe(false)
		expect(is_no_vision_error(error('unauthorized', 'images not supported on free tier', 401))).toBe(false)
		expect(is_no_vision_error(error('bad_request', 'max_tokens is too large', 400))).toBe(false)
		expect(is_no_vision_error(error('bad_request', 'the image is too large', 400))).toBe(false)
		expect(is_no_vision_error(new DOMException('stopped', 'AbortError'))).toBe(false)
		expect(is_no_vision_error(new Error('model does not support images'))).toBe(false)
	})
})

describe('explain_ai_error', () => {
	const ollama = { base_url: 'http://localhost:11434/v1', operation: 'chat' as const, model: 'gemma3' }

	test('names the app that is not running', () => {
		expect(explain_ai_error(error('connect', 'refused'), ollama)).toContain('ollama serve')
		expect(explain_ai_error(error('connect', 'refused'), { base_url: 'http://localhost:1234/v1', operation: 'models' }))
			.toContain('LM Studio')
	})

	test('a server on the network that does not answer', () => {
		expect(explain_ai_error(error('connect', 'refused'), { base_url: 'http://192.168.1.5:11434/v1', operation: 'models' }))
			.toContain('OLLAMA_HOST')
	})

	test('a self-signed certificate on the local network suggests http', () => {
		expect(explain_ai_error(error('certificate', 'invalid'), { base_url: 'https://192.168.1.5/v1', operation: 'models' }))
			.toBe('The server\'s certificate wasn\'t accepted. For an address on your local network, use http.')
	})

	test('a missing Ollama model says how to pull it', () => {
		expect(explain_ai_error(error('not_found', 'model not found', 404), ollama)).toContain('ollama pull gemma3')
	})

	test('a wrong path while listing models points to /v1', () => {
		expect(explain_ai_error(error('not_found', '', 404), { base_url: 'https://example.com', operation: 'models' }))
			.toContain('/v1')
	})

	test('a refused image names the model even on a 5xx', () => {
		expect(explain_ai_error(error('http', 'model does not support images', 500), ollama)).toContain('doesn\'t accept images')
	})

	test('no key versus a rejected key', () => {
		const openai = { base_url: 'https://api.openai.com/v1', operation: 'chat' as const }
		expect(explain_ai_error(error('unauthorized', '', 401), { ...openai, has_key: false })).toBe('This provider needs an API key.')
		expect(explain_ai_error(error('unauthorized', '', 401), { ...openai, has_key: true })).toBe('The provider rejected the API key.')
	})

	test('a system without password storage, and a refused prompt, without the raw error', () => {
		const missing = explain_ai_error(error('keyring', 'Platform secure storage failure: no secret service'), ollama)
		expect(missing).toBe('Couldn\'t use the key: this system has no password storage available.')
		const denied = explain_ai_error(error('keyring_denied', 'Platform secure storage failure: Error { code: -128 }'), ollama)
		expect(denied).toContain('choose Allow')
		expect(denied).not.toContain('-128')
	})
})

describe('is_reasoning_off_refusal', () => {
	test('a 400 about reasoning_effort, and nothing else', () => {
		const error = (kind: AiErrorKind, status: number | null, message: string) => new AiError({ kind, status, message })
		expect(is_reasoning_off_refusal(error('bad_request', 400, 'Unrecognized request argument supplied: reasoning_effort'))).toBe(true)
		expect(is_reasoning_off_refusal(error('bad_request', 400, 'Unsupported value: \'reasoning_effort\' does not support \'none\''))).toBe(true)
		expect(is_reasoning_off_refusal(error('bad_request', 400, 'image too large'))).toBe(false)
		expect(is_reasoning_off_refusal(error('rate_limited', 429, 'reasoning tokens exhausted'))).toBe(false)
	})
})
