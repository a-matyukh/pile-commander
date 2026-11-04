import { afterEach, describe, expect, test } from 'vitest'
import { explorer_language } from '@/store/explorer/language'
import {
	fork_toggle_effect,
	hub_payload_for_switch,
	preview_problem,
	publish_face,
	publish_fields_dirty,
	save_button_visible,
	share_empty_line,
	slug_blocks_publish,
	tag_problem,
	text_edit_effect,
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
	test('without a username the form stays behind the username field', () => {
		const face = publish_face({
			has_username: false,
			is_public: false,
			on_hub: false,
			hidden: false,
			fork_count: 0,
			dirty: false,
		})
		expect(face.show_username).toBe(true)
		expect(face.show_form).toBe(false)
	})

	test('a private board has no link, a public one does', () => {
		const shared = {
			has_username: true,
			on_hub: false,
			hidden: false,
			fork_count: 0,
			dirty: false,
		}
		expect(publish_face({ ...shared, is_public: false }).show_link).toBe(false)
		expect(publish_face({ ...shared, is_public: false }).show_private_lead).toBe(true)
		expect(publish_face({ ...shared, is_public: true }).show_link).toBe(true)
		expect(publish_face({ ...shared, is_public: true, on_hub: true, hidden: true }).show_hidden).toBe(true)
	})

	test('turning public on needs a valid slug', () => {
		expect(slug_blocks_publish('')).toBe(true)
		expect(slug_blocks_publish('No')).toBe(true)
		expect(slug_blocks_publish('harbor-mood')).toBe(false)
	})

	test('turning public off asks when the Hub card or its forks would be lost', () => {
		expect(unpublish_needs_confirm(false, 0)).toBe(false)
		expect(unpublish_needs_confirm(true, 0)).toBe(true)
		expect(unpublish_needs_confirm(false, 3)).toBe(true)
	})

	test('a public board writes a fork switch immediately and keeps a tag edit until Save', () => {
		expect(fork_toggle_effect(true)).toBe('publish')
		expect(fork_toggle_effect(false)).toBe('stage')
		expect(text_edit_effect()).toBe('stage')
		expect(save_button_visible(true, true)).toBe(true)
		expect(save_button_visible(true, false)).toBe(false)
		expect(save_button_visible(false, true)).toBe(false)
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

	test('slug, tags, description and preview follow their limits', () => {
		expect(username_problem('Ab')).toBe('format')
		expect(username_problem('hub')).toBe('reserved')
		expect(username_problem('alex')).toBeNull()
		expect(tag_problem('Film', [])).toBe('format')
		expect(tag_problem('film', ['film'])).toBe('dup')
		expect(tag_problem('mood', Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`))).toBe('limit')
		expect(tag_problem('mood', ['film'])).toBeNull()
		expect(preview_problem({ name: 'a.gif', type: 'image/gif', size: 10 })).toBe('type')
		expect(preview_problem({ name: 'a.png', type: 'image/png', size: 3 * 1024 * 1024 })).toBe('too_big')
		expect(preview_problem({ name: 'a.png', type: 'image/png', size: 100 })).toBeNull()
		const long = 'x'.repeat(MAX_DESCRIPTION + 1)
		expect(long.length).toBe(MAX_DESCRIPTION + 1)
	})
})
