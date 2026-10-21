import { beforeEach, describe, expect, test, vi } from 'vitest'

const tauri = vi.hoisted(() => {
	class Channel<T> {
		onmessage: (message: T) => void = () => {}
	}
	return { invoke: vi.fn(), Channel }
})

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke, Channel: tauri.Channel }))

const { desktop_transport } = await import('./desktopTransport')
const { AiError } = await import('./types')

type Emit = (message: unknown) => void
const base_url = 'http://localhost:11434/v1'
const request = { model: 'gemma3', messages: [{ role: 'user' as const, content: 'hi' }] }

/** Starts a chat and returns the channel's emitter once `ai_chat_stream` was invoked. */
function start_stream(id_promise: Promise<number>) {
	let emit: Emit = () => {}
	tauri.invoke.mockImplementation((command: string, args: { onEvent?: { onmessage: Emit } }) => {
		if (command === 'ai_chat_stream') {
			emit = message => args.onEvent!.onmessage(message)
			return id_promise
		}
		return Promise.resolve()
	})
	return { emit: (message: unknown) => emit(message) }
}

beforeEach(() => {
	tauri.invoke.mockReset()
})

describe('chat', () => {
	test('collects deltas until done', async () => {
		const stream = start_stream(Promise.resolve(7))
		const deltas: string[] = []
		const result = desktop_transport.chat(base_url, request, { on_delta: text => deltas.push(text) })
		stream.emit({ event: 'delta', data: { text: 'Hel' } })
		stream.emit({ event: 'delta', data: { text: 'lo' } })
		stream.emit({ event: 'done', data: { truncated: false } })
		await expect(result).resolves.toEqual({ text: 'Hello', truncated: false })
		expect(deltas).toEqual(['Hel', 'lo'])
		expect(tauri.invoke).toHaveBeenCalledWith('ai_chat_stream', expect.objectContaining({ baseUrl: base_url, body: request }))
	})

	test('an error event rejects with an AiError', async () => {
		const stream = start_stream(Promise.resolve(7))
		const result = desktop_transport.chat(base_url, request)
		stream.emit({ event: 'error', data: { kind: 'connect', status: null, message: 'refused' } })
		const error = await result.catch(e => e)
		expect(error).toBeInstanceOf(AiError)
		expect(error.kind).toBe('connect')
	})

	test('a stop cancels the stream in Rust', async () => {
		start_stream(Promise.resolve(7))
		const controller = new AbortController()
		const result = desktop_transport.chat(base_url, request, { signal: controller.signal })
		await Promise.resolve()
		await Promise.resolve()
		controller.abort()
		await expect(result).rejects.toMatchObject({ name: 'AbortError' })
		expect(tauri.invoke).toHaveBeenCalledWith('ai_cancel', { id: 7 })
	})

	test('a stop before Rust hands out the id still cancels it', async () => {
		let hand_out: (id: number) => void = () => {}
		start_stream(new Promise<number>((resolve) => {
			hand_out = resolve
		}))
		const controller = new AbortController()
		const result = desktop_transport.chat(base_url, request, { signal: controller.signal })
		controller.abort()
		await expect(result).rejects.toMatchObject({ name: 'AbortError' })
		hand_out(9)
		await new Promise(resolve => setTimeout(resolve, 0))
		expect(tauri.invoke).toHaveBeenCalledWith('ai_cancel', { id: 9 })
	})

	test('a refused start rejects with the AiError Rust sent', async () => {
		tauri.invoke.mockRejectedValue({ kind: 'invalid_url', status: null, message: 'use https' })
		await expect(desktop_transport.chat('http://8.8.8.8/v1', request)).rejects.toMatchObject({ kind: 'invalid_url' })
	})
})

test('key commands never return the key', async () => {
	tauri.invoke.mockResolvedValue(true)
	expect(await desktop_transport.has_key(base_url)).toBe(true)
	expect(tauri.invoke).toHaveBeenCalledWith('ai_key_status', { baseUrl: base_url })
})
