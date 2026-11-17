<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { t } from '@/i18n'
import updater, { check_for_updates, install_update, load_current_version } from '@/store/updater'
import { app_version } from '@/store/changelog'
import Button from '@/ui/kit/Button.vue'

/** Settings → Updates: the installed version, its state and the check */
const checked = ref(false)

const checking = computed(() => updater.status === 'checking')
const busy = computed(() => updater.status === 'checking' || updater.status === 'downloading')
const version = computed(() => updater.current_version ?? app_version)

onMounted(() => {
	void load_current_version()
})

type Line = { icon: string; text: string; tone: 'muted' | 'ok' | 'accent' | 'bad'; spin?: boolean }

/** One line under the version: what the last check found */
const status = computed<Line | null>(() => {
	switch (updater.status) {
		case 'checking':
			return { icon: 'tabler:loader-2', text: t('updates.checking'), tone: 'muted', spin: true }
		case 'available':
			return updater.version
				? { icon: 'tabler:sparkles', text: t('updates.new_version', { version: updater.version }), tone: 'accent' }
				: { icon: 'tabler:sparkles', text: t('updates.available_plain'), tone: 'accent' }
		case 'downloading':
			return { icon: 'tabler:download', text: t('updates.downloading'), tone: 'accent' }
		case 'error':
			return { icon: 'tabler:alert-triangle', text: updater.error ?? t('updates.failed'), tone: 'bad' }
		default:
			return checked.value ? { icon: 'tabler:circle-check', text: t('updates.up_to_date'), tone: 'ok' } : null
	}
})

async function on_check() {
	if (busy.value) return
	await check_for_updates({ manual: true })
	checked.value = updater.status === 'idle'
}

function on_install() {
	void install_update()
}
</script>

<template>
	<div class="ver-card">
		<img class="app-icon" src="/app-icon.png" alt="" aria-hidden="true">
		<div class="info">
			<span class="name">Pile Commander</span>
			<span class="line">
				<span class="chip">v{{ version }}</span>
				<span v-if="status" class="state" :class="status.tone">
					<Icon :icon="status.icon" :class="{ spin: status.spin }" />
					<span>{{ status.text }}</span>
				</span>
			</span>
		</div>
		<Button v-if="updater.status === 'available'" variant="primary" icon="tabler:download" @click="on_install">
			{{ t('updates.install') }}
		</Button>
		<Button v-else icon="tabler:refresh" :loading="checking" :disabled="busy" @click="on_check">
			{{ t('updates.check') }}
		</Button>
	</div>
</template>

<style scoped>
.ver-card {
	display: flex;
	align-items: center;
	gap: 14px;
	min-width: 0;
}
.app-icon {
	flex: none;
	width: 48px;
	height: 48px;
	border-radius: 12px;
	box-shadow: 0 0 0 0.5px var(--border-strong), 0 4px 12px rgba(20, 30, 60, .1);
	background: var(--surface-2);
	object-fit: cover;
}
.info {
	flex: 1 1 auto;
	display: flex;
	flex-direction: column;
	gap: 4px;
	min-width: 0;
}
.name {
	font-size: 14px;
	font-weight: 600;
	color: var(--text-primary);
}
.line {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 8px;
	min-width: 0;
	font-size: 12px;
}
.chip {
	padding: 1px 7px;
	border-radius: 999px;
	background: var(--surface-0);
	color: var(--text-secondary);
	font-variant-numeric: tabular-nums;
}
.state {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	min-width: 0;
}
.state span {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.muted { color: var(--text-muted); }
.ok { color: var(--text-success); }
.accent { color: var(--text-accent); }
.bad { color: var(--text-danger); }
.spin {
	animation: spin 1s linear infinite;
}
@keyframes spin {
	to { transform: rotate(360deg); }
}
.explorer.lg .name { font-size: 16px; }
.explorer.lg .line { font-size: 14px; }
.explorer.lg .app-icon { width: 56px; height: 56px; border-radius: 14px; }

@media (max-width: 480px) {
	.ver-card { flex-wrap: wrap; }
	.ver-card > :deep(.btn) { width: 100%; }
}
</style>
