import { describe, expect, it, vi } from 'vitest'
import { FEEDBACK_ATTACHMENT_MAX_BYTES, accept_feedback_files, send_feedback, type FeedbackDraft } from './feedback'

const image = (name: string, size = 10, type = 'image/png') => new File([new Uint8Array(size)], name, { type })

function draft(files: File[] = []): FeedbackDraft {
	return { email: ' me@example.com ', category: 'bug', message: 'It broke', files }
}

function json(status: number, body: unknown = {}) {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('send_feedback', () => {
	it('posts the note, then puts each screenshot to its signed URL', async () => {
		const files = [image('a.png'), image('b.png')]
		const fetch_impl = vi.fn(async (input: string, _init?: RequestInit) => {
			if (String(input).endsWith('/feedback')) {
				return json(200, {
					ok: true,
					uploads: [
						{ path: 'x/1.png', token: 't1', signedUrl: 'https://s/1' },
						{ path: 'x/2.png', token: 't2', signedUrl: 'https://s/2' },
					],
				})
			}
			return new Response(null, { status: 200 })
		})
		expect(await send_feedback('https://api.example/', draft(files), fetch_impl)).toBe('ok')
		expect(fetch_impl).toHaveBeenCalledTimes(3)
		const [url, init] = fetch_impl.mock.calls[0]!
		expect(url).toBe('https://api.example/feedback')
		expect(JSON.parse(String(init?.body))).toEqual({
			email: 'me@example.com',
			category: 'bug',
			message: 'It broke',
			website: '',
			attachments: [{ mime: 'image/png', size: 10 }, { mime: 'image/png', size: 10 }],
		})
		expect(fetch_impl.mock.calls[1]![0]).toBe('https://s/1')
		expect(fetch_impl.mock.calls[1]![1]?.method).toBe('PUT')
		expect(fetch_impl.mock.calls[2]![1]?.body).toBe(files[1])
	})

	it('reads 429 as rate limited and 400 as invalid', async () => {
		expect(await send_feedback('b', draft(), async () => json(429))).toBe('rate_limited')
		expect(await send_feedback('b', draft(), async () => json(400))).toBe('invalid')
		expect(await send_feedback('b', draft(), async () => json(403))).toBe('failed')
		expect(await send_feedback('b', draft(), async () => { throw new TypeError('offline') })).toBe('failed')
	})

	it('says so when the note went but a screenshot did not', async () => {
		const fetch_impl = async (input: string) =>
			String(input).endsWith('/feedback')
				? json(200, { ok: true, uploads: [{ path: 'p', token: 't', signedUrl: 'https://s/1' }] })
				: new Response(null, { status: 500 })
		expect(await send_feedback('b', draft([image('a.png')]), fetch_impl)).toBe('upload_failed')
	})
})

describe('accept_feedback_files', () => {
	it('keeps images up to the size limit, five at most', () => {
		const picked = [1, 2, 3, 4, 5, 6].map(n => image(`${n}.png`))
		const { files, refused } = accept_feedback_files([], picked)
		expect(files).toHaveLength(5)
		expect(refused).toBe(false)
	})

	it('refuses other types, empty and oversized files', () => {
		const picked = [
			image('a.pdf', 10, 'application/pdf'),
			image('empty.png', 0),
			image('big.png', FEEDBACK_ATTACHMENT_MAX_BYTES + 1),
			image('ok.webp', 10, 'image/webp'),
		]
		const { files, refused } = accept_feedback_files([image('first.gif', 10, 'image/gif')], picked)
		expect(files.map(file => file.name)).toEqual(['first.gif', 'ok.webp'])
		expect(refused).toBe(true)
	})
})
