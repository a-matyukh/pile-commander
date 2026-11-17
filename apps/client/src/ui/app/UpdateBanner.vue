<script setup lang="ts">
import { computed, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { usePreferredReducedMotion } from '@vueuse/core'
import { locale, t } from '@/i18n'
import updater, {
	check_for_updates,
	install_update,
	dismiss_update,
} from '@/store/updater'
import { app_version, changelog, load_changelog, open_whats_new } from '@/store/changelog'
import { entries_between } from '@/services/changelog'
import { explorer_settings, motion_3d_enabled } from '@/store/explorer/settings'
import { explorer_window_classes } from '@/ui/explorer/window_classes'
import Button from '@/ui/kit/Button.vue'

const visible = computed(() => {
	if (updater.dismissed && updater.status !== 'downloading') return false
	return updater.status === 'available'
		|| updater.status === 'downloading'
		|| updater.status === 'error'
})

/** Which card shows: the offer, the download, or the failure */
const kind = computed(() => (updater.status === 'error' ? 'error' : updater.status === 'downloading' ? 'downloading' : 'available'))

const pct = computed(() => {
	if (updater.content_length <= 0) return null
	return Math.min(100, Math.round((updater.downloaded / updater.content_length) * 100))
})

const title = computed(() => {
	if (kind.value === 'error') return t('updates.install_failed')
	return updater.version ? `Pile Commander ${updater.version}` : t('updates.available_plain')
})

const subtitle = computed(() => {
	if (kind.value === 'error') return updater.error || t('updates.try_later')
	if (kind.value === 'downloading') return pct.value === null ? t('updates.downloading') : t('updates.downloading_pct', { pct: pct.value })
	return t('updates.ready')
})

const icon = computed(() => {
	if (kind.value === 'error') return 'tabler:alert-triangle'
	if (kind.value === 'downloading') return 'tabler:download'
	return 'tabler:sparkles'
})

/** What the available version brings, read from the changelog; nothing while it loads or offline */
const upcoming = computed(() => {
	if (!updater.version) return []
	return entries_between(changelog.entries, app_version, updater.version)
})

/** At most three titles; the rest is in "What's new" */
const headlines = computed(() => upcoming.value.slice(0, 3).map(e => e.title[locale.value]))
const more = computed(() => Math.max(0, upcoming.value.length - headlines.value.length))

watch(() => updater.status, (status) => {
	if (status === 'available') void load_changelog()
}, { immediate: true })

const reduced = usePreferredReducedMotion()
const animate = computed(() => motion_3d_enabled(explorer_settings.motion_3d, reduced.value === 'reduce'))

function on_whats_new() {
	open_whats_new(upcoming.value)
}

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
	<Transition :name="animate ? 'rise' : ''">
		<div
			v-if="visible"
			class="explorer card"
			:class="[explorer_window_classes, kind]"
			role="status"
			aria-live="polite"
		>
			<div class="head">
				<span class="tile" aria-hidden="true">
					<Icon :icon="icon" class="ic" />
				</span>
				<div class="titles">
					<span class="title">{{ title }}</span>
					<span class="sub">{{ subtitle }}</span>
				</div>
			</div>

			<div v-if="kind === 'downloading'" class="bar" :class="{ indeterminate: pct === null }">
				<span :style="pct === null ? undefined : { width: `${pct}%` }" />
			</div>

			<ul v-if="kind === 'available' && headlines.length" class="news">
				<li v-for="(h, i) in headlines" :key="i">
					<Icon icon="tabler:point-filled" class="dot" />
					<span>{{ h }}</span>
				</li>
			</ul>

			<div v-if="kind !== 'downloading'" class="foot">
				<button v-if="kind === 'available' && upcoming.length" type="button" class="more" @click="on_whats_new">
					{{ more ? t('updates.and_more', { n: more }) : t('whats_new.open') }}
					<Icon icon="tabler:arrow-right" />
				</button>
				<span class="grow" />
				<Button variant="link" @click="on_later">{{ t('updates.later') }}</Button>
				<Button v-if="kind === 'available'" variant="primary" @click="on_install">
					{{ t('updates.install') }}
				</Button>
				<Button v-else variant="primary" @click="on_retry">
					{{ t('updates.retry') }}
				</Button>
			</div>
		</div>
	</Transition>
</template>

<style scoped>
.card {
	--tile-bg: linear-gradient(135deg, #E6F1FB 0%, #EEE8FB 100%);
	--tile-fg: #3D5FC4;

	position: fixed;
	right: 16px;
	bottom: 16px;
	z-index: 200;
	display: flex;
	flex-direction: column;
	gap: 12px;
	width: 340px;
	max-width: calc(100% - 32px);
	padding: 14px 14px 12px;
	border: 0.5px solid var(--border-strong);
	border-radius: 14px;
	background: var(--surface-3);
	box-shadow:
		0 18px 40px rgba(20, 30, 60, .14),
		0 4px 10px rgba(0, 0, 0, .06);
	user-select: none;
	-webkit-user-select: none;
	box-sizing: border-box;
}

.card.error {
	--tile-bg: #FBEAEA;
	--tile-fg: var(--text-danger);
}

/* On a phone the card spans the bottom, as a sheet */
@media (max-width: 560px) {
	.card {
		left: 12px;
		right: 12px;
		bottom: 12px;
		width: auto;
		max-width: none;
	}
}

.head {
	display: flex;
	align-items: center;
	gap: 11px;
	min-width: 0;
}

.tile {
	flex: none;
	display: grid;
	place-items: center;
	width: 36px;
	height: 36px;
	border-radius: 10px;
	background: var(--tile-bg);
	color: var(--tile-fg);
	box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, .05);
}

.ic {
	font-size: 19px;
}

.titles {
	display: flex;
	flex-direction: column;
	gap: 1px;
	min-width: 0;
}

.title {
	font-size: 13px;
	font-weight: 600;
	color: var(--text-primary);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.sub {
	font-size: 12px;
	color: var(--text-secondary);
	overflow: hidden;
	text-overflow: ellipsis;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
}

.news {
	display: flex;
	flex-direction: column;
	gap: 5px;
	margin: 0;
	padding: 10px 12px;
	list-style: none;
	border-radius: 10px;
	background: var(--surface-1);
	font-size: 12px;
	line-height: 1.4;
	color: var(--text-primary);
}

.news li {
	display: flex;
	align-items: baseline;
	gap: 7px;
	min-width: 0;
}

.news li span {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.dot {
	flex: none;
	font-size: 8px;
	color: var(--tile-fg);
	transform: translateY(-1px);
}

/* "Later" keeps some air from the dark button */
.foot {
	display: flex;
	align-items: center;
	gap: 14px;
}

.grow {
	flex: 1 1 auto;
}

.more {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 0;
	border: 0;
	background: none;
	font: inherit;
	font-size: 12px;
	font-weight: 500;
	color: var(--text-accent);
	cursor: pointer;
}

.more:hover {
	text-decoration: underline;
	text-underline-offset: 2px;
}

.more :deep(svg) {
	transition: transform .15s ease;
}

.more:hover :deep(svg) {
	transform: translateX(2px);
}

.bar {
	position: relative;
	height: 4px;
	border-radius: 999px;
	background: var(--surface-0);
	overflow: hidden;
}

.bar span {
	position: absolute;
	inset: 0 auto 0 0;
	width: 0;
	border-radius: inherit;
	background: linear-gradient(90deg, #378ADD, #7A6BE0);
	transition: width .2s ease;
}

.bar.indeterminate span {
	width: 35%;
	animation: slide 1.1s ease-in-out infinite;
}

@keyframes slide {
	from { transform: translateX(-100%); }
	to { transform: translateX(300%); }
}

.rise-enter-active,
.rise-leave-active {
	transition: opacity .22s ease, transform .26s cubic-bezier(.2, .8, .2, 1);
}

.rise-enter-from,
.rise-leave-to {
	opacity: 0;
	transform: translateY(12px) scale(.98);
}

.explorer.lg.card {
	width: 400px;
}

.explorer.lg .title {
	font-size: 15px;
}

.explorer.lg .sub,
.explorer.lg .news,
.explorer.lg .more {
	font-size: 14px;
}

.explorer.lg .tile {
	width: 42px;
	height: 42px;
}

.explorer.lg .ic {
	font-size: 22px;
}
</style>
