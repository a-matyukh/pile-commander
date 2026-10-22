/**
 * The browser twin of `SseParser` / `interpret` in src-tauri/src/ai.rs:
 * splits a `text/event-stream` body into event data and reads each as an
 * OpenAI chat completion chunk.
 */
export class SseParser {
	private readonly decoder = new TextDecoder()
	private pending = ''
	private data: string[] = []

	/** Bytes are decoded in streaming mode, so a character split across chunks survives. */
	push(chunk: Uint8Array): string[] {
		this.pending += this.decoder.decode(chunk, { stream: true })
		const events: string[] = []
		let at = this.pending.indexOf('\n')
		while (at !== -1) {
			this.line(this.pending.slice(0, at), events)
			this.pending = this.pending.slice(at + 1)
			at = this.pending.indexOf('\n')
		}
		return events
	}

	/** The stream ended; some servers omit the blank line after the last event. */
	finish(): string[] {
		const events: string[] = []
		this.pending += this.decoder.decode()
		if (this.pending) {
			this.line(this.pending, events)
			this.pending = ''
		}
		if (this.data.length) {
			events.push(this.data.join('\n'))
			this.data = []
		}
		return events
	}

	private line(raw: string, events: string[]) {
		const line = raw.replace(/\r$/, '')
		if (!line) {
			if (this.data.length) {
				events.push(this.data.join('\n'))
				this.data = []
			}
			return
		}
		// `event:`, `id:`, `retry:` and `:` comments carry nothing we use
		if (line.startsWith('data:')) {
			const value = line.slice('data:'.length)
			this.data.push(value.startsWith(' ') ? value.slice(1) : value)
		}
	}
}

export type SseChunk =
	| { type: 'delta'; text: string }
	| { type: 'truncated' }
	| { type: 'done' }
	| { type: 'failed'; message: string }

export function error_text(error: unknown): string {
	if (typeof error === 'string') return error
	if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
		return (error as { message: string }).message
	}
	return JSON.stringify(error)
}

export function interpret_chunk(data: string): SseChunk[] {
	if (data.trim() === '[DONE]') return [{ type: 'done' }]
	let value: unknown
	try {
		value = JSON.parse(data)
	} catch {
		return []
	}
	if (!value || typeof value !== 'object') return []
	const record = value as {
		error?: unknown
		choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[]
	}
	// OpenRouter reports an upstream failure mid-stream this way
	if (record.error !== undefined) return [{ type: 'failed', message: error_text(record.error) }]
	const choice = record.choices?.[0]
	const chunks: SseChunk[] = []
	const text = choice?.delta?.content
	if (typeof text === 'string' && text) chunks.push({ type: 'delta', text })
	if (choice?.finish_reason === 'length') chunks.push({ type: 'truncated' })
	return chunks
}
