import { computed, inject, provide, ref, type InjectionKey } from 'vue'
import {
	abuse_mailto,
	hub_preview_url,
	is_valid_slug,
	upload_hub_preview,
} from '@pile-commander/file-manager'
import { t } from '@/i18n'
import { open_external } from '@/services/openExternal'
import { backend_url, require_supabase } from '@/services/cloud/client'
import { app_put_blob } from '@/services/cloud/cloudFileManager'
import cloud, { type Publication } from '@/store/cloud'
import { hub_new_listing_blocked } from '@/store/helpers/publicationMapping'
import {
	address_prefix,
	hub_payload_for_switch,
	hub_publish_click,
	normalize_tag,
	preview_problem,
	publish_fields_dirty,
	share_publish,
	slug_field_state,
	slug_from_name,
	tag_problem,
	unpublish_needs_confirm,
	username_problem,
} from '@/store/explorer/sharePublishPanel'

const PUBLIC_BASE_URL: string = import.meta.env.VITE_PUBLIC_BASE_URL ?? window.location.origin

type HubPayload = { description: string; tags: string[]; allow_fork: boolean; preview_key: string | null }

/**
 * The public link and the Hub card of the folder in the panel. One instance
 * per panel, shared by the link and Hub windows: both show the same
 * publication, and a link made from the Hub window is the link window's too.
 */
export function create_publication() {
	const publication = ref<Publication | null>(null)
	const loading = ref(false)
	const saving = ref(false)
	const slug = ref('')
	const allow_fork = ref(true)
	const send_to_hub = ref(false)
	const tags = ref<string[]>([])
	const tag_input = ref('')
	const description = ref('')
	const username_draft = ref('')
	const saving_username = ref(false)
	const editing_address = ref(false)
	const hub_explain = ref(false)
	const link_copied = ref(false)
	const confirm_kind = ref<'unpublish' | 'delist' | null>(null)
	const saved_preview_key = ref<string | null>(null)
	const pending_file = ref<File | null>(null)
	const preview_removed = ref(false)
	const preview_error = ref<string | null>(null)
	const local_preview_url = ref<string | null>(null)
	const failed_preview_src = ref<string | null>(null)
	let copied_timer: ReturnType<typeof setTimeout> | null = null

	const username = computed(() => cloud.my_profile?.username ?? null)
	const is_public = computed(() => !!publication.value)
	const on_hub = computed(() => !!publication.value?.hub)
	const fork_count = computed(() => publication.value?.hub?.fork_count ?? 0)
	const hub_hidden = computed(() => !!publication.value?.hub?.hidden_at)
	const hub_used = computed(() => Object.keys(cloud.hub_listed).length)
	const hub_cap = computed(() => cloud.billing?.max_hub_listings ?? null)
	const hub_blocked = computed(() => hub_new_listing_blocked(hub_used.value, hub_cap.value, on_hub.value))
	const slug_state = computed(() => slug_field_state(slug.value, share_publish.workspace_id, cloud.published_slugs))
	const tag_issue = computed(() => tag_problem(tag_input.value, tags.value))
	const username_issue = computed(() => username_problem(username_draft.value))
	const card_dirty = computed(() => publish_fields_dirty(
		{
			slug: '',
			tags: tags.value,
			description: description.value,
			preview_changed: pending_file.value !== null || preview_removed.value,
		},
		{
			slug: '',
			tags: publication.value?.hub?.tags ?? [],
			description: publication.value?.hub?.description ?? '',
		},
	))
	const prefix = computed(() => username.value ? address_prefix(PUBLIC_BASE_URL, username.value) : '')
	const public_url = computed(() =>
		publication.value && username.value ? `${PUBLIC_BASE_URL}/${username.value}/${publication.value.slug}` : null,
	)
	const plaque = computed(() => publication.value && username.value ? `${prefix.value}${publication.value.slug}` : '')
	const preview_src = computed(() => {
		if (local_preview_url.value) return local_preview_url.value
		if (preview_removed.value || !saved_preview_key.value) return null
		return hub_preview_url(backend_url, saved_preview_key.value)
	})
	const appeal = computed(() => abuse_mailto(
		`Appeal Hub hide: ${username.value ?? ''}/${publication.value?.slug ?? ''}`,
		`Please review this listing. It is hidden from the Hub pending moderation.\n${public_url.value ?? ''}\n`,
	))

	function revoke_preview() {
		if (!local_preview_url.value) return
		URL.revokeObjectURL(local_preview_url.value)
		local_preview_url.value = null
	}

	function reset() {
		revoke_preview()
		publication.value = null
		slug.value = ''
		link_copied.value = false
		allow_fork.value = true
		send_to_hub.value = false
		tags.value = []
		tag_input.value = ''
		description.value = ''
		username_draft.value = ''
		editing_address.value = false
		hub_explain.value = false
		confirm_kind.value = null
		pending_file.value = null
		preview_removed.value = false
		preview_error.value = null
		saved_preview_key.value = null
		failed_preview_src.value = null
	}

	function apply(pub: Publication) {
		slug.value = pub.slug
		send_to_hub.value = !!pub.hub
		tags.value = [...(pub.hub?.tags ?? [])]
		description.value = pub.hub?.description ?? ''
		allow_fork.value = pub.allow_fork
		saved_preview_key.value = pub.hub?.preview_key ?? null
		editing_address.value = false
		failed_preview_src.value = null
		pending_file.value = null
		preview_removed.value = false
		revoke_preview()
	}

	/** Re-reads the publication after a write, unless the panel moved to another folder. */
	async function refresh(id: string) {
		const pub = await cloud.fetch_publication(id)
		if (share_publish.workspace_id !== id) return
		publication.value = pub
		if (pub) apply(pub)
		else reset()
	}

	async function load(id: string) {
		reset()
		if (!id) return
		loading.value = true
		cloud.clear_error()
		try {
			const [, , , pub] = await Promise.all([
				cloud.fetch_profile(),
				cloud.fetch_plan(),
				cloud.fetch_workspaces(),
				cloud.fetch_publication(id),
			])
			if (share_publish.workspace_id !== id || !share_publish.open) return
			publication.value = pub
			if (pub) apply(pub)
			else slug.value = slug_from_name(share_publish.folder_name)
		} finally {
			loading.value = false
		}
	}

	async function save_username() {
		const next = username_draft.value.trim()
		if (!next || username_issue.value || saving_username.value) return
		saving_username.value = true
		try {
			await cloud.save_username(next)
		} finally {
			saving_username.value = false
		}
	}

	async function copy_link() {
		if (!public_url.value) return
		await navigator.clipboard.writeText(public_url.value)
		link_copied.value = true
		if (copied_timer) clearTimeout(copied_timer)
		copied_timer = setTimeout(() => {
			link_copied.value = false
		}, 2000)
	}

	function open_public() {
		if (public_url.value) void open_external(public_url.value)
	}

	// ── Link ────────────────────────────────────────────────────────────

	async function save_link(next_slug: string) {
		saving.value = true
		const id = share_publish.workspace_id
		try {
			if (await cloud.set_public_link(id, next_slug, allow_fork.value)) await refresh(id)
		} finally {
			saving.value = false
		}
	}

	function create_link() {
		if (saving.value || slug_state.value.problem) return
		void save_link(slug.value.trim())
	}

	function start_address_edit() {
		slug.value = publication.value?.slug ?? slug.value
		editing_address.value = true
	}

	function cancel_address_edit() {
		slug.value = publication.value?.slug ?? slug.value
		editing_address.value = false
	}

	function save_address() {
		if (saving.value || slug_state.value.problem) return
		void save_link(slug.value.trim())
	}

	/** Before the link exists the switch is a draft; after, it saves at once. */
	async function set_fork(next: boolean) {
		const previous = allow_fork.value
		allow_fork.value = next
		if (!is_public.value) return
		saving.value = true
		const id = share_publish.workspace_id
		const ok = await cloud.set_public_link(id, publication.value?.slug ?? slug.value.trim(), next)
		saving.value = false
		if (!ok) allow_fork.value = previous
		else if (publication.value && share_publish.workspace_id === id) {
			publication.value = { ...publication.value, allow_fork: next }
		}
	}

	function close_link() {
		if (saving.value) return
		if (unpublish_needs_confirm(on_hub.value, fork_count.value)) confirm_kind.value = 'unpublish'
		else void unpublish()
	}

	async function unpublish() {
		if (saving.value) return
		saving.value = true
		confirm_kind.value = null
		const id = share_publish.workspace_id
		try {
			if (await cloud.unpublish(id) && share_publish.workspace_id === id) reset()
		} finally {
			saving.value = false
		}
	}

	// ── Hub card ────────────────────────────────────────────────────────

	function choose_preview(file: File) {
		const problem = preview_problem(file)
		if (problem) {
			preview_error.value = t(problem === 'too_big' ? 'publish.preview_too_big' : 'publish.preview_type')
			return
		}
		preview_error.value = null
		preview_removed.value = false
		revoke_preview()
		pending_file.value = file
		local_preview_url.value = URL.createObjectURL(file)
	}

	function clear_preview() {
		revoke_preview()
		pending_file.value = null
		preview_removed.value = true
		preview_error.value = null
	}

	function add_tag() {
		const tag = normalize_tag(tag_input.value)
		if (tag_issue.value || !tag) return
		tags.value = [...tags.value, tag]
		tag_input.value = ''
	}

	function remove_tag(tag: string) {
		tags.value = tags.value.filter(item => item !== tag)
	}

	/** Link and card with the drafts: the slug in the field until a link exists, then the saved one. */
	async function publish_card(): Promise<boolean> {
		const next_slug = publication.value ? publication.value.slug : slug.value.trim()
		if (!is_valid_slug(next_slug) || saving.value) return false
		saving.value = true
		const id = share_publish.workspace_id
		try {
			let preview_key = preview_removed.value ? null : saved_preview_key.value
			if (!preview_removed.value && pending_file.value) {
				preview_key = await upload_hub_preview(
					require_supabase(),
					backend_url,
					id,
					pending_file.value,
					pending_file.value.name,
					app_put_blob,
				)
			}
			const hub: HubPayload = {
				description: description.value.trim(),
				tags: [...tags.value],
				allow_fork: allow_fork.value,
				preview_key,
			}
			const ok = await cloud.publish(id, next_slug, allow_fork.value, hub)
			if (ok && share_publish.workspace_id === id) await refresh(id)
			return ok
		} catch (error) {
			cloud.last_error = error instanceof Error ? error.message : String(error)
			return false
		} finally {
			saving.value = false
		}
	}

	async function publish_on_hub() {
		if (saving.value) return
		if (hub_publish_click(hub_blocked.value) === 'explain') {
			hub_explain.value = true
			return
		}
		if (!is_public.value && slug_state.value.problem) return
		await publish_card()
	}

	async function save_card() {
		if (saving.value || !on_hub.value) return
		await publish_card()
	}

	function ask_delist() {
		if (!saving.value && on_hub.value) confirm_kind.value = 'delist'
	}

	/** The card goes; the link and its settings stay. */
	async function delist() {
		const current = publication.value
		confirm_kind.value = null
		if (!current || saving.value) return
		saving.value = true
		const id = share_publish.workspace_id
		try {
			const hub = hub_payload_for_switch(current.hub, false, allow_fork.value)
			if (await cloud.publish(id, current.slug, allow_fork.value, hub)) await refresh(id)
		} finally {
			saving.value = false
		}
	}

	function confirm() {
		if (confirm_kind.value === 'delist') void delist()
		else void unpublish()
	}

	return {
		publication,
		loading,
		saving,
		slug,
		allow_fork,
		tags,
		tag_input,
		description,
		username_draft,
		saving_username,
		editing_address,
		hub_explain,
		link_copied,
		confirm_kind,
		preview_error,
		failed_preview_src,
		username,
		is_public,
		on_hub,
		hub_hidden,
		hub_used,
		hub_cap,
		slug_state,
		tag_issue,
		username_issue,
		card_dirty,
		prefix,
		plaque,
		preview_src,
		appeal,
		load,
		reset,
		save_username,
		copy_link,
		open_public,
		create_link,
		start_address_edit,
		cancel_address_edit,
		save_address,
		set_fork,
		close_link,
		choose_preview,
		clear_preview,
		add_tag,
		remove_tag,
		publish_on_hub,
		save_card,
		ask_delist,
		confirm,
	}
}

export type PublicationState = ReturnType<typeof create_publication>

const PUBLICATION: InjectionKey<PublicationState> = Symbol('publication')

export function provide_publication(state: PublicationState) {
	provide(PUBLICATION, state)
}

export function use_publication(): PublicationState {
	const state = inject(PUBLICATION)
	if (!state) throw new Error('use_publication outside SharePublishPanel')
	return state
}
