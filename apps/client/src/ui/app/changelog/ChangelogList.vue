<script setup lang="ts">
import { computed } from 'vue'
import { locale, t } from '@/i18n'
import { group_by_version, type ChangelogEntry } from '@/services/changelog'
import ChangelogItem from './ChangelogItem.vue'

/**
 * Entries grouped under their version, newest first. The same list shows in
 * Settings → Updates and in the "What's new" window.
 */
const props = defineProps<{ entries: ChangelogEntry[]; current?: string }>()

const groups = computed(() => group_by_version(props.entries))

function format_date(date: string | null): string {
	if (!date) return ''
	const parsed = new Date(`${date}T00:00:00`)
	if (Number.isNaN(parsed.getTime())) return date
	return new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'long', year: 'numeric' }).format(parsed)
}
</script>

<template>
	<div class="list">
		<section v-for="g in groups" :key="g.version" class="group">
			<div class="head">
				<span class="ver">{{ t('whats_new.version', { version: g.version }) }}</span>
				<span v-if="current === g.version" class="mine">{{ t('whats_new.current') }}</span>
				<span v-if="g.date" class="date">{{ format_date(g.date) }}</span>
			</div>
			<ChangelogItem v-for="(e, i) in g.entries" :key="i" :entry="e" />
		</section>
	</div>
</template>

<style scoped>
.list {
	display: flex;
	flex-direction: column;
	gap: 22px;
}
.group {
	display: flex;
	flex-direction: column;
	gap: 14px;
}
.head {
	display: flex;
	align-items: baseline;
	gap: 8px;
	font-size: 11px;
	color: var(--text-muted);
}
.ver {
	color: var(--text-secondary);
	font-weight: 500;
}
.mine {
	padding: 0 6px;
	border-radius: 999px;
	border: 0.5px solid var(--border-strong);
}
.date {
	margin-left: auto;
}
.explorer.lg .head {
	font-size: 12px;
}
</style>
