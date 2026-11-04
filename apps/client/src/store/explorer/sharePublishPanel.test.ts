import { afterEach, describe, expect, test } from 'vitest'
import { is_valid_slug } from '@pile-commander/file-manager'
import { explorer_language } from '@/store/explorer/language'
import { TREE_FILTERS } from '@/store/explorer/tree_view'
import {
	SHARE_WINDOWS,
	address_prefix,
	close_share_publish,
	hub_payload_for_switch,
	hub_publish_click,
	intent_window,
	open_share_window,
	preview_problem,
	publish_fields_dirty,
	share_empty_line,
	share_publish,
	slug_field_state,
	slug_from_name,
	normalize_tag,
	tag_problem,
	unpublish_needs_confirm,
	username_problem,
	waiting_invites,
	MAX_DESCRIPTION,
	MAX_TAGS,
} from './sharePublishPanel'

afterEach(() => {
	explorer_language.value = 'system'
})

describe('share panel', () => {
	test('an empty member list says only you have access', () => {
		explorer_language.value = 'ru'
		expect(share_empty_line(0)).toBe('Доступ только у вас')
		expect(share_empty_line(1)).toBeNull()
	})

	test('a member is not listed again as waiting', () => {
		const waiting = waiting_invites(
			[{ email: 'Sam@studio.com' }],
			[
				{ email: 'sam@studio.com', role: 'editor' as const },
				{ email: 'lee@studio.com', role: 'viewer' as const },
			],
		)
		expect(waiting.map(invite => invite.email)).toEqual(['lee@studio.com'])
	})
})

describe('publish panel', () => {
	test('the address prefix is the public host and the username', () => {
		expect(address_prefix('https://pile.example', 'alex')).toBe('pile.example/alex/')
	})

	test('a full Free allowance explains itself instead of publishing', () => {
		expect(hub_publish_click(true)).toBe('explain')
		expect(hub_publish_click(false)).toBe('publish')
	})

	test('turning public off asks when the Hub card or its forks would be lost', () => {
		expect(unpublish_needs_confirm(false, 0)).toBe(false)
		expect(unpublish_needs_confirm(true, 0)).toBe(true)
		expect(unpublish_needs_confirm(false, 3)).toBe(true)
	})

	test('turning the Hub off keeps the saved card fields, and a tag edit makes the card dirty', () => {
		const saved = { description: 'Harbor', tags: ['film'], preview_key: 'hub/a' }
		expect(hub_payload_for_switch(saved, true, false)).toEqual({
			description: 'Harbor',
			tags: ['film'],
			allow_fork: false,
			preview_key: 'hub/a',
		})
		expect(publish_fields_dirty(
			{ slug: 'harbor', tags: ['film', 'mood'], description: 'Harbor', preview_changed: false },
			{ slug: 'harbor', tags: ['film'], description: 'Harbor' },
		)).toBe(true)
	})

	test('a Cyrillic folder name becomes a valid slug, and a taken one offers the next free address', () => {
		expect(slug_from_name('Мой мудборд 2026')).toBe('moi-mudbord-2026')
		expect(is_valid_slug(slug_from_name('Мой мудборд 2026'))).toBe(true)
		const taken = slug_field_state('harbor', 'ws-2', { 'ws-1': 'harbor' })
		expect(taken.problem).toBe('taken')
		expect(taken.suggestion).toBe('harbor-2')
	})

	test('the three share windows use the folder-status icons and replace each other', () => {
		expect(SHARE_WINDOWS.map(item => item.icon)).toEqual([
			TREE_FILTERS.shared.icon,
			TREE_FILTERS.public_link.icon,
			TREE_FILTERS.in_hub.icon,
		])
		expect(SHARE_WINDOWS.map(item => item.window)).toEqual(['people', 'link', 'hub'])
		open_share_window('ws-1', 'people', 'Notes')
		expect(share_publish.window).toBe('people')
		open_share_window('ws-1', 'hub', 'Notes')
		expect(share_publish).toMatchObject({ open: true, window: 'hub', folder_name: 'Notes' })
		close_share_publish()
		expect(intent_window({ door: 'publish', target: 'hub' })).toBe('hub')
		expect(intent_window({ door: 'share', target: 'people' })).toBe('people')
		expect(intent_window({ door: 'publish' })).toBe('link')
	})

	test('slug, tags, description and preview follow their limits', () => {
		expect(username_problem('Ab')).toBe('format')
		expect(username_problem('hub')).toBe('reserved')
		expect(username_problem('alex')).toBeNull()
		expect(tag_problem('Film', [])).toBeNull()
		expect(tag_problem('мудборд', [])).toBeNull()
		expect(tag_problem('#Café-2026', [])).toBeNull()
		expect(normalize_tag('#Мудборд ')).toBe('мудборд')
		expect(tag_problem('two words', [])).toBe('format')
		expect(tag_problem('a', [])).toBe('format')
		expect(tag_problem('x½', [])).toBe('format')
		expect(tag_problem('Film', ['film'])).toBe('dup')
		expect(tag_problem('mood', Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`))).toBe('limit')
		expect(tag_problem('mood', ['film'])).toBeNull()
		expect(preview_problem({ name: 'a.gif', type: 'image/gif', size: 10 })).toBe('type')
		expect(preview_problem({ name: 'a.png', type: 'image/png', size: 3 * 1024 * 1024 })).toBe('too_big')
		expect(preview_problem({ name: 'a.png', type: 'image/png', size: 100 })).toBeNull()
		const long = 'x'.repeat(MAX_DESCRIPTION + 1)
		expect(long.length).toBe(MAX_DESCRIPTION + 1)
	})
})
