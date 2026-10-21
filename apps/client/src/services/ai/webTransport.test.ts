import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { web_transport } from './webTransport'
import { AiError } from './types'

const base_url = 'https://openrouter.ai/api/v1'
const request = { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }] }

function memory_storage(): Storage {
	const items = new Map<string, string>()
	return {
		get length() {
			return items.size
		},
		clear: () => items.clear(),
		getItem: key => items.get(key) ?? null,
		key: index => [...items.keys()][index] ?? null,
		removeItem: (key) => {
			items.delete(key)
		},
		setItem: (key, value) => {
			items.set(key, value)
		},
	}
}

function sse_response(parts: string[]): Response {
	const encoder = new TextEncoder()
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const part of parts) controller.enqueue(encoder.encode(part))
			controller.close()
		},
	})
	return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

let session: Storage
const fetch_mock = vi.fn<typeof fetch>()

beforeEach(() => {
	session = memory_storage()
	vi.stubGlobal('sessionStorage', session)
	vi.stubGlobal('fetch', fetch_mock)
	fetch_mock.mockReset()
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('the key', () => {
	test('lives in sessionStorage by origin and goes out as a bearer token', async () => {
		await web_transport.set_key(base_url, '  sk-test  ')
		expect(session.getItem('pile_commander_ai_key:https://openrouter.ai')).toBe('sk-test')
		expect(await web_transport.has_key(base_url)).toBe(true)

		fetch_mock.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }] })))
		expect(await web_transport.list_models(base_url)).toEqual(['a', 'b'])
		const init = fetch_mock.mock.calls[0]![1]!
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')

		await web_transport.delete_key(base_url)
		expect(await web_transport.has_key(base_url)).toBe(false)
	})

	test('is never written to localStorage', async () => {
		const local = memory_storage()
		vi.stubGlobal('localStorage', local)
		await web_transport.set_key(base_url, 'sk-test')
		expect(local.length).toBe(0)
	})

	test('is hidden in a provider error', async () => {
		await web_transport.set_key(base_url, 'sk-test')
		fetch_mock.mockResolvedValue(new Response(
			JSON.stringify({ error: { message: 'Incorrect API key: sk-test' } }),
			{ status: 401 },
		))
		const error = await web_transport.chat(base_url, request).catch(e => e)
		expect(error).toBeInstanceOf(AiError)
		expect(error.kind).toBe('unauthorized')
		expect(error.message).toBe('Incorrect API key: ***')
	})
})

describe('chat', () => {
	test('streams deltas and reports a length cut', async () => {
		fetch_mock.mockResolvedValue(sse_response([
			'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
			'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"length"}]}\n\n',
			'data: [DONE]\n\n',
		]))
		const deltas: string[] = []
		const result = await web_transport.chat(base_url, request, { on_delta: text => deltas.push(text) })
		expect(result).toEqual({ text: 'Hello', truncated: true })
		expect(deltas).toEqual(['Hel', 'lo'])
		const body = JSON.parse(fetch_mock.mock.calls[0]![1]!.body as string)
		expect(body.stream).toBe(true)
		expect(body.messages).toEqual(request.messages)
	})

	test('a mid-stream provider error rejects', async () => {
		fetch_mock.mockResolvedValue(sse_response(['data: {"error":{"message":"upstream failed"}}\n\n']))
		await expect(web_transport.chat(base_url, request)).rejects.toMatchObject({ kind: 'provider', message: 'upstream failed' })
	})

	test('a failed fetch is a network error', async () => {
		fetch_mock.mockRejectedValue(new TypeError('Failed to fetch'))
		await expect(web_transport.chat(base_url, request)).rejects.toMatchObject({ kind: 'network' })
	})

	test('a stop rejects with AbortError, not an AiError', async () => {
		fetch_mock.mockRejectedValue(new DOMException('stopped', 'AbortError'))
		const error = await web_transport.chat(base_url, request).catch(e => e)
		expect(error).toBeInstanceOf(DOMException)
		expect(error.name).toBe('AbortError')
	})

	test('plain http is refused before any request', async () => {
		await expect(web_transport.chat('http://localhost:11434/v1', request)).rejects.toMatchObject({ kind: 'invalid_url' })
		expect(fetch_mock).not.toHaveBeenCalled()
	})
})
