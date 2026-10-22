import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ai_reasoning_off_refused, ai_settings, ai_vision, reasoning_off_refused, vision_support } from '@/store/ai'
import { ai_chat, explain_chat_error } from './client'
import { AiError, type AiMessage, type AiTransport, type ChatRequest } from './types'

const base_url = 'http://localhost:11434/v1'
const model = 'gemma3'

const with_image: AiMessage[] = [{
	role: 'user',
	content: [
		{ type: 'text', text: 'Name this picture' },
		{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
	],
}]
const text_only: AiMessage[] = [{ role: 'user', content: 'Name this note' }]

function transport(chat: AiTransport['chat']): AiTransport {
	return {
		chat,
		list_models: async () => [],
		has_key: async () => false,
		set_key: async () => {},
		delete_key: async () => {},
	}
}

const answers = transport(async () => ({ text: 'orange-bag', truncated: false }))
const fails = (error: unknown) => transport(async () => {
	throw error
})

beforeEach(() => {
	ai_settings.value = { preset: 'ollama', base_url, model, name_style: 'spaces' }
	ai_vision.value = {}
	ai_reasoning_off_refused.value = {}
})

describe('vision support', () => {
	test('a request with an image that succeeds marks the model as seeing', async () => {
		await ai_chat(with_image, {}, answers)
		expect(vision_support(base_url, model)).toBe(true)
	})

	test('a plain refusal of images marks it as not seeing', async () => {
		const refusal = new AiError({ kind: 'bad_request', status: 400, message: 'Model does not support images' })
		await expect(ai_chat(with_image, {}, fails(refusal))).rejects.toBe(refusal)
		expect(vision_support(base_url, model)).toBe(false)
	})

	test.each([
		['a timeout', new AiError({ kind: 'timeout', status: null, message: 'the provider stopped responding' })],
		['a dropped connection', new AiError({ kind: 'connect', status: null, message: 'Connection refused' })],
		['a rate limit', new AiError({ kind: 'rate_limited', status: 429, message: 'slow down' })],
		['a server error', new AiError({ kind: 'http', status: 500, message: 'model does not support images' })],
		['an unclear bad request', new AiError({ kind: 'bad_request', status: 400, message: 'invalid request' })],
		['a stop', new DOMException('stopped', 'AbortError')],
	])('%s leaves it unknown', async (_, error) => {
		await expect(ai_chat(with_image, {}, fails(error))).rejects.toBe(error)
		expect(vision_support(base_url, model)).toBeNull()
	})

	test('a known answer survives a later outage', async () => {
		await ai_chat(with_image, {}, answers)
		await expect(ai_chat(with_image, {}, fails(new AiError({ kind: 'http', status: 503, message: 'busy' })))).rejects.toThrow()
		expect(vision_support(base_url, model)).toBe(true)
	})

	test('a text-only request says nothing about images', async () => {
		await ai_chat(text_only, {}, answers)
		const refusal = new AiError({ kind: 'bad_request', status: 400, message: 'Model does not support images' })
		await expect(ai_chat(text_only, {}, fails(refusal))).rejects.toThrow()
		expect(vision_support(base_url, model)).toBeNull()
	})

	test('is kept per provider and model', async () => {
		await ai_chat(with_image, {}, answers)
		expect(vision_support(base_url, 'llama3.2')).toBeNull()
		expect(vision_support('http://localhost:1234/v1', model)).toBeNull()
	})
})

describe('explain_chat_error', () => {
	const unauthorized = new AiError({ kind: 'unauthorized', status: 401, message: '' })
	const with_key = (has_key: boolean): AiTransport => ({ ...answers, has_key: async () => has_key })

	test('a 401 without a saved key asks for one', async () => {
		ai_settings.value = { preset: 'openrouter', base_url: 'https://openrouter.ai/api/v1', model: 'm', name_style: 'spaces' }
		expect(await explain_chat_error(unauthorized, with_key(false))).toBe('This provider needs an API key.')
		expect(await explain_chat_error(unauthorized, with_key(true))).toBe('The provider rejected the API key.')
	})

	test('other errors do not look the key up', async () => {
		const transport = { ...answers, has_key: vi.fn(async () => true) }
		await explain_chat_error(new AiError({ kind: 'timeout', status: null, message: '' }), transport)
		expect(transport.has_key).not.toHaveBeenCalled()
	})
})

test('sends the configured model and passes deltas through', async () => {
	const deltas: string[] = []
	let sent: { base_url: string; model: string } | null = null
	const streaming = transport(async (url, request, options) => {
		sent = { base_url: url, model: request.model }
		options?.on_delta?.('a')
		options?.on_delta?.('b')
		return { text: 'ab', truncated: true }
	})
	const result = await ai_chat(text_only, { on_delta: text => deltas.push(text) }, streaming)
	expect(sent).toEqual({ base_url, model })
	expect(deltas).toEqual(['a', 'b'])
	expect(result).toEqual({ text: 'ab', truncated: true })
})

describe('no_reasoning', () => {
	const sent: ChatRequest[] = []
	const recording = (chat: (request: ChatRequest) => Promise<{ text: string; truncated: boolean }>) =>
		transport(async (_, request) => {
			sent.push(request)
			return chat(request)
		})
	const refusal = new AiError({
		kind: 'bad_request',
		status: 400,
		message: 'Unsupported parameter: \'reasoning_effort\' is not supported with this model.',
	})

	beforeEach(() => {
		sent.length = 0
	})

	test('asks the model to skip reasoning only when told to', async () => {
		const ok = recording(async () => ({ text: 'name', truncated: false }))
		await ai_chat(text_only, { no_reasoning: true }, ok)
		await ai_chat(text_only, {}, ok)
		expect(sent.map(request => request.reasoning_effort)).toEqual(['none', undefined])
	})

	test('a provider that refuses it gets the request again without it, and never again', async () => {
		const strict = recording(async (request) => {
			if (request.reasoning_effort) throw refusal
			return { text: 'name', truncated: false }
		})
		expect((await ai_chat(text_only, { no_reasoning: true }, strict)).text).toBe('name')
		expect(reasoning_off_refused(base_url, model)).toBe(true)
		await ai_chat(text_only, { no_reasoning: true }, strict)
		expect(sent.map(request => request.reasoning_effort)).toEqual(['none', undefined, undefined])
	})

	test('another bad request is not retried', async () => {
		const bad = new AiError({ kind: 'bad_request', status: 400, message: 'context length exceeded' })
		const failing = recording(async () => {
			throw bad
		})
		await expect(ai_chat(text_only, { no_reasoning: true }, failing)).rejects.toBe(bad)
		expect(sent).toHaveLength(1)
		expect(reasoning_off_refused(base_url, model)).toBe(false)
	})
})
