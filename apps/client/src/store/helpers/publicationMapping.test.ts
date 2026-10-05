import { describe, expect, it } from 'vitest'
import {
	hub_new_listing_blocked,
	owned_hub_listed,
	owned_hub_hidden,
	owned_public_slugs,
	owned_shared_out,
	publication_view_ids,
} from './publicationMapping'

describe('owned_public_slugs', () => {
	it('maps public owned rows by their own id, not a clone id', () => {
		expect(owned_public_slugs([
			{ id: 'ws-private', slug: null, is_public: false },
			{ id: 'ws-public', slug: 'hello', is_public: true },
			{ id: 'ws-no-slug', slug: null, is_public: true },
		])).toEqual({ 'ws-public': 'hello' })
	})
})

describe('owned_shared_out', () => {
	it('marks owned rows that have invitees', () => {
		expect(owned_shared_out([
			{ id: 'ws-empty', workspace_members: [] },
			{ id: 'ws-null', workspace_members: null },
			{ id: 'ws-none' },
			{ id: 'ws-one', workspace_members: [{ user_id: 'u1' }] },
			{ id: 'ws-embed', workspace_members: { user_id: 'u2' } },
			{ id: 'ws-pending', workspace_invites: [{ email: 'a@b.com', expires_at: '2099-01-01T00:00:00Z' }] },
		])).toEqual({ 'ws-one': true, 'ws-embed': true, 'ws-pending': true })
	})

	it('ignores expired pending invites', () => {
		expect(owned_shared_out([
			{ id: 'ws-dead', workspace_invites: [{ email: 'a@b.com', expires_at: '2000-01-01T00:00:00Z' }] },
		])).toEqual({})
	})
})

describe('owned_hub_listed', () => {
	it('marks owned rows that have a Hub listing', () => {
		expect(owned_hub_listed([
			{ id: 'ws-private', hub_publications: [] },
			{ id: 'ws-public', hub_publications: null },
			{ id: 'ws-hub', hub_publications: [{ source_workspace_id: 'ws-hub' }] },
			{ id: 'ws-embed', hub_publications: { source_workspace_id: 'ws-embed' } },
		])).toEqual({ 'ws-hub': true, 'ws-embed': true })
	})
})

describe('owned_hub_hidden', () => {
	it('marks Hub listings with hidden_at', () => {
		expect(owned_hub_hidden([
			{ id: 'ws-hub', hub_publications: [{ source_workspace_id: 'ws-hub', hidden_at: null }] },
			{ id: 'ws-hidden', hub_publications: { source_workspace_id: 'ws-hidden', hidden_at: '2026-01-01T00:00:00Z' } },
			{ id: 'ws-empty', hub_publications: [] },
		])).toEqual({ 'ws-hidden': true })
	})
})

describe('hub_new_listing_blocked', () => {
	it('blocks a new listing at cap', () => {
		expect(hub_new_listing_blocked(3, 3, false)).toBe(true)
	})

	it('does not block an already listed board at cap', () => {
		expect(hub_new_listing_blocked(3, 3, true)).toBe(false)
	})

	it('does not block under the cap', () => {
		expect(hub_new_listing_blocked(2, 3, false)).toBe(false)
	})

	it('does not block when there is no cap', () => {
		expect(hub_new_listing_blocked(99, null, false)).toBe(false)
		expect(hub_new_listing_blocked(99, undefined, false)).toBe(false)
	})
})

describe('publication_view_ids', () => {
	it('uses the live workspace id and allow_fork even without a Hub listing', () => {
		expect(publication_view_ids({
			id: 'ws-1',
			allow_fork: true,
			fork: null,
		})).toEqual({
			workspace_id: 'ws-1',
			can_fork: true,
			fork_count: 0,
		})
	})

	it('reads fork_count from the Hub listing when present', () => {
		expect(publication_view_ids({
			id: 'ws-1',
			allow_fork: false,
			fork: { fork_count: 3 },
		})).toEqual({
			workspace_id: 'ws-1',
			can_fork: false,
			fork_count: 3,
		})
	})
})
