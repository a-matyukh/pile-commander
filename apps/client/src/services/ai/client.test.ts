import { beforeEach, describe, expect, test } from 'vitest'
import { ai_settings, ai_vision, vision_support } from '@/store/ai'
import { ai_chat } from './client'
import { AiError, type AiMessage, type AiTransport } from './types'

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
	ai_settings.value = { preset: 'ollama', base_url, model }
	ai_vision.value = {}
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
