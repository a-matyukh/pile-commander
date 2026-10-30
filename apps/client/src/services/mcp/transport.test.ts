import { describe, expect, test } from 'vitest'
import { ByteTransport } from './transport'

const encoder = new TextEncoder()

describe('mcp byte transport', () => {
	test('a json line split across chunks is one message, and send writes only that line', async () => {
		const written: Uint8Array[] = []
		const transport = new ByteTransport(async (bytes) => {
			written.push(bytes)
		})
		const messages: unknown[] = []
		transport.onmessage = (message) => messages.push(message)

		transport.push(encoder.encode('{"jsonrpc":"2.0","id":1,'))
		expect(messages).toEqual([])
		transport.push(encoder.encode('"method":"ping"}\n'))
		expect(messages).toEqual([{ jsonrpc: '2.0', id: 1, method: 'ping' }])

		await transport.send({ jsonrpc: '2.0', id: 1, result: {} })
		expect(new TextDecoder().decode(written[0])).toBe('{"jsonrpc":"2.0","id":1,"result":{}}\n')
	})
})
