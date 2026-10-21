import { Channel, invoke } from '@tauri-apps/api/core'
import {
	AiError,
	is_ai_error_payload,
	type AiErrorPayload,
	type AiTransport,
	type ChatRequest,
	type ChatResult,
	type StreamOptions,
} from './types'

/** Events of `ai_chat_stream` (`AiEvent` in src-tauri/src/ai.rs). */
type AiEvent =
	| { event: 'delta'; data: { text: string } }
	| { event: 'done'; data: { truncated: boolean } }
	| { event: 'error'; data: AiErrorPayload }

function to_error(error: unknown): unknown {
	return is_ai_error_payload(error) ? new AiError(error) : error
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
	try {
		return await invoke<T>(command, args)
	} catch (error) {
		throw to_error(error)
	}
}

function abort_error(): DOMException {
	return new DOMException('The request was stopped', 'AbortError')
}

function chat(base_url: string, request: ChatRequest, options: StreamOptions = {}): Promise<ChatResult> {
	const { on_delta, signal } = options
	if (signal?.aborted) return Promise.reject(abort_error())

	return new Promise((resolve, reject) => {
		let text = ''
		let settled = false
		let aborted = false
		let stream_id: number | null = null

		const settle = () => {
			settled = true
			signal?.removeEventListener('abort', on_abort)
		}
		const cancel = (id: number) => {
			void invoke('ai_cancel', { id }).catch(() => {})
		}
		const on_abort = () => {
			if (settled) return
			aborted = true
			settle()
			if (stream_id !== null) cancel(stream_id)
			reject(abort_error())
		}
		signal?.addEventListener('abort', on_abort, { once: true })

		const channel = new Channel<AiEvent>()
		channel.onmessage = (message) => {
			if (settled) return
			if (message.event === 'delta') {
				text += message.data.text
				on_delta?.(message.data.text)
			} else if (message.event === 'done') {
				settle()
				resolve({ text, truncated: message.data.truncated })
			} else {
				settle()
				reject(new AiError(message.data))
			}
		}

		invoke<number>('ai_chat_stream', { baseUrl: base_url, body: request, onEvent: channel })
			.then((id) => {
				stream_id = id
				// stopped before Rust handed out the id
				if (aborted) cancel(id)
			})
			.catch((error) => {
				if (settled) return
				settle()
				reject(to_error(error))
			})
	})
}

export const desktop_transport: AiTransport = {
	list_models: base_url => call<string[]>('ai_list_models', { baseUrl: base_url }),
	chat,
	has_key: base_url => call<boolean>('ai_key_status', { baseUrl: base_url }),
	set_key: (base_url, key) => call<void>('ai_key_set', { baseUrl: base_url, key }),
	delete_key: base_url => call<void>('ai_key_delete', { baseUrl: base_url }),
}
