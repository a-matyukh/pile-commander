<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import {
	ABUSE_EMAIL,
	HUB_PREVIEW_ACCEPT,
	abuse_mailto,
	hub_preview_url,
	is_valid_slug,
	upload_hub_preview,
	type WorkspaceInvite,
	type WorkspaceMember,
	type WorkspaceRole,
} from '@pile-commander/file-manager'
import { t } from '@/i18n'
import { backend_url, require_supabase } from '@/services/cloud/client'
import { app_put_blob } from '@/services/cloud/cloudFileManager'
import cloud, { type Publication } from '@/store/cloud'
import { hub_new_listing_blocked } from '@/store/helpers/publicationMapping'
import { export_anchor } from '@/store/explorer/exportPile'
import {
	MAX_DESCRIPTION,
	MAX_TAGS,
	close_share_publish,
	hub_payload_for_switch,
	preview_problem,
	publish_face,
	publish_fields_dirty,
	save_button_visible,
	share_empty_line,
	share_publish,
	slug_field_state,
	slug_from_name,
	tag_problem,
	text_edit_effect,
	unpublish_needs_confirm,
	username_problem,
	visitor_address,
	waiting_invites,
} from '@/store/explorer/sharePublishPanel'
import Button from '@/ui/kit/Button.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import Modal from '@/ui/kit/Modal.vue'
import Select from '@/ui/kit/Select.vue'
import Switch from '@/ui/kit/Switch.vue'
import TextField from '@/ui/kit/TextField.vue'
import Textarea from '@/ui/kit/Textarea.vue'
import PanelFrame from './PanelFrame.vue'
import { use_anchored_panel } from './useAnchoredPanel'

const PUBLIC_BASE_URL: string = import.meta.env.VITE_PUBLIC_BASE_URL ?? window.location.origin

const { style } = use_anchored_panel(
	() => export_anchor.value,
	() => [share_publish.open, share_publish.window, share_publish.workspace_id, export_anchor.value],
)

const title = computed(() => {
	if (share_publish.window === 'people') return t('share.share_with')
	if (share_publish.window === 'link') return t('share.make_public_folder')
	return t('share.publish_hub')
})
const roles = computed(() => [
	{ value: 'editor' as const, label: t('share.role_editor') },
	{ value: 'viewer' as const, label: t('share.role_viewer') },
])

const members = ref<WorkspaceMember[]>([])
const invites = ref<WorkspaceInvite[]>([])
const loading_people = ref(false)
const email = ref('')
const role = ref<WorkspaceRole>('editor')
const adding = ref(false)
const resending = ref<string | null>(null)
const notice = ref<string | null>(null)

const publication = ref<Publication | null>(null)
const loading_pub = ref(false)
const saving = ref(false)
const slug = ref('')
const link_copied = ref(false)
const allow_fork = ref(true)
const send_to_hub = ref(false)
const tags = ref<string[]>([])
const tag_input = ref('')
const description = ref('')
const username_draft = ref('')
const saving_username = ref(false)
const confirm_kind = ref<'unpublish' | 'delist' | null>(null)
const confirm_open = computed({
	get: () => confirm_kind.value !== null,
	set: (value: boolean) => {
		if (!value) confirm_kind.value = null
	},
})
const file_input = ref<HTMLInputElement | null>(null)
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
const waiting = computed(() => waiting_invites(members.value, invites.value))
const only_you = computed(() => share_empty_line(members.value.length))
const trimmed_slug = computed(() => slug.value.trim())
const slug_state = computed(() => slug_field_state(slug.value, share_publish.workspace_id, cloud.published_slugs))
const live_address = computed(() => visitor_address(username.value, slug.value))
const tag_issue = computed(() => tag_problem(tag_input.value, tags.value))
const username_issue = computed(() => username_problem(username_draft.value))
const preview_changed = computed(() => pending_file.value !== null || preview_removed.value)
const dirty = computed(() => is_public.value && publish_fields_dirty(
	{ slug: slug.value, tags: tags.value, description: description.value, preview_changed: preview_changed.value },
	{
		slug: publication.value?.slug ?? '',
		tags: publication.value?.hub?.tags ?? [],
		description: publication.value?.hub?.description ?? '',
	},
))
const face = computed(() => publish_face({
	has_username: !!username.value,
	is_public: is_public.value,
	on_hub: on_hub.value,
	hidden: hub_hidden.value,
	fork_count: fork_count.value,
	dirty: dirty.value,
}))
const show_save = computed(() => save_button_visible(is_public.value, dirty.value))
const public_url = computed(() =>
	publication.value && username.value
		? `${PUBLIC_BASE_URL}/${username.value}/${publication.value.slug}`
		: null,
)
const preview_src = computed(() => {
	if (local_preview_url.value) return local_preview_url.value
	if (preview_removed.value || !saved_preview_key.value) return null
	return hub_preview_url(backend_url, saved_preview_key.value)
})
const hub_hint = computed(() => {
	const cap = hub_cap.value
	const used = hub_used.value
	if (hub_blocked.value && cap != null) return t('publish.hub_blocked', { cap, used })
	if (cap == null) return t('publish.hub_open')
	return t('publish.hub_quota', { used, cap })
})
const appeal = computed(() => abuse_mailto(
	`Appeal Hub hide: ${username.value ?? ''}/${publication.value?.slug ?? ''}`,
	`Please review this listing. It is hidden from the Hub pending moderation.\n${public_url.value ?? ''}\n`,
))

watch(hub_blocked, (blocked) => {
	if (blocked) send_to_hub.value = false
})

watch(
	() => share_publish.open ? share_publish.workspace_id : '',
	(id) => {
		notice.value = null
		confirm_kind.value = null
		if (!id) {
			revoke_preview()
			return
		}
		reset_publish_fields()
		void load(id)
	},
)

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
	if (!share_publish.open || event.key !== 'Escape') return
	if (document.querySelector('.mn[data-state="open"]')) return
	if (document.querySelector('.dlg[data-state="open"]')) return
	close_share_publish()
})

function reset_publish_fields() {
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
	pending_file.value = null
	preview_removed.value = false
	preview_error.value = null
	saved_preview_key.value = null
	failed_preview_src.value = null
}

function apply_publication(pub: Publication) {
	slug.value = pub.slug
	send_to_hub.value = !!pub.hub
	tags.value = [...(pub.hub?.tags ?? [])]
	description.value = pub.hub?.description ?? ''
	allow_fork.value = pub.allow_fork
	saved_preview_key.value = pub.hub?.preview_key ?? null
	failed_preview_src.value = null
	pending_file.value = null
	preview_removed.value = false
	revoke_preview()
}

async function load(id: string) {
	loading_people.value = true
	loading_pub.value = true
	cloud.clear_error()
	try {
		const [next_members, next_invites, , , , pub] = await Promise.all([
			cloud.list_members(id),
			cloud.list_invites(id),
			cloud.fetch_profile(),
			cloud.fetch_plan(),
			cloud.fetch_workspaces(),
			cloud.fetch_publication(id),
		])
		if (share_publish.workspace_id !== id || !share_publish.open) return
		members.value = next_members
		invites.value = next_invites
		publication.value = pub
		if (pub) apply_publication(pub)
		else if (!slug.value) slug.value = slug_from_name(share_publish.folder_name)
		if (hub_blocked.value) send_to_hub.value = false
	} finally {
		loading_people.value = false
		loading_pub.value = false
	}
}

async function reload_people() {
	const id = share_publish.workspace_id
	const [next_members, next_invites] = await Promise.all([
		cloud.list_members(id),
		cloud.list_invites(id),
	])
	if (share_publish.workspace_id !== id) return
	members.value = next_members
	invites.value = next_invites
}

async function add_member() {
	const next = email.value.trim()
	if (!next || adding.value) return
	adding.value = true
	notice.value = null
	try {
		const result = await cloud.add_member(share_publish.workspace_id, next, role.value)
		if (result === 'pending' || result === 'member') {
			email.value = ''
			notice.value = result === 'pending' ? t('share.invite_sent') : t('share.added')
			await reload_people()
			await cloud.fetch_workspaces()
		}
	} finally {
		adding.value = false
	}
}

async function change_role(member: WorkspaceMember, next: WorkspaceRole) {
	if (!next || member.role === next) return
	if (await cloud.update_member_role(share_publish.workspace_id, member.user_id, next)) await reload_people()
}

async function remove_member(member: WorkspaceMember) {
	if (await cloud.remove_member(share_publish.workspace_id, member.user_id)) {
		await reload_people()
		await cloud.fetch_workspaces()
	}
}

async function change_invite_role(invite: WorkspaceInvite, next: WorkspaceRole) {
	if (!next || invite.role === next) return
	if (await cloud.update_invite_role(share_publish.workspace_id, invite.email, next)) await reload_people()
}

async function resend(invite: WorkspaceInvite) {
	if (resending.value) return
	resending.value = invite.email
	notice.value = null
	try {
		const result = await cloud.add_member(share_publish.workspace_id, invite.email, invite.role)
		if (result === 'pending' || result === 'member') {
			notice.value = result === 'pending' ? t('share.invite_sent') : t('share.added')
			await reload_people()
			await cloud.fetch_workspaces()
		}
	} finally {
		resending.value = null
	}
}

async function revoke(invite: WorkspaceInvite) {
	if (await cloud.revoke_invite(share_publish.workspace_id, invite.email)) {
		await reload_people()
		await cloud.fetch_workspaces()
	}
}

function letter(value: string): string {
	return (value.trim()[0] ?? '?').toUpperCase()
}

function tint(value: string): string {
	const hues = ['#d1fae5', '#ede9fe', '#dbeafe', '#ffedd5']
	return hues[(value.trim().charCodeAt(0) || 0) % hues.length] ?? hues[0]!
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

function revoke_preview() {
	if (!local_preview_url.value) return
	URL.revokeObjectURL(local_preview_url.value)
	local_preview_url.value = null
}

function on_preview_file(event: Event) {
	const input = event.target as HTMLInputElement
	const file = input.files?.[0]
	input.value = ''
	if (!file) return
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
	void text_edit_effect()
}

function clear_preview() {
	revoke_preview()
	pending_file.value = null
	preview_removed.value = true
	preview_error.value = null
}

function add_tag() {
	if (tag_issue.value || !tag_input.value.trim()) return
	tags.value = [...tags.value, tag_input.value.trim()]
	tag_input.value = ''
	void text_edit_effect()
}

function remove_tag(tag: string) {
	tags.value = tags.value.filter(item => item !== tag)
	void text_edit_effect()
}

async function publish_drafts(): Promise<boolean> {
	if (!is_valid_slug(trimmed_slug.value) || saving.value) return false
	saving.value = true
	const id = share_publish.workspace_id
	try {
		let hub: { description: string; tags: string[]; allow_fork: boolean; preview_key: string | null } | null = null
		if (send_to_hub.value && !hub_blocked.value) {
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
			hub = {
				description: description.value.trim(),
				tags: [...tags.value],
				allow_fork: allow_fork.value,
				preview_key,
			}
		}
		const ok = await cloud.publish(id, trimmed_slug.value, allow_fork.value, hub)
		if (!ok || share_publish.workspace_id !== id) return ok
		const pub = await cloud.fetch_publication(id)
		publication.value = pub
		if (pub) apply_publication(pub)
		else reset_publish_fields()
		if (hub_blocked.value) send_to_hub.value = false
		return true
	} catch (error) {
		cloud.last_error = error instanceof Error ? error.message : String(error)
		return false
	} finally {
		saving.value = false
	}
}

async function persist_switches(): Promise<boolean> {
	const current = publication.value
	if (!current || saving.value) return false
	saving.value = true
	const id = share_publish.workspace_id
	try {
		const hub = hub_payload_for_switch(
			current.hub,
			send_to_hub.value && !hub_blocked.value,
			allow_fork.value,
		)
		const ok = await cloud.publish(id, current.slug, allow_fork.value, hub)
		if (!ok || share_publish.workspace_id !== id) return ok
		const pub = await cloud.fetch_publication(id)
		if (pub) {
			publication.value = pub
			saved_preview_key.value = pub.hub?.preview_key ?? null
			allow_fork.value = pub.allow_fork
			send_to_hub.value = !!pub.hub
		}
		return ok
	} finally {
		saving.value = false
	}
}

function on_public(next: boolean) {
	if (saving.value) return
	if (next) {
		if (slug_state.value.problem) return
		void save_public_link(slug.value.trim())
		return
	}
	if (unpublish_needs_confirm(on_hub.value, fork_count.value)) {
		confirm_kind.value = 'unpublish'
		return
	}
	void do_unpublish()
}

async function save_public_link(next_slug: string) {
	saving.value = true
	const id = share_publish.workspace_id
	try {
		const ok = await cloud.set_public_link(id, next_slug, allow_fork.value)
		if (!ok || share_publish.workspace_id !== id) return
		const pub = await cloud.fetch_publication(id)
		publication.value = pub
		if (pub) apply_publication(pub)
	} finally {
		saving.value = false
	}
}

async function on_fork(next: boolean) {
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

async function set_hub(next: boolean) {
	if (saving.value || (next && hub_blocked.value)) return
	if (!next) {
		if (!on_hub.value) {
			send_to_hub.value = false
			return
		}
		confirm_kind.value = 'delist'
		return
	}
	if (!is_public.value && slug_state.value.problem) return
	const previous = send_to_hub.value
	send_to_hub.value = true
	if (!(await publish_drafts())) send_to_hub.value = previous
}

async function do_delist() {
	confirm_kind.value = null
	const previous = send_to_hub.value
	send_to_hub.value = false
	if (!(await persist_switches())) send_to_hub.value = previous
}

async function do_unpublish() {
	if (saving.value) return
	saving.value = true
	confirm_kind.value = null
	const id = share_publish.workspace_id
	try {
		if (await cloud.unpublish(id) && share_publish.workspace_id === id) {
			publication.value = null
			reset_publish_fields()
		}
	} finally {
		saving.value = false
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

function published_when(value: string | null): string {
	return value ? new Date(value).toLocaleString() : ''
}
</script>

<template>
	<PanelFrame
		v-if="share_publish.open"
		kind="share"
		:title="title"
		:style="style"
		@close="close_share_publish"
	>
		<div class="body">
			<p v-if="share_publish.folder_name" class="folder">{{ share_publish.folder_name }}</p>
			<p v-if="cloud.last_error" class="err">{{ cloud.last_error }}</p>

			<template v-if="share_publish.window === 'people'">
				<p v-if="notice" class="ok">{{ notice }}</p>
				<p v-if="loading_people">{{ t('share.loading') }}</p>
				<template v-else>
					<form class="invite" @submit.prevent="add_member">
						<TextField v-model="email" type="email" class="grow" :placeholder="t('share.email_placeholder')" />
						<Select v-model="role" :options="roles" :width="148" />
						<Button type="submit" variant="primary" :loading="adding" :disabled="!email.trim()">{{ t('share.invite') }}</Button>
					</form>
					<p class="label">{{ t('share.tab_people') }}</p>
					<p v-if="only_you" class="muted">{{ only_you }}</p>
					<ul v-else class="rows">
						<li v-for="member in members" :key="member.user_id">
							<span class="av" :style="{ background: tint(member.email) }">{{ letter(member.email) }}</span>
							<span class="who">{{ member.email }}</span>
							<Select
								:model-value="member.role"
								:options="roles"
								:width="148"
								@update:model-value="change_role(member, $event)"
							/>
							<IconButton icon="tabler:x" :icon_size="16" :aria-label="t('share.remove_member')" @click="remove_member(member)" />
						</li>
					</ul>
					<template v-if="waiting.length">
						<p class="label">{{ t('share.invited') }}</p>
						<ul class="rows">
							<li v-for="invite in waiting" :key="invite.email">
								<span class="who">{{ invite.email }}</span>
								<Select
									:model-value="invite.role"
									:options="roles"
									:width="148"
									@update:model-value="change_invite_role(invite, $event)"
								/>
								<Button variant="link" :disabled="resending === invite.email" @click="resend(invite)">{{ t('share.resend') }}</Button>
								<IconButton icon="tabler:x" :icon_size="16" :aria-label="t('share.revoke')" @click="revoke(invite)" />
							</li>
						</ul>
					</template>
				</template>
			</template>

			<template v-else-if="share_publish.window === 'link'">
				<div v-if="face.show_username" class="stack">
					<p class="muted">{{ t('publish.need_username') }}</p>
					<TextField
						v-model="username_draft"
						:placeholder="t('publish.username_placeholder')"
						autocapitalize="none"
						:spellcheck="false"
						:invalid="!!username_issue"
					/>
					<p v-if="username_issue === 'format'" class="err">{{ t('publish.username_format') }}</p>
					<p v-else-if="username_issue === 'reserved'" class="err">{{ t('publish.username_reserved') }}</p>
					<Button
						variant="primary"
						:loading="saving_username"
						:disabled="!username_draft.trim() || !!username_issue"
						@click="save_username"
					>{{ t('publish.username_save') }}</Button>
				</div>
				<p v-else-if="loading_pub">{{ t('share.loading') }}</p>
				<div v-else class="stack">
					<div v-if="face.show_link && public_url" class="linkrow">
						<p class="url">{{ public_url }}</p>
						<p v-if="publication" class="muted">{{ t('publish.since', { when: published_when(publication.published_at) }) }}</p>
						<Button @click="copy_link">{{ link_copied ? t('publish.copied') : t('publish.copy_link') }}</Button>
					</div>
					<div class="slug">
						<span class="at">/{{ username }}/</span>
						<TextField
							v-model="slug"
							class="grow"
							:placeholder="t('publish.slug_placeholder')"
							autocapitalize="none"
							:spellcheck="false"
							:invalid="!!slug_state.problem"
						/>
					</div>
					<p class="url">{{ live_address }}</p>
					<p v-if="slug_state.problem === 'taken'" class="err">{{ t('publish.slug_taken') }}</p>
					<p v-else-if="slug_state.problem === 'format'" class="err">{{ t('publish.slug_invalid') }}</p>
					<button v-if="slug_state.suggestion" type="button" class="suggest" @click="slug = slug_state.suggestion">
						{{ t('publish.slug_free', { slug: slug_state.suggestion }) }}
					</button>
					<label class="swrow">
						<Switch :model-value="is_public" :disabled="saving" @update:model-value="on_public" />
						<span>{{ t('publish.public_link') }}</span>
					</label>
					<label class="swrow">
						<Switch :model-value="allow_fork" :disabled="saving" @update:model-value="on_fork" />
						<span>{{ t('publish.allow_forks') }}</span>
					</label>
					<p class="muted">{{ t('publish.forks_hint') }}</p>
					<Button
						v-if="is_public && publication && slug.trim() !== publication.slug && !slug_state.problem"
						variant="primary"
						:loading="saving"
						@click="save_public_link(slug.trim())"
					>{{ t('publish.save') }}</Button>
				</div>
			</template>

			<template v-else>
				<div v-if="face.show_username" class="stack">
					<p class="muted">{{ t('publish.need_username') }}</p>
					<TextField
						v-model="username_draft"
						:placeholder="t('publish.username_placeholder')"
						autocapitalize="none"
						:spellcheck="false"
						:invalid="!!username_issue"
					/>
					<p v-if="username_issue === 'format'" class="err">{{ t('publish.username_format') }}</p>
					<p v-else-if="username_issue === 'reserved'" class="err">{{ t('publish.username_reserved') }}</p>
					<Button
						variant="primary"
						:loading="saving_username"
						:disabled="!username_draft.trim() || !!username_issue"
						@click="save_username"
					>{{ t('publish.username_save') }}</Button>
				</div>
				<p v-else-if="loading_pub">{{ t('share.loading') }}</p>
				<div v-else class="stack">
					<template v-if="is_public && publication">
						<p class="url">{{ visitor_address(username, publication.slug) }}</p>
					</template>
					<template v-else>
						<p class="muted">{{ t('publish.hub_needs_link') }}</p>
						<div class="slug">
							<span class="at">/{{ username }}/</span>
							<TextField
								v-model="slug"
								class="grow"
								:placeholder="t('publish.slug_placeholder')"
								autocapitalize="none"
								:spellcheck="false"
								:invalid="!!slug_state.problem"
							/>
						</div>
						<p class="url">{{ live_address }}</p>
						<p v-if="slug_state.problem === 'taken'" class="err">{{ t('publish.slug_taken') }}</p>
						<p v-else-if="slug_state.problem === 'format'" class="err">{{ t('publish.slug_invalid') }}</p>
						<button v-if="slug_state.suggestion" type="button" class="suggest" @click="slug = slug_state.suggestion">
							{{ t('publish.slug_free', { slug: slug_state.suggestion }) }}
						</button>
					</template>
					<label class="swrow">
						<Switch :model-value="send_to_hub || on_hub" :disabled="saving || (hub_blocked && !on_hub)" @update:model-value="set_hub" />
						<span>{{ t('publish.list_hub') }}</span>
					</label>
					<p class="muted">{{ hub_hint }}</p>
					<p v-if="face.show_hidden" class="muted">
						{{ t('publish.hidden') }}
						<a :href="appeal">{{ t('publish.appeal', { email: ABUSE_EMAIL }) }}</a>
					</p>
					<div v-if="tags.length" class="tags">
						<button
							v-for="tag in tags"
							:key="tag"
							type="button"
							class="tag"
							:aria-label="t('publish.remove_tag', { tag })"
							@click="remove_tag(tag)"
						>#{{ tag }}</button>
					</div>
					<TextField
						v-model="tag_input"
						:placeholder="t('publish.tag_placeholder')"
						autocapitalize="none"
						:spellcheck="false"
						:disabled="tags.length >= MAX_TAGS"
						:invalid="!!tag_issue"
						@keydown.enter.prevent="add_tag"
					/>
					<p v-if="tag_issue === 'format'" class="err">{{ t('publish.tag_format') }}</p>
					<p v-else-if="tag_issue === 'dup'" class="err">{{ t('publish.tag_dup') }}</p>
					<p v-else-if="tag_issue === 'limit'" class="err">{{ t('publish.tag_limit', { n: MAX_TAGS }) }}</p>
					<Textarea v-model="description" :maxlength="MAX_DESCRIPTION" :placeholder="t('publish.description_placeholder')" />
					<p class="count">{{ description.length }}/{{ MAX_DESCRIPTION }}</p>
					<p class="muted">{{ t('publish.preview_hint') }}</p>
					<div v-if="preview_src" class="shot">
						<img
							v-if="preview_src !== failed_preview_src"
							:src="preview_src"
							alt=""
							:title="t('publish.replace_preview')"
							@click="file_input?.click()"
							@error="failed_preview_src = preview_src"
						>
						<button v-else type="button" class="miss" @click="file_input?.click()">{{ t('publish.preview_unavailable') }}</button>
						<IconButton class="x" icon="tabler:x" :icon_size="16" :aria-label="t('publish.remove_preview')" @click="clear_preview" />
					</div>
					<Button v-else icon="tabler:photo" @click="file_input?.click()">{{ t('publish.add_preview') }}</Button>
					<input ref="file_input" type="file" class="file" :accept="HUB_PREVIEW_ACCEPT" @change="on_preview_file">
					<p v-if="preview_error" class="err">{{ preview_error }}</p>
					<Button v-if="show_save" variant="primary" :loading="saving" :disabled="!!slug_state.problem" @click="publish_drafts">
						{{ t('publish.save') }}
					</Button>
				</div>
			</template>
		</div>
	</PanelFrame>
	<Modal
		v-model:open="confirm_open"
		:title="confirm_kind === 'delist' ? t('publish.delist_title') : t('publish.unpublish_title')"
		:description="confirm_kind === 'delist' ? t('publish.delist_body') : t('publish.unpublish_body')"
	>
		<template #footer>
			<Button @click="confirm_kind = null">{{ t('dialog.cancel') }}</Button>
			<Button variant="danger" :loading="saving" @click="confirm_kind === 'delist' ? do_delist() : do_unpublish()">
				{{ confirm_kind === 'delist' ? t('publish.delist_confirm') : t('publish.unpublish_confirm') }}
			</Button>
		</template>
	</Modal>
</template>

<style scoped>
.body {
	display: flex;
	flex-direction: column;
	gap: 10px;
	max-height: min(70vh, 560px);
	margin-top: 8px;
	overflow: auto;
	font-size: 13px;
	line-height: 1.4;
}
.stack {
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.invite {
	display: flex;
	align-items: center;
	gap: 6px;
}
.grow {
	flex: 1;
	min-width: 0;
}
.label {
	margin: 4px 0 0;
	font-size: 11px;
	font-weight: 600;
	letter-spacing: .04em;
	text-transform: uppercase;
	color: var(--text-muted);
}
.folder {
	margin: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--text-muted);
}
.suggest {
	padding: 0;
	border: 0;
	background: none;
	color: var(--text-accent, inherit);
	font: inherit;
	text-align: left;
	cursor: pointer;
	text-decoration: underline;
	text-underline-offset: 2px;
}
.ok {
	margin: 0;
	color: var(--text-success, #067647);
}
.err {
	margin: 0;
	color: var(--text-danger);
}
.rows {
	display: flex;
	flex-direction: column;
	gap: 6px;
	max-height: 220px;
	margin: 0;
	padding: 0;
	overflow: auto;
	list-style: none;
}
.rows li {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
}
.av {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 22px;
	height: 22px;
	flex: none;
	border-radius: 50%;
	font-size: 11px;
	font-weight: 600;
}
.who {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.slug {
	display: flex;
	align-items: center;
	gap: 6px;
}
.at {
	flex: none;
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	color: var(--text-muted);
}
.linkrow {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 4px;
}
.url {
	margin: 0;
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	word-break: break-all;
}
.swrow {
	display: flex;
	align-items: center;
	gap: 8px;
}
.tags {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
}
.tag {
	padding: 2px 6px;
	border: 0;
	border-radius: 6px;
	background: var(--bg-accent, #e8f1ff);
	color: var(--text-primary);
	font: inherit;
	font-size: 12px;
	cursor: pointer;
}
.count {
	margin: 0;
	text-align: right;
	color: var(--text-muted);
	font-size: 12px;
}
.shot {
	position: relative;
}
.shot img,
.miss {
	display: block;
	width: 100%;
	aspect-ratio: 16 / 9;
	object-fit: cover;
	border-radius: 8px;
	cursor: pointer;
}
.miss {
	border: 0.5px solid var(--border);
	background: var(--surface-2);
	color: var(--text-muted);
}
.x {
	position: absolute;
	top: 6px;
	right: 6px;
}
.file {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip: rect(0 0 0 0);
}
a {
	color: var(--text-accent, inherit);
}
</style>
