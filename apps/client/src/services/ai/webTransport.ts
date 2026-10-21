import { check_base_url, key_origin, may_carry_key } from './locality'
import { error_text, interpret_chunk, SseParser } from './sse'
import {
	AiError,
	type AiErrorKind,
	type AiTransport,
	type ChatRequest,
	type ChatResult,
	type StreamOptions,
} from './types'

const KEY_PREFIX = 'pile_commander_ai_key:'
const MODELS_TIMEOUT_MS = 20_000
/** As `STALL_TIMEOUT` in Rust: the wait for the response and between chunks. */
const STALL_TIMEOUT_MS = 180_000
const DETAIL_LIMIT = 600

/**
 * The browser keeps the key in sessionStorage only: it is gone when the tab
 * closes and is never written to localStorage or the cloud.
 */
function session(): Storage | null {
	try {
		return globalThis.sessionStorage ?? null
	} catch {
		return null
	}
}

function parse(base_url: string): URL {
	const check = check_base_url(base_url, { web: true })
	if (!check.ok) throw new AiError({ kind: 'invalid_url', status: null, message: check.message })
	return check.url
}

function stored_key(url: URL): string | null {
	if (!may_carry_key(url)) return null
	return session()?.getItem(KEY_PREFIX + key_origin(url)) || null
}

function endpoint(url: URL, path: string): string {
	return `${url.href.replace(/\/+$/, '')}/${path}`
}

function headers(key: string | null, json: boolean): Record<string, string> {
	const result: Record<string, string> = {}
	if (json) result['Content-Type'] = 'application/json'
	if (key) result.Authorization = `Bearer ${key}`
	return result
}

/** The key is replaced before the cut, as in Rust. */
function scrub(text: string, key: string | null): string {
	const hidden = key ? text.split(key).join('***') : text
	return [...hidden.trim()].slice(0, DETAIL_LIMIT).join('')
}

function kind_for_status(status: number): AiErrorKind {
	if (status === 401 || status === 403) return 'unauthorized'
	if (status === 404) return 'not_found'
	if (status === 429) return 'rate_limited'
	if (status === 400 || status === 422) return 'bad_request'
	return 'http'
}

function provider_message(body: string): string {
	try {
		const value = JSON.parse(body) as { error?: unknown; message?: unknown }
		const error = value.error ?? value.message
		return error === undefined ? body : error_text(error)
	} catch {
		return body
	}
}

async function status_error(response: Response, key: string | null): Promise<AiError> {
	const body = await response.text().catch(() => '')
	const message = scrub(provider_message(body), key)
	return new AiError({
		kind: kind_for_status(response.status),
		status: response.status,
		message: message || `${response.status} ${response.statusText}`.trim(),
	})
}

function stall_error(): AiError {
	return new AiError({ kind: 'timeout', status: null, message: 'the provider stopped responding' })
}

/** fetch rejects with a bare TypeError for offline, DNS, CORS and TLS alike. */
function fetch_error(error: unknown): unknown {
	if (error instanceof DOMException && (error.name === 'AbortError')) return error
	if (error instanceof DOMException && error.name === 'TimeoutError') {
		return new AiError({ kind: 'timeout', status: null, message: 'the provider did not respond in time' })
	}
	return new AiError({
		kind: 'network',
		status: null,
		message: error instanceof Error ? error.message : String(error),
	})
}

export const web_transport: AiTransport = {
	async list_models(base_url) {
		const url = parse(base_url)
		const key = stored_key(url)
		let response: Response
		try {
			response = await fetch(endpoint(url, 'models'), {
				headers: headers(key, false),
				signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
			})
		} catch (error) {
			throw fetch_error(error)
		}
		if (!response.ok) throw await status_error(response, key)
		const value = await response.json().catch(() => null) as { data?: { id?: unknown }[] } | null
		if (!value) {
			throw new AiError({
				kind: 'bad_request',
				status: null,
				message: 'the address did not answer like an OpenAI-compatible API',
			})
		}
		const ids = (value.data ?? []).map(model => model.id).filter((id): id is string => typeof id === 'string')
		return [...new Set(ids)].sort()
	},

	async chat(base_url: string, request: ChatRequest, options: StreamOptions = {}): Promise<ChatResult> {
		const url = parse(base_url)
		const key = stored_key(url)
		const { signal } = options
		if (signal?.aborted) throw signal.reason

		// the caller's stop and the stall timer both end the request
		const controller = new AbortController()
		const forward_stop = () => controller.abort(signal?.reason)
		signal?.addEventListener('abort', forward_stop, { once: true })
		let stalled = false
		let timer: ReturnType<typeof setTimeout> | undefined
		const arm_stall_timer = () => {
			clearTimeout(timer)
			timer = setTimeout(() => {
				stalled = true
				controller.abort()
			}, STALL_TIMEOUT_MS)
		}
		const failure = (error: unknown) => (stalled ? stall_error() : fetch_error(error))

		let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
		try {
			arm_stall_timer()
			let response: Response
			try {
				response = await fetch(endpoint(url, 'chat/completions'), {
					method: 'POST',
					headers: headers(key, true),
					body: JSON.stringify({ ...request, stream: true }),
					signal: controller.signal,
				})
			} catch (error) {
				throw failure(error)
			}
			if (!response.ok) throw await status_error(response, key)
			if (!response.body) throw new AiError({ kind: 'network', status: null, message: 'the response has no body' })

			reader = response.body.getReader()
			const parser = new SseParser()
			let text = ''
			let truncated = false
			for (;;) {
				arm_stall_timer()
				let next: Awaited<ReturnType<typeof reader.read>>
				try {
					next = await reader.read()
				} catch (error) {
					throw failure(error)
				}
				const events = next.done ? parser.finish() : parser.push(next.value)
				for (const data of events) {
					for (const chunk of interpret_chunk(data)) {
						if (chunk.type === 'delta') {
							text += chunk.text
							options.on_delta?.(chunk.text)
						} else if (chunk.type === 'truncated') {
							truncated = true
						} else if (chunk.type === 'done') {
							return { text, truncated }
						} else {
							throw new AiError({ kind: 'provider', status: null, message: scrub(chunk.message, key) })
						}
					}
				}
				if (next.done) return { text, truncated }
			}
		} finally {
			clearTimeout(timer)
			signal?.removeEventListener('abort', forward_stop)
			reader?.cancel().catch(() => {})
		}
	},

	async has_key(base_url) {
		return stored_key(parse(base_url)) !== null
	},

	async set_key(base_url, key) {
		const url = parse(base_url)
		const trimmed = key.trim()
		if (!trimmed) throw new AiError({ kind: 'invalid_input', status: null, message: 'the key is empty' })
		if (!may_carry_key(url)) {
			throw new AiError({ kind: 'invalid_input', status: null, message: 'a key is only sent over https or to this computer' })
		}
		const storage = session()
		if (!storage) throw new AiError({ kind: 'keyring', status: null, message: 'this browser blocks session storage' })
		storage.setItem(KEY_PREFIX + key_origin(url), trimmed)
	},

	async delete_key(base_url) {
		session()?.removeItem(KEY_PREFIX + key_origin(parse(base_url)))
	},
}
