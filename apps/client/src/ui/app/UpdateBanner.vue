<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { t } from '@/i18n'
import updater, {
	check_for_updates,
	install_update,
	dismiss_update,
} from '@/store/updater'
import { explorer_window_classes } from '@/ui/explorer/window_classes'
import Button from '@/ui/kit/Button.vue'

const visible = computed(() => {
	if (updater.dismissed && updater.status !== 'downloading') return false
	return updater.status === 'available'
		|| updater.status === 'downloading'
		|| updater.status === 'error'
})

const progress_label = computed(() => {
	if (updater.content_length <= 0) return t('updates.downloading')
	const pct = Math.min(100, Math.round((updater.downloaded / updater.content_length) * 100))
	return t('updates.downloading_pct', { pct })
})

const title = computed(() => {
	if (updater.status === 'downloading') return progress_label.value
	if (updater.status === 'error') return updater.error || t('updates.install_failed')
	return updater.version
		? t('updates.available', { version: updater.version })
		: t('updates.available_plain')
})

const icon = computed(() => {
	if (updater.status === 'error') return 'tabler:alert-circle'
	if (updater.status === 'downloading') return 'tabler:loader-2'
	return 'tabler:download'
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
		class="explorer banner"
		:class="explorer_window_classes"
		role="status"
	>
		<Icon
			:icon="icon"
			class="ic"
			:class="{ spin: updater.status === 'downloading', bad: updater.status === 'error' }"
		/>
		<span class="label">{{ title }}</span>
		<Button v-if="updater.status === 'available'" @click="on_install">
			{{ t('updates.install') }}
		</Button>
		<Button v-else-if="updater.status === 'error'" @click="on_retry">
			{{ t('updates.retry') }}
		</Button>
		<Button v-if="updater.status !== 'downloading'" variant="link" @click="on_later">
			{{ t('updates.later') }}
		</Button>
	</div>
</template>

<style scoped>
.banner {
	position: fixed;
	bottom: 12px;
	left: 50%;
	z-index: 200;
	display: inline-flex;
	align-items: center;
	gap: 8px;
	max-width: calc(100% - 24px);
	padding: 6px 10px 6px 12px;
	border: 0.5px solid var(--border-strong);
	border-radius: 10px;
	box-shadow: 0 8px 24px rgba(0, 0, 0, .1), 0 2px 6px rgba(0, 0, 0, .06);
	transform: translateX(-50%);
	user-select: none;
	-webkit-user-select: none;
	box-sizing: border-box;
}

.ic {
	font-size: 16px;
	color: var(--text-secondary);
}

.bad {
	color: var(--text-danger);
}

.label {
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.spin {
	animation: spin 1s linear infinite;
}

@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}

.explorer.lg .ic {
	font-size: 20px;
}
</style>
