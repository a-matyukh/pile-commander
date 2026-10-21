import { describe, expect, test } from 'vitest'
import { consents_needed, grant_consents, shared_workspace_id } from './consent'

const none = { cloud: [], images: [], shared: [] }
const origin = 'https://openrouter.ai'

describe('consents_needed', () => {
	test('this computer and the local network never ask', () => {
		for (const reach of ['local', 'network'] as const) {
			expect(consents_needed({ reach, origin, sends_images: true, shared_workspace_id: 'ws', consents: none })).toEqual([])
		}
	})

	test('the first cloud request asks once per provider', () => {
		expect(consents_needed({ reach: 'cloud', origin, sends_images: false, shared_workspace_id: null, consents: none }))
			.toEqual(['cloud'])
		const granted = grant_consents(none, ['cloud'], origin, null)
		expect(consents_needed({ reach: 'cloud', origin, sends_images: false, shared_workspace_id: null, consents: granted }))
			.toEqual([])
		expect(consents_needed({ reach: 'cloud', origin: 'https://api.openai.com', sends_images: false, shared_workspace_id: null, consents: granted }))
			.toEqual(['cloud'])
	})

	test('images ask separately, even after the text consent', () => {
		const text_only = grant_consents(none, ['cloud'], origin, null)
		expect(consents_needed({ reach: 'cloud', origin, sends_images: true, shared_workspace_id: null, consents: text_only }))
			.toEqual(['images'])
	})

	test('a shared workspace asks once per workspace', () => {
		const provider_ok = grant_consents(none, ['cloud', 'images'], origin, null)
		expect(consents_needed({ reach: 'cloud', origin, sends_images: true, shared_workspace_id: 'ws-1', consents: provider_ok }))
			.toEqual(['shared'])
		const both = grant_consents(provider_ok, ['shared'], origin, 'ws-1')
		expect(consents_needed({ reach: 'cloud', origin, sends_images: true, shared_workspace_id: 'ws-1', consents: both }))
			.toEqual([])
		expect(consents_needed({ reach: 'cloud', origin, sends_images: true, shared_workspace_id: 'ws-2', consents: both }))
			.toEqual(['shared'])
	})
})

describe('shared_workspace_id', () => {
	const deps = (roles: Record<string, string>, shared_out: Record<string, true> = {}, links: Record<string, string> = {}) => ({
		role_of: (id: string) => roles[id] ?? null,
		shared_out,
		linked_workspace_id: (root: string) => links[root] ?? null,
	})

	test('my own workspace that nobody else is in', () => {
		expect(shared_workspace_id({ type: 'cloud', uid: 'ws', id: '/' }, deps({ ws: 'owner' }))).toBeNull()
	})

	test('my workspace shared with others, or someone else\'s', () => {
		expect(shared_workspace_id({ type: 'cloud', uid: 'ws', id: '/' }, deps({ ws: 'owner' }, { ws: true }))).toBe('ws')
		expect(shared_workspace_id({ type: 'cloud', uid: 'ws', id: '/' }, deps({ ws: 'editor' }))).toBe('ws')
	})

	test('a local folder synced with a shared workspace', () => {
		const local = { type: 'local', uid: '/Users/me/Board', id: '/Users/me/Board' }
		expect(shared_workspace_id(local, deps({ ws: 'editor' }, {}, { '/Users/me/Board': 'ws' }))).toBe('ws')
		expect(shared_workspace_id(local, deps({}, {}, {}))).toBeNull()
	})
})
