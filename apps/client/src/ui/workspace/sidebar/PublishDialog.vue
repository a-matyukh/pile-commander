<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
	ABUSE_EMAIL,
	HUB_PREVIEW_ACCEPT,
	abuse_mailto,
	hub_preview_file_error,
	hub_preview_url,
	is_valid_slug,
	upload_hub_preview,
} from '@pile-commander/file-manager'
import { backend_url, require_supabase } from '@/services/cloud/client'
import { app_put_blob } from '@/services/cloud/cloudFileManager'
import cloud, { type Publication } from '@/store/cloud'
import { hub_new_listing_blocked } from '@/store/helpers/publicationMapping'
import ProfileDialog from './ProfileDialog.vue'

/** Public front host; the published page itself is a separate iteration */
const PUBLIC_BASE_URL: string = import.meta.env.VITE_PUBLIC_BASE_URL ?? window.location.origin

/** DB: set_hub_listing validates each tag against this pattern */
const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/
const MAX_TAGS = 5
const MAX_DESCRIPTION = 280

const is_open = ref(false)
const is_loading = ref(false)
const is_saving = ref(false)
const is_unpublishing = ref(false)
const workspace_id = ref('')
const publication = ref<Publication | null>(null)
const slug = ref('')
const link_copied = ref(false)
const send_to_hub = ref(false)
const tags = ref<string[]>([])
const tag_input = ref('')
const description = ref('')
const allow_fork = ref(true)
const profile_dialog = ref<InstanceType<typeof ProfileDialog> | null>(null)
const file_input = ref<HTMLInputElement | null>(null)
const saved_preview_key = ref<string | null>(null)
const pending_file = ref<File | null>(null)
const preview_removed = ref(false)
const preview_error = ref<string | null>(null)
const local_preview_url = ref<string | null>(null)

const username = computed(() => cloud.my_profile?.username ?? null)
const is_public = computed(() => !!publication.value)
const already_on_hub = computed(() => !!publication.value?.hub)
const hub_is_hidden = computed(() => !!publication.value?.hub?.hidden_at)
const hub_used = computed(() => Object.keys(cloud.hub_listed).length)
const hub_cap = computed(() => cloud.billing?.max_hub_listings ?? null)
const hub_blocked = computed(() =>
	hub_new_listing_blocked(hub_used.value, hub_cap.value, already_on_hub.value),
)

const hub_listing_hint = computed(() => {
	const cap = hub_cap.value
	const used = hub_used.value
	if (hub_blocked.value && cap != null) {
		return `Free can list ${cap} workspaces on the Hub. You already have ${used}. Delist another workspace to add this one. A public link does not use a Hub slot.`
	}
	if (cap == null) return 'The Hub gallery is public. The workspace must stay public.'
	return `The Hub gallery is public. Free: ${used} of ${cap} listings.`
})

const appeal_mailto = computed(() =>
	abuse_mailto(
		`Appeal Hub hide: ${username.value}/${publication.value?.slug ?? ''}`,
		`Please review this listing. It is hidden from the Hub pending moderation.\n${public_url.value ?? ''}\n`,
	),
)

watch(hub_blocked, blocked => {
	if (blocked) send_to_hub.value = false
})

const trimmed_slug = computed(() => slug.value.trim())
const slug_error = computed(() => {
	if (!trimmed_slug.value) return null
	return is_valid_slug(trimmed_slug.value)
		? null
		: '3-48 chars: lowercase letters, digits, hyphens'
})

const public_url = computed(() =>
	publication.value && username.value
		? `${PUBLIC_BASE_URL}/${username.value}/${publication.value.slug}`
		: null,
)

const tag_input_error = computed(() => {
	const value = tag_input.value.trim()
	if (!value) return null
	if (!TAG_PATTERN.test(value)) return 'lowercase letters, digits, hyphens'
	if (tags.value.includes(value)) return 'already added'
	if (tags.value.length >= MAX_TAGS) return `up to ${MAX_TAGS} tags`
	return null
})

const preview_src = computed(() => {
	if (local_preview_url.value) return local_preview_url.value
	if (preview_removed.value || !saved_preview_key.value) return null
	return hub_preview_url(backend_url, saved_preview_key.value)
})

// The saved cover comes through /hub-preview, which may refuse (egress fair
// use) or 404; a placeholder the owner can click to replace stands in.
// Cleared on open and after a save, so a one-off failure gets another try
const failed_preview_src = ref<string | null>(null)

function add_tag() {
	const value = tag_input.value.trim()
	if (!value || tag_input_error.value) return
	tags.value.push(value)
	tag_input.value = ''
}

function remove_tag(tag: string) {
	tags.value = tags.value.filter(t => t !== tag)
}

function revoke_local_preview() {
	if (local_preview_url.value) {
		URL.revokeObjectURL(local_preview_url.value)
		local_preview_url.value = null
	}
}

function reset_preview() {
	revoke_local_preview()
	pending_file.value = null
	preview_removed.value = false
	preview_error.value = null
	saved_preview_key.value = null
	failed_preview_src.value = null
}

function on_preview_file(event: Event) {
	const input = event.target as HTMLInputElement
	const file = input.files?.[0]
	input.value = ''
	if (!file) return
	const error = hub_preview_file_error(file)
	if (error) {
		preview_error.value = error
		return
	}
	preview_error.value = null
	preview_removed.value = false
	revoke_local_preview()
	pending_file.value = file
	local_preview_url.value = URL.createObjectURL(file)
}

function clear_preview() {
	revoke_local_preview()
	pending_file.value = null
	preview_removed.value = true
	preview_error.value = null
}

async function reload() {
	is_loading.value = true
	publication.value = await cloud.fetch_publication(workspace_id.value)
	is_loading.value = false
}

function apply_publication(pub: Publication) {
	slug.value = pub.slug
	send_to_hub.value = !!pub.hub
	tags.value = pub.hub?.tags ?? []
	description.value = pub.hub?.description ?? ''
	allow_fork.value = pub.allow_fork
	saved_preview_key.value = pub.hub?.preview_key ?? null
	failed_preview_src.value = null
}

function open(id: string) {
	workspace_id.value = id
	cloud.clear_error()
	publication.value = null
	link_copied.value = false
	slug.value = ''
	send_to_hub.value = false
	tags.value = []
	tag_input.value = ''
	description.value = ''
	allow_fork.value = true
	reset_preview()
	is_open.value = true
	void (async () => {
		is_loading.value = true
		try {
			const [, , , pub] = await Promise.all([
				cloud.fetch_profile(),
				cloud.fetch_plan(),
				cloud.fetch_workspaces(),
				cloud.fetch_publication(workspace_id.value),
			])
			publication.value = pub
			if (publication.value) apply_publication(publication.value)
			if (hub_blocked.value) send_to_hub.value = false
		} finally {
			is_loading.value = false
		}
	})()
}

async function save() {
	if (!is_valid_slug(trimmed_slug.value) || is_saving.value) return
	is_saving.value = true
	try {
		let hub: {
			description: string
			tags: string[]
			allow_fork: boolean
			preview_key: string | null
		} | null = null
		if (send_to_hub.value && !hub_blocked.value) {
			let preview_key = preview_removed.value ? null : saved_preview_key.value
			if (!preview_removed.value && pending_file.value) {
				preview_key = await upload_hub_preview(
					require_supabase(),
					backend_url,
					workspace_id.value,
					pending_file.value,
					pending_file.value.name,
					app_put_blob,
				)
			}
			hub = {
				description: description.value.trim(),
				tags: tags.value,
				allow_fork: allow_fork.value,
				preview_key,
			}
		}
		const ok = await cloud.publish(workspace_id.value, trimmed_slug.value, allow_fork.value, hub)
		if (ok) {
			revoke_local_preview()
			pending_file.value = null
			preview_removed.value = false
		}
		await reload()
		if (publication.value) apply_publication(publication.value)
		if (hub_blocked.value) send_to_hub.value = false
	} catch (error) {
		cloud.last_error = error instanceof Error ? error.message : String(error)
	} finally {
		is_saving.value = false
	}
}

async function unpublish() {
	if (is_unpublishing.value) return
	is_unpublishing.value = true
	try {
		if (await cloud.unpublish(workspace_id.value)) {
			await reload()
			slug.value = ''
			send_to_hub.value = false
			tags.value = []
			description.value = ''
			allow_fork.value = true
			reset_preview()
		}
	} finally {
		is_unpublishing.value = false
	}
}

async function copy_link() {
	if (!public_url.value) return
	await navigator.clipboard.writeText(public_url.value)
	link_copied.value = true
	setTimeout(() => {
		link_copied.value = false
	}, 2000)
}

function format_date(value: string | null): string {
	return value ? new Date(value).toLocaleString() : ''
}

const emit = defineEmits<{
	closed: []
}>()

function on_closed() {
	revoke_local_preview()
	pending_file.value = null
	emit('closed')
}

defineExpose({ open })
</script>

<template>
	<UModal v-model:open="is_open" title="Publish" @after:leave="on_closed">
		<template #body>
			<p v-if="cloud.last_error" class="mb-3 text-sm text-error">{{ cloud.last_error }}</p>

			<div v-if="!username" class="flex flex-col items-start gap-2">
				<p class="text-sm text-muted">
					The public URL is <span class="font-mono">/&lt;username&gt;/&lt;slug&gt;</span>,
					so a username is required first.
				</p>
				<UButton
					label="Set a username first"
					icon="i-lucide:at-sign"
					color="neutral"
					variant="outline"
					@click="profile_dialog?.open()"
				/>
			</div>

			<template v-else>
				<p v-if="is_loading" class="text-sm text-muted">Loading…</p>
				<template v-else>
					<div v-if="publication" class="mb-4 flex items-center gap-2">
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm">{{ public_url }}</p>
							<p class="text-xs text-muted">
								Public since {{ format_date(publication.published_at) }} — anyone with the
								link can view the live workspace
							</p>
						</div>
						<UButton
							:icon="link_copied ? 'i-lucide-check' : 'i-lucide-copy'"
							color="neutral"
							variant="outline"
							size="xs"
							:label="link_copied ? 'Copied' : 'Copy link'"
							@click="copy_link"
						/>
					</div>
					<p v-else class="mb-4 text-sm text-muted">
						Make this workspace public to share a live link. Anyone on the internet can
						view it; you and editors keep writing.
					</p>
					<form class="flex flex-col gap-3" @submit.prevent="save">
						<div class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
							<div class="min-w-0 w-full flex-1">
								<div class="flex min-w-0 items-center gap-1.5">
									<span class="shrink-0 text-sm text-muted">/{{ username }}/</span>
									<UInput
										v-model="slug"
										placeholder="my-workspace"
										class="min-w-0 flex-1"
										autocomplete="off"
										autocapitalize="none"
										spellcheck="false"
									/>
								</div>
								<p v-if="slug_error" class="mt-1 text-xs text-error">{{ slug_error }}</p>
							</div>
							<UButton
								type="submit"
								class="w-full shrink-0 sm:w-auto"
								:label="is_public ? 'Save' : 'Make public'"
								:loading="is_saving"
								:disabled="!is_valid_slug(trimmed_slug)"
							/>
						</div>

						<UCheckbox
							v-model="allow_fork"
							label="Allow forks and downloads as .pile"
							hint="Visitors can copy this workspace into their own account or download it as a .pile"
						/>

						<div class="flex flex-col gap-1">
							<UCheckbox
								v-model="send_to_hub"
								label="List on Hub"
								:disabled="hub_blocked"
							/>
							<p class="text-xs text-muted">{{ hub_listing_hint }}</p>
							<p v-if="hub_is_hidden" class="text-xs text-muted">
								Hidden from the Hub until review. The public link still works.
								This listing still uses a Hub slot.
								<a :href="appeal_mailto" class="text-primary underline">Write to {{ ABUSE_EMAIL }}</a>
								to appeal.
							</p>
						</div>

						<template v-if="send_to_hub">
							<div>
								<div v-if="tags.length" class="mb-1 flex flex-wrap gap-1">
									<UBadge
										v-for="tag in tags"
										:key="tag"
										color="neutral"
										variant="subtle"
										class="cursor-pointer"
										:title="`Remove ${tag}`"
										@click="remove_tag(tag)"
									>
										{{ tag }}
										<UIcon name="i-lucide:x" class="ml-0.5 size-3" />
									</UBadge>
								</div>
								<UInput
									v-model="tag_input"
									placeholder="Add a tag, press Enter"
									class="w-full"
									:disabled="tags.length >= MAX_TAGS"
									@keydown.enter.prevent="add_tag"
								/>
								<p v-if="tag_input_error" class="mt-1 text-xs text-error">{{ tag_input_error }}</p>
							</div>
							<div>
								<UTextarea
									v-model="description"
									placeholder="Description (optional)"
									class="w-full"
									:rows="2"
									:maxlength="MAX_DESCRIPTION"
								/>
								<p class="mt-1 text-right text-xs text-muted">
									{{ description.length }}/{{ MAX_DESCRIPTION }}
								</p>
							</div>
							<div>
								<p class="mb-1 text-xs text-muted">JPEG, PNG or WebP, up to 2 MB</p>
								<div
									v-if="preview_src"
									class="relative overflow-hidden rounded-md border border-default"
								>
									<img
										v-if="preview_src !== failed_preview_src"
										:src="preview_src"
										alt=""
										class="aspect-video w-full cursor-pointer object-cover"
										title="Replace preview"
										@click="file_input?.click()"
										@error="failed_preview_src = preview_src"
									>
									<button
										v-else
										type="button"
										class="flex aspect-video w-full items-center justify-center text-sm text-muted"
										title="Replace preview"
										@click="file_input?.click()"
									>
										Preview unavailable
									</button>
									<UButton
										type="button"
										icon="i-lucide:x"
										color="neutral"
										variant="solid"
										size="xs"
										class="absolute right-2 top-2"
										title="Remove preview"
										@click.stop="clear_preview"
									/>
								</div>
								<UButton
									v-else
									type="button"
									label="Add preview"
									icon="i-lucide:image"
									color="neutral"
									variant="outline"
									@click="file_input?.click()"
								/>
								<input
									ref="file_input"
									type="file"
									class="sr-only"
									:accept="HUB_PREVIEW_ACCEPT"
									@change="on_preview_file"
								>
								<p v-if="preview_error" class="mt-1 text-xs text-error">{{ preview_error }}</p>
							</div>
						</template>

						<UButton
							v-if="is_public"
							type="button"
							label="Make private"
							color="neutral"
							variant="outline"
							:loading="is_unpublishing"
							@click="unpublish"
						/>
					</form>
				</template>
			</template>
		</template>
	</UModal>
	<ProfileDialog ref="profile_dialog" />
</template>
