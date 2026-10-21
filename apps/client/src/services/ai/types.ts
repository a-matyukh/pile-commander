/** One part of a message, as in the OpenAI chat completions API. */
export type AiContentPart =
	| { type: 'text'; text: string }
	/** `url` is a `data:image/jpeg;base64,…` URL */
	| { type: 'image_url'; image_url: { url: string } }

export type AiMessage = {
	role: 'system' | 'user' | 'assistant'
	content: string | AiContentPart[]
}

/** Error kinds the desktop command reports; the web transport uses the same. */
export type AiErrorKind =
	| 'invalid_url'
	| 'invalid_input'
	| 'connect'
	| 'certificate'
	| 'timeout'
	| 'network'
	| 'unauthorized'
	| 'not_found'
	| 'rate_limited'
	| 'bad_request'
	| 'http'
	| 'provider'
	/** no usable password storage on this system */
	| 'keyring'
	/** the user refused the system's prompt for the password storage */
	| 'keyring_denied'

export type AiErrorPayload = {
	kind: AiErrorKind
	status: number | null
	message: string
}

export class AiError extends Error {
	readonly kind: AiErrorKind
	readonly status: number | null

	constructor(payload: AiErrorPayload) {
		super(payload.message)
		this.name = 'AiError'
		this.kind = payload.kind
		this.status = payload.status
	}
}

export function is_ai_error_payload(value: unknown): value is AiErrorPayload {
	return typeof value === 'object'
		&& value !== null
		&& typeof (value as AiErrorPayload).kind === 'string'
		&& typeof (value as AiErrorPayload).message === 'string'
}

export type ChatRequest = {
	model: string
	messages: AiMessage[]
	max_tokens?: number
	temperature?: number
}

export type ChatResult = {
	text: string
	/** the model stopped at its token limit, so the text may be incomplete */
	truncated: boolean
}

export type StreamOptions = {
	on_delta?: (text: string) => void
	signal?: AbortSignal
}

/** Where requests go: the Rust commands on desktop, fetch in the browser. */
export type AiTransport = {
	list_models(base_url: string): Promise<string[]>
	chat(base_url: string, request: ChatRequest, options?: StreamOptions): Promise<ChatResult>
	has_key(base_url: string): Promise<boolean>
	set_key(base_url: string, key: string): Promise<void>
	delete_key(base_url: string): Promise<void>
}
