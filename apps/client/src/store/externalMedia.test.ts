// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import cloud from '@/store/cloud'
import { has_held_media, may_load_media, media_gate, show_external_media } from './externalMedia'

const PICTURE = 'https://images.example.com/wall.jpg'
const mine = { type: 'cloud' as const, uid: 'ws-mine' }
const shared = { type: 'cloud' as const, uid: 'ws-shared' }
/** A folder nobody invited the person to; a new one per test, since answers are kept per folder. */
let visits = 0
let visited = { type: 'cloud' as const, uid: 'ws-visited-0' }

let saved: { workspaces: typeof cloud.workspaces; roles: typeof cloud.roles; user: typeof cloud.user; is_loading: boolean }

beforeEach(() => {
	saved = { workspaces: cloud.workspaces.slice(), roles: { ...cloud.roles }, user: cloud.user, is_loading: cloud.is_loading }
	cloud.user = { id: 'u1' } as never
	cloud.is_loading = false
	cloud.workspaces = [{ id: 'ws-mine', name: 'Mine' }, { id: 'ws-shared', name: 'Shared' }] as never
	cloud.roles = { 'ws-mine': 'owner', 'ws-shared': 'editor' }
	visited = { type: 'cloud', uid: `ws-visited-${++visits}` }
})

afterEach(() => {
	Object.assign(cloud, saved)
})

describe('whose folder decides what loads by itself', () => {
	test('the person\'s own folders load everything, as before', () => {
		expect(media_gate(mine)).toBe('own')
		expect(media_gate({ type: 'local', uid: '/Users/ann' })).toBe('own')
		expect(media_gate({ type: 'browser', uid: '/desk' })).toBe('own')
		expect(media_gate({ type: 'demo', uid: 'demo' })).toBe('own')
		expect(media_gate(null)).toBe('own')
		expect(may_load_media(PICTURE, mine)).toBe(true)
		expect(may_load_media('http://192.168.1.1/cam.jpg', { type: 'local', uid: '/Users/ann' })).toBe(true)
		expect(has_held_media(mine)).toBe(false)
	})

	test('a folder the person was invited to, or only visits, holds other sites back and says so', () => {
		expect(media_gate(shared)).toBe('hide')
		expect(media_gate(visited)).toBe('hide')
		expect(has_held_media(visited)).toBe(false)
		expect(may_load_media(PICTURE, visited)).toBe(false)
		expect(has_held_media(visited)).toBe(true)
		// what the app holds itself is never in question
		expect(may_load_media('blob:https://app/1', visited)).toBe(true)
		expect(may_load_media('#ffcc00', visited)).toBe(true)
		expect(may_load_media('pile:cover-aaaaaaaa.webp', visited)).toBe(true)
	})

	test('"Show" is kept for that folder alone', () => {
		expect(may_load_media(PICTURE, shared)).toBe(false)
		show_external_media(shared)
		expect(media_gate(shared)).toBe('show')
		expect(may_load_media(PICTURE, shared)).toBe(true)
		expect(has_held_media(shared)).toBe(false)
		expect(media_gate(visited)).toBe('hide')
	})

	test('an address inside the visitor\'s own network never loads there, shown or not, and no bar offers it', () => {
		expect(may_load_media('http://192.168.1.1/admin.png', visited)).toBe(false)
		expect(may_load_media('http://localhost:8080/x.png', visited)).toBe(false)
		expect(has_held_media(visited)).toBe(false)
		show_external_media(visited)
		expect(may_load_media('http://192.168.1.1/admin.png', visited)).toBe(false)
		expect(may_load_media(PICTURE, visited)).toBe(true)
	})

	test('an anonymous visitor is a visitor at once; a signed-in one waits for the list of their folders', () => {
		cloud.user = null
		cloud.roles = {}
		cloud.workspaces = []
		expect(media_gate(visited)).toBe('hide')
		cloud.user = { id: 'u1' } as never
		cloud.is_loading = true
		expect(media_gate(mine)).toBe('wait')
		expect(may_load_media(PICTURE, mine)).toBe(false)
		// nothing is said while it is not known whose folder this is
		expect(has_held_media(mine)).toBe(false)
		cloud.is_loading = false
		cloud.workspaces = [{ id: 'ws-mine', name: 'Mine' }] as never
		cloud.roles = { 'ws-mine': 'owner' }
		expect(media_gate(mine)).toBe('own')
	})
})
