import { describe, expect, test } from 'vitest'
import { interpret_chunk, SseParser } from './sse'

const bytes = (text: string) => new TextEncoder().encode(text)

describe('SseParser', () => {
	test('splits events across and within chunks', () => {
		const parser = new SseParser()
		expect(parser.push(bytes('data: one\n\ndata: two\r\n\r\n: comment\nevent: x\ndata: thr'))).toEqual(['one', 'two'])
		expect(parser.push(bytes('ee\n'))).toEqual([])
		expect(parser.push(bytes('\n'))).toEqual(['three'])
		expect(parser.push(bytes('data:a\ndata:b\n\n'))).toEqual(['a\nb'])
	})

	test('a character split between chunks survives', () => {
		const encoded = bytes('data: привет\n\n')
		const parser = new SseParser()
		expect(parser.push(encoded.slice(0, 8))).toEqual([])
		expect(parser.push(encoded.slice(8))).toEqual(['привет'])
	})

	test('a stream without the last blank line is flushed', () => {
		const parser = new SseParser()
		expect(parser.push(bytes('data: last'))).toEqual([])
		expect(parser.finish()).toEqual(['last'])
	})
})

describe('interpret_chunk', () => {
	test('deltas, done and errors', () => {
		expect(interpret_chunk('{"choices":[{"delta":{"content":"Hi"}}]}')).toEqual([{ type: 'delta', text: 'Hi' }])
		expect(interpret_chunk('{"choices":[{"delta":{"role":"assistant"}}]}')).toEqual([])
		expect(interpret_chunk(' [DONE] ')).toEqual([{ type: 'done' }])
		expect(interpret_chunk('{"error":{"message":"upstream failed"}}')).toEqual([{ type: 'failed', message: 'upstream failed' }])
		expect(interpret_chunk('garbage')).toEqual([])
	})

	test('a length finish marks the answer truncated', () => {
		expect(interpret_chunk('{"choices":[{"delta":{"content":"end"},"finish_reason":"length"}]}'))
			.toEqual([{ type: 'delta', text: 'end' }, { type: 'truncated' }])
		expect(interpret_chunk('{"choices":[{"delta":{},"finish_reason":"stop"}]}')).toEqual([])
	})
})
