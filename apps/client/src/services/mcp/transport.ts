import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js'

const MAX_BUFFER = 10 * 1024 * 1024

/**
 * One MCP session over the raw bytes Rust forwards. Messages are JSON-RPC
 * lines, the same framing as stdio. Rust does not parse them.
 */
export class ByteTransport implements Transport {
	onclose?: () => void
	onerror?: (error: Error) => void
	onmessage?: (message: JSONRPCMessage) => void

	private pending = ''
	private readonly decoder = new TextDecoder()
	private closed = false

	constructor(private readonly write_bytes: (bytes: Uint8Array) => Promise<void>) {}

	async start(): Promise<void> {}

	push(bytes: Uint8Array) {
		if (this.closed) return
		this.pending += this.decoder.decode(bytes, { stream: true })
		if (this.pending.length > MAX_BUFFER) {
			this.pending = ''
			this.onerror?.(new Error('mcp message is too large'))
			return
		}
		let newline = this.pending.indexOf('\n')
		while (newline !== -1) {
			const line = this.pending.slice(0, newline).replace(/\r$/, '')
			this.pending = this.pending.slice(newline + 1)
			newline = this.pending.indexOf('\n')
			if (line === '') continue
			try {
				this.onmessage?.(JSON.parse(line) as JSONRPCMessage)
			} catch (error) {
				this.onerror?.(error instanceof Error ? error : new Error(String(error)))
			}
		}
	}

	ended() {
		if (this.closed) return
		this.closed = true
		this.onclose?.()
	}

	async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
		if (this.closed) throw new Error('mcp session is closed')
		await this.write_bytes(new TextEncoder().encode(`${JSON.stringify(message)}\n`))
	}

	async close(): Promise<void> {
		this.ended()
	}
}
