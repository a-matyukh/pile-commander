import { is_desktop } from '@/isDesktop'
import { ai_settings, record_vision } from '@/store/ai'
import { desktop_transport } from './desktopTransport'
import { is_no_vision_error } from './errors'
import type { AiMessage, AiTransport, ChatResult, StreamOptions } from './types'
import { web_transport } from './webTransport'

export function ai_transport(): AiTransport {
	return is_desktop ? desktop_transport : web_transport
}

function has_images(messages: AiMessage[]): boolean {
	return messages.some(message =>
		Array.isArray(message.content) && message.content.some(part => part.type === 'image_url'))
}

export type AiChatOptions = StreamOptions & {
	max_tokens?: number
	temperature?: number
}

/**
 * One chat completion with the configured provider and model. A request
 * that carried images records whether the model took them.
 */
export async function ai_chat(
	messages: AiMessage[],
	options: AiChatOptions = {},
	transport: AiTransport = ai_transport(),
): Promise<ChatResult> {
	const { base_url, model } = ai_settings.value
	const { max_tokens, temperature, ...stream } = options
	const images = has_images(messages)
	try {
		const result = await transport.chat(base_url, { model: model.trim(), messages, max_tokens, temperature }, stream)
		if (images) record_vision(base_url, model, true)
		return result
	} catch (error) {
		if (images && is_no_vision_error(error)) record_vision(base_url, model, false)
		throw error
	}
}
