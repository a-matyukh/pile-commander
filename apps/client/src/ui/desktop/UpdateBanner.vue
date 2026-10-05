<script setup lang="ts">
import { computed } from 'vue'
import updater, {
	check_for_updates,
	install_update,
	dismiss_update,
} from '@/store/updater'
import desktops from '@/store/desktops'

const visible = computed(() => {
	if (updater.dismissed && updater.status !== 'downloading') return false
	return updater.status === 'available'
		|| updater.status === 'downloading'
		|| updater.status === 'error'
})

const above_taskbar = computed(() => {
	if (desktops.mode !== 'desktops') return false
	return !desktops.selected_desktop?.windows.some(w => w.state === 'fullscreen')
})

const progress_label = computed(() => {
	if (updater.content_length <= 0) return 'Downloading update…'
	const pct = Math.min(100, Math.round((updater.downloaded / updater.content_length) * 100))
	return `Downloading update… ${pct}%`
})

const title = computed(() => {
	if (updater.status === 'downloading') return progress_label.value
	if (updater.status === 'error') return updater.error || 'Could not install the update'
	return updater.version
		? `Pile Commander ${updater.version} is available`
		: 'A new version is available'
})

function on_later() {
	dismiss_update()
}

function on_install() {
	void install_update()
}

async function on_retry() {
	if (updater.status === 'error' && !updater.version) {
		await check_for_updates({ manual: true })
		return
	}
	void install_update()
}
</script>

<template>
	<div
		v-if="visible"
		class="update-banner"
		:class="{ 'update-banner--above-taskbar': above_taskbar }"
		role="status"
	>
		<UIcon
			:name="updater.status === 'error' ? 'i-lucide:alert-circle' : 'i-lucide:download'"
			class="size-4 shrink-0"
		/>
		<span class="update-banner__label">{{ title }}</span>
		<button
			v-if="updater.status === 'available'"
			type="button"
			class="update-banner__action"
			@click="on_install"
		>
			Install
		</button>
		<button
			v-else-if="updater.status === 'error'"
			type="button"
			class="update-banner__action"
			@click="on_retry"
		>
			Retry
		</button>
		<button
			v-if="updater.status !== 'downloading'"
			type="button"
			class="update-banner__later"
			@click="on_later"
		>
			Later
		</button>
	</div>
</template>

<style scoped>
.update-banner {
	position: fixed;
	bottom: 0.75rem;
	left: 50%;
	z-index: 200;
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
	max-width: calc(100% - 1.5rem);
	min-height: 36px;
	padding: 0.375rem 0.5rem 0.375rem 0.75rem;
	border: 1px solid var(--pc-gray-border, rgba(0, 0, 0, 0.1));
	border-radius: 0.5rem;
	background: var(--pc-gray-header, #fefefe);
	color: var(--pc-gray-text, #111827);
	font-size: 13px;
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
	transform: translateX(-50%);
	user-select: none;
	-webkit-user-select: none;
}

.update-banner--above-taskbar {
	bottom: 3.75rem;
}

.update-banner__label {
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.update-banner__action,
.update-banner__later {
	flex-shrink: 0;
	padding: 0.125rem 0.5rem;
	border-radius: 0.25rem;
	font: inherit;
	cursor: pointer;
}

.update-banner__action {
	border: 1px solid rgba(0, 0, 0, 0.12);
	background: var(--pc-gray-muted, #eee);
	color: inherit;
}

.update-banner__action:hover {
	background: var(--pc-gray-border, #ddd);
}

.update-banner__later {
	border: 0;
	background: transparent;
	color: inherit;
	opacity: 0.7;
}

.update-banner__later:hover {
	opacity: 1;
}
</style>
