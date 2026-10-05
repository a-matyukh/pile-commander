<script setup lang="ts">
import { getCurrentInstance, ref, watch } from 'vue'
import { navigate_public, open_public_window } from '@/services/navigatePublic'
import desktops from '@/store/desktops'
import { hub_open } from './hubUi'
import HubReportButton from './HubReportButton.vue'

const props = defineProps<{
	workspace_id: string
	name: string
	slug: string
	username: string
	display_name: string | null
	description?: string
	tags?: string[]
	date: string | null
	/** forks total; 0/undefined hides the counter */
	forks?: number
	preview_url?: string | null
}>()

const emit = defineEmits<{
	tag: [tag: string]
}>()

const tag_clicks = !!getCurrentInstance()?.vnode.props?.onTag

// A refused cover (egress fair use) or a missing object falls back to the
// card without an image instead of a broken-image icon
const preview_failed = ref(false)
watch(() => props.preview_url, () => {
	preview_failed.value = false
})

function on_tag(event: MouseEvent, tag: string) {
	if (!tag_clicks) return
	event.stopPropagation()
	emit('tag', tag)
}

function open() {
	hub_open.value = false
	if (desktops.mode === 'desktops') {
		open_public_window({
			kind: 'slug',
			username: props.username,
			slug: props.slug,
			name: props.name,
		}, `/${props.username}/${props.slug}`)
		return
	}
	navigate_public(`/${props.username}/${props.slug}`)
}

function format_date(value: string | null): string {
	return value ? new Date(value).toLocaleDateString() : ''
}
</script>

<template>
	<div
		class="flex w-full cursor-pointer flex-col overflow-hidden rounded-lg border border-default text-left transition-colors hover:border-primary hover:bg-elevated/50"
		role="link"
		tabindex="0"
		@click="open"
		@keydown.enter.prevent="open"
		@keydown.space.prevent="open"
	>
		<img
			v-if="preview_url && !preview_failed"
			:src="preview_url"
			alt=""
			class="aspect-video w-full object-cover"
			@error="preview_failed = true"
		>
		<div class="flex flex-col gap-2 p-4">
			<div class="flex w-full items-baseline justify-between gap-2">
				<p class="truncate font-medium text-default">{{ name }}</p>
				<span class="shrink-0 text-xs text-muted">{{ format_date(date) }}</span>
			</div>
			<p v-if="description" class="line-clamp-2 text-sm text-muted">{{ description }}</p>
			<div v-if="tags?.length" class="flex flex-wrap gap-1">
				<UBadge
					v-for="tag in tags"
					:key="tag"
					:label="tag"
					color="neutral"
					variant="subtle"
					size="sm"
					:class="tag_clicks && 'cursor-pointer'"
					@click="on_tag($event, tag)"
				/>
			</div>
			<div class="flex w-full items-center justify-between gap-2">
				<p class="min-w-0 truncate text-xs text-muted">
					{{ display_name || username }}
					<span class="font-mono">@{{ username }}</span>
				</p>
				<div class="flex shrink-0 items-center gap-0.5">
					<span v-if="forks" class="flex items-center gap-1 text-xs text-muted">
						<UIcon name="i-lucide:git-fork" class="size-3" />
						{{ forks }}
					</span>
					<HubReportButton
						variant="menu"
						:workspace_id="workspace_id"
						:username="username"
						:slug="slug"
						:name="name"
					/>
				</div>
			</div>
		</div>
	</div>
</template>
