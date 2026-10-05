<script setup lang="ts">
import { computed } from 'vue'
import { navigate_public, open_public_window } from '@/services/navigatePublic'
import cloud from '@/store/cloud'
import desktops from '@/store/desktops'
import { useWindowContext } from '@/ui/window/windowContext'
import type { HubTab } from './hubCatalog'
import { hub_open, hub_tab } from './hubUi'

const props = withDefaults(
	defineProps<{
		username: string
		display_name: string | null
		publication_count: number
		/** `card` — clickable Hub listing; `page` — profile header */
		variant?: 'card' | 'page'
	}>(),
	{ variant: 'card' },
)

const window_ctx = useWindowContext()
const title = computed(() => props.display_name || props.username)
const publications_label = computed(() =>
	props.publication_count === 1 ? 'publication' : 'publications',
)

function open_hub(tab: HubTab = 'workspaces') {
	hub_tab.value = tab
	hub_open.value = true
	if (window_ctx) {
		desktops.set_window_content(window_ctx.window_id, { kind: 'hub' })
		if (window_ctx.state.value === 'fullscreen' && window.location.pathname !== '/hub') {
			history.pushState(null, '', '/hub')
		}
		return
	}
	// fullscreen: leaving the profile page for the in-place Hub
	cloud.profile_view = null
	cloud.profile_not_found = null
	navigate_public('/hub')
}

function open() {
	if (props.variant !== 'card' || !props.username) return
	hub_open.value = false
	if (desktops.mode === 'desktops') {
		open_public_window(
			{ kind: 'profile', username: props.username },
			`/${props.username}`,
		)
		return
	}
	navigate_public(`/${props.username}`)
}
</script>

<template>
	<header v-if="variant === 'page'" class="flex flex-col gap-1">
		<nav class="flex items-center gap-1 text-sm text-muted">
			<button type="button" class="hover:text-default" @click="open_hub()">Hub</button>
			<UIcon name="i-lucide:chevron-right" class="size-3.5 opacity-60" />
			<button type="button" class="hover:text-default" @click="open_hub('authors')">Authors</button>
		</nav>
		<h1 class="text-xl font-semibold text-default">{{ title }}</h1>
		<p class="text-sm text-muted">
			<span class="font-mono">@{{ username }}</span>
			· {{ publication_count }}
			{{ publications_label }}
		</p>
	</header>
	<button
		v-else
		type="button"
		class="flex w-full flex-col gap-1 rounded-lg border border-default p-4 text-left transition-colors hover:border-primary hover:bg-elevated/50"
		@click="open"
	>
		<p class="truncate font-medium text-default">{{ title }}</p>
		<p class="text-sm text-muted">
			<span class="font-mono">@{{ username }}</span>
			· {{ publication_count }}
			{{ publications_label }}
		</p>
	</button>
</template>
