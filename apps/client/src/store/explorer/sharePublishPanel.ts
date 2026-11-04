import { reactive } from 'vue'
import { is_reserved_slug, is_valid_slug, HUB_PREVIEW_MAX_BYTES, hub_preview_ext } from '@pile-commander/file-manager'
import { t } from '@/i18n'
import { TREE_FILTERS } from '@/store/explorer/tree_view'

/** The three windows under Share. Icons are the folder-status ones. */
export type ShareWindow = 'people' | 'link' | 'hub'

export const SHARE_WINDOWS: { window: ShareWindow; icon: string; label: 'share.share_with' | 'share.make_public_folder' | 'share.publish_hub' }[] = [
	{ window: 'people', icon: TREE_FILTERS.shared.icon, label: 'share.share_with' },
	{ window: 'link', icon: TREE_FILTERS.public_link.icon, label: 'share.make_public_folder' },
	{ window: 'hub', icon: TREE_FILTERS.in_hub.icon, label: 'share.publish_hub' },
]

export const share_publish = reactive({
	open: false,
	window: 'people' as ShareWindow,
	workspace_id: '',
	folder_name: '',
})

export function open_share_window(workspace_id: string, window: ShareWindow, folder_name = ''): void {
	share_publish.workspace_id = workspace_id
	share_publish.window = window
	share_publish.folder_name = folder_name
	share_publish.open = true
}

export function open_share_panel(workspace_id: string, folder_name = ''): void {
	open_share_window(workspace_id, 'people', folder_name)
}

export function open_publish_panel(workspace_id: string, folder_name = ''): void {
	open_share_window(workspace_id, 'link', folder_name)
}

export function close_share_publish(): void {
	share_publish.open = false
}

/** People stays a share event; a public link and the Hub are both publish. */
export function bridge_door_for(window: ShareWindow): 'share' | 'publish' {
	return window === 'people' ? 'share' : 'publish'
}

/** Which window a finished copy should open. */
export function intent_window(intent: { door: string; target?: ShareWindow }): ShareWindow | null {
	if (intent.target) return intent.target
	if (intent.door === 'share') return 'people'
	if (intent.door === 'publish') return 'link'
	return null
}

/** DB: set_hub_listing validates each tag against this pattern. */
/**
 * DB: set_hub_listing. Lowercase letters of any script, digits and hyphens,
 * 2–32 characters. Typed capitals are lowered (normalize_tag), not refused.
 */
export const TAG_PATTERN = /^[\p{Ll}\p{Lo}\p{Nd}][\p{Ll}\p{Lo}\p{Nd}-]{1,31}$/u
/** The database admits ASCII a-z0-9 and anything from U+00C0; Latin-1 signs in between are out. */
const TAG_LATIN1_GAP = /[\u0080-\u00BF]/

export function normalize_tag(value: string): string {
	return value.trim().replace(/^#+/, '').toLowerCase()
}
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

const CYRILLIC: Record<string, string> = {
	а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
	и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
	с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
	ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
	і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
}

const SLUG_MAX = 64

/** A folder name becomes a slug: Cyrillic transliterated, the rest folded into hyphens. */
export function slug_from_name(name: string): string {
	let raw = ''
	for (const ch of name.trim().toLowerCase()) raw += CYRILLIC[ch] ?? ch
	const folded = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
	return folded.slice(0, SLUG_MAX).replace(/-+$/g, '')
}

/** Another of this owner's public folders already uses the slug. The current one does not count. */
export function slug_taken(slug: string, workspace_id: string, published: Readonly<Record<string, string>>): boolean {
	const want = slug.trim()
	return Object.entries(published).some(([id, existing]) => id !== workspace_id && existing === want)
}

/** The next free valid address: harbor → harbor-2. */
export function free_slug(base: string, workspace_id: string, published: Readonly<Record<string, string>>): string {
	const stem = base.trim().replace(/-+$/g, '') || 'folder'
	for (let n = 2; n < 100; n++) {
		const suffix = `-${n}`
		const cut = stem.slice(0, SLUG_MAX - suffix.length).replace(/-+$/g, '')
		const next = `${cut}${suffix}`
		if (is_valid_slug(next) && !slug_taken(next, workspace_id, published)) return next
	}
	return stem
}

export function slug_field_state(
	slug: string,
	workspace_id: string,
	published: Readonly<Record<string, string>>,
): { problem: 'format' | 'taken' | null; suggestion: string | null } {
	const trimmed = slug.trim()
	if (!trimmed || !is_valid_slug(trimmed)) {
		const suggestion = free_slug(trimmed, workspace_id, published)
		return { problem: 'format', suggestion: suggestion === trimmed ? null : suggestion }
	}
	if (slug_taken(trimmed, workspace_id, published)) {
		return { problem: 'taken', suggestion: free_slug(trimmed, workspace_id, published) }
	}
	return { problem: null, suggestion: null }
}

/** Host of the public site, without the scheme. `https://pile.app` → `pile.app`. */
export function public_host(base: string): string {
	const with_scheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(base) ? base : `https://${base}`
	try {
		return new URL(with_scheme).host
	} catch {
		return base.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/')[0] ?? base
	}
}

/** The gray prefix in the address field: `pile.app/alex/`. */
export function address_prefix(base: string, username: string): string {
	return `${public_host(base)}/${username}/`
}

/** A full Free allowance explains itself; it does not publish. */
export function hub_publish_click(blocked: boolean): 'explain' | 'publish' {
	return blocked ? 'explain' : 'publish'
}

/**
 * set_workspace_private deletes the Hub row. Ask first when that row exists
 * or it already counts forks.
 */
export function unpublish_needs_confirm(on_hub: boolean, fork_count: number): boolean {
	return on_hub || fork_count > 0
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
	const trimmed = normalize_tag(value)
	if (!trimmed) return null
	if (!TAG_PATTERN.test(trimmed) || TAG_LATIN1_GAP.test(trimmed)) return 'format'
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
