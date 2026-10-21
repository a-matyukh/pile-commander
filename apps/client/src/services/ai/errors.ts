import { AiError } from './types'
import { ai_reach } from './locality'
import { preset_for_url } from './presets'

const IMAGE_WORDS = /\b(image|images|image_url|image input|vision|multimodal|multi-modal)\b/i
const REFUSAL_WORDS = /(not support|unsupported|doesn't support|does not support|only supported|not accept|doesn't accept|does not accept|no endpoints found|cannot process|can't process)/i

/**
 * True only for an answer that plainly says the model takes no images: a
 * client error (4xx, not auth or rate limit) whose text names both images
 * and a refusal. A timeout, a network failure, 429, 5xx or any other text is
 * not proof, so the model is not marked.
 */
export function is_no_vision_error(error: unknown): boolean {
	if (!(error instanceof AiError)) return false
	const client_error = error.kind === 'bad_request'
		|| (error.kind === 'not_found' && error.status === 404)
		|| (error.kind === 'http' && error.status !== null && error.status >= 400 && error.status < 500)
	if (!client_error) return false
	return IMAGE_WORDS.test(error.message) && REFUSAL_WORDS.test(error.message)
}

/** A provider message that talks about images being refused, whatever the status. */
function mentions_image_refusal(message: string): boolean {
	return IMAGE_WORDS.test(message) && REFUSAL_WORDS.test(message)
}

export type AiErrorContext = {
	base_url: string
	model?: string
	/** listing models (Test connection) or a chat request */
	operation: 'models' | 'chat'
	has_key?: boolean
	web?: boolean
}

function host_of(base_url: string): string {
	try {
		return new URL(base_url).host
	} catch {
		return base_url
	}
}

function with_detail(text: string, detail: string): string {
	const trimmed = detail.trim()
	return trimmed ? `${text} (${trimmed})` : text
}

export function is_abort_error(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError'
}

/** One sentence the settings panel and the previews can show as is. */
export function explain_ai_error(error: unknown, context: AiErrorContext): string {
	if (!(error instanceof AiError)) {
		return error instanceof Error ? error.message : String(error)
	}
	const preset = preset_for_url(context.base_url)
	const host = host_of(context.base_url)
	let reach: ReturnType<typeof ai_reach> | null = null
	try {
		reach = ai_reach(new URL(context.base_url))
	} catch {
		reach = null
	}
	const model = context.model ? `“${context.model}”` : 'this model'

	if (mentions_image_refusal(error.message)) {
		return `${context.model ? `The model ${model}` : 'This model'} doesn't accept images. Pick a vision model, e.g. qwen2.5vl or gemma3.`
	}

	switch (error.kind) {
		case 'connect':
			if (preset === 'ollama') return 'Ollama isn\'t running. Start it with `ollama serve`.'
			if (preset === 'lmstudio') return 'LM Studio\'s server isn\'t running. Start it in LM Studio → Developer → Start server.'
			if (reach === 'local') return `Nothing is listening at ${host}. Start the model server.`
			if (reach === 'network') {
				return `Can't reach ${host}. Check that the server is on and accepts connections from the network (for Ollama: OLLAMA_HOST=0.0.0.0).`
			}
			return `Can't reach ${host}. Check the address and your connection.`
		case 'certificate':
			if (reach === 'network') {
				return 'The server\'s certificate wasn\'t accepted. For an address on your local network, use http.'
			}
			return `The certificate of ${host} isn't trusted.`
		case 'timeout':
			return reach === 'cloud'
				? `${host} didn't respond in time. Try again.`
				: 'The model didn\'t respond in time. A large model can take a while to load; try again.'
		case 'network':
			if (context.web) {
				return `Couldn't reach ${host}. Check your connection; the provider may not accept requests from a browser.`
			}
			return with_detail(`Couldn't reach ${host}.`, error.message)
		case 'unauthorized':
			return context.has_key === false
				? 'This provider needs an API key.'
				: 'The provider rejected the API key.'
		case 'not_found':
			if (context.operation === 'models') {
				return 'No OpenAI-compatible API at this address. It usually ends with /v1.'
			}
			if (preset === 'ollama' && context.model) {
				return `The model ${model} isn't installed. Run \`ollama pull ${context.model}\`.`
			}
			return with_detail(`The provider doesn't know the model ${model}.`, error.message)
		case 'rate_limited':
			return with_detail('Too many requests, or the account is out of credits. Try again later.', error.message)
		case 'keyring':
			return 'Couldn\'t use the key: this system has no password storage available.'
		case 'keyring_denied':
			return 'Pile Commander wasn\'t allowed to use the password storage. Try again and choose Allow when the system asks.'
		case 'invalid_url':
		case 'invalid_input':
			return error.message
		case 'bad_request':
		case 'provider':
			return error.message || 'The provider refused the request.'
		case 'http':
			return with_detail(`The provider answered with an error${error.status ? ` ${error.status}` : ''}.`, error.message)
	}
}
