import { reactive } from 'vue'
import { is_reserved_slug, is_valid_slug, HUB_PREVIEW_MAX_BYTES, hub_preview_ext } from '@pile-commander/file-manager'
import { t } from '@/i18n'

export type SharePublishMode = 'share' | 'publish'

export const share_publish = reactive({
	open: false,
	mode: 'share' as SharePublishMode,
	workspace_id: '',
})

export function open_share_panel(workspace_id: string): void {
	share_publish.workspace_id = workspace_id
	share_publish.mode = 'share'
	share_publish.open = true
}

export function open_publish_panel(workspace_id: string): void {
	share_publish.workspace_id = workspace_id
	share_publish.mode = 'publish'
	share_publish.open = true
}

export function close_share_publish(): void {
	share_publish.open = false
}

/** DB: set_hub_listing validates each tag against this pattern. */
export const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/
export const MAX_TAGS = 5
export const MAX_DESCRIPTION = 280

/** DB: profiles.username ~ '^[a-z0-9][a-z0-9-]{2,39}$' */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/

export function waiting_invites<T extends { email: string }>(
	members: readonly { email: string }[],
	invites: readonly T[],
): T[] {
	const taken = new Set(members.map(member => member.email.trim().toLowerCase()))
	return invites.filter(invite => !taken.has(invite.email.trim().toLowerCase()))
}

export function username_problem(value: string): 'format' | 'reserved' | null {
	const trimmed = value.trim()
	if (!trimmed) return null
	if (!USERNAME_PATTERN.test(trimmed)) return 'format'
	if (is_reserved_slug(trimmed)) return 'reserved'
	return null
}

/** Turning the public switch on does nothing until the slug can be published. */
export function slug_blocks_publish(slug: string): boolean {
	return !is_valid_slug(slug.trim())
}

/**
 * set_workspace_private deletes the Hub row. Ask first when that row exists
 * or it already counts forks.
 */
export function unpublish_needs_confirm(on_hub: boolean, fork_count: number): boolean {
	return on_hub || fork_count > 0
}

/** Forks and Hub on a public board are written at once. While private they wait. */
export function fork_toggle_effect(is_public: boolean): 'publish' | 'stage' {
	return is_public ? 'publish' : 'stage'
}

/** Tags, the description, the preview and the slug wait for Save. */
export function text_edit_effect(): 'stage' {
	return 'stage'
}

export function save_button_visible(is_public: boolean, dirty: boolean): boolean {
	return is_public && dirty
}

export function same_tags(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false
	return a.every((tag, index) => tag === b[index])
}

export function publish_fields_dirty(
	draft: { slug: string; tags: readonly string[]; description: string; preview_changed: boolean },
	saved: { slug: string; tags: readonly string[]; description: string },
): boolean {
	return draft.preview_changed
		|| draft.slug.trim() !== saved.slug
		|| draft.description.trim() !== saved.description
		|| !same_tags(draft.tags, saved.tags)
}

/** A switch save sends the stored text, not the unsaved draft. */
export function hub_payload_for_switch(
	saved: { description: string; tags: readonly string[]; preview_key: string | null } | null,
	list: boolean,
	allow_fork: boolean,
): { description: string; tags: string[]; allow_fork: boolean; preview_key: string | null } | null {
	if (!list) return null
	return {
		description: saved?.description ?? '',
		tags: [...(saved?.tags ?? [])],
		allow_fork,
		preview_key: saved?.preview_key ?? null,
	}
}

export function tag_problem(value: string, tags: readonly string[]): 'format' | 'dup' | 'limit' | null {
	const trimmed = value.trim()
	if (!trimmed) return null
	if (!TAG_PATTERN.test(trimmed)) return 'format'
	if (tags.includes(trimmed)) return 'dup'
	if (tags.length >= MAX_TAGS) return 'limit'
	return null
}

export function preview_problem(file: { name: string; type: string; size: number }): 'too_big' | 'type' | null {
	if (file.size > HUB_PREVIEW_MAX_BYTES) return 'too_big'
	if (!hub_preview_ext(file.name, file.type)) return 'type'
	return null
}

export function share_empty_line(member_count: number): string | null {
	return member_count === 0 ? t('share.only_you') : null
}

export type PublishFace = {
	show_username: boolean
	show_form: boolean
	show_link: boolean
	show_private_lead: boolean
	show_hidden: boolean
	show_save: boolean
	unpublish_confirm: boolean
}

export function publish_face(input: {
	has_username: boolean
	is_public: boolean
	on_hub: boolean
	hidden: boolean
	fork_count: number
	dirty: boolean
}): PublishFace {
	return {
		show_username: !input.has_username,
		show_form: input.has_username,
		show_link: input.has_username && input.is_public,
		show_private_lead: input.has_username && !input.is_public,
		show_hidden: input.has_username && input.hidden,
		show_save: save_button_visible(input.is_public, input.dirty),
		unpublish_confirm: input.is_public && unpublish_needs_confirm(input.on_hub, input.fork_count),
	}
}
