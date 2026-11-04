<script setup lang="ts">
import { ABUSE_EMAIL } from '@pile-commander/file-manager'
import { t } from '@/i18n'
import { TREE_FILTERS } from '@/store/explorer/tree_view'
import Button from '@/ui/kit/Button.vue'
import HubCardEditor from './HubCardEditor.vue'
import SlugField from './SlugField.vue'
import UsernameStep from './UsernameStep.vue'
import { use_publication } from './usePublication'

/**
 * "Publish on Hub". Before: the card as it will look, the address when the
 * folder has no link yet, and one button. After: the card, ways to open it,
 * Save while it has edits, and a quiet way to take it down.
 */
const pub = use_publication()
</script>

<template>
	<UsernameStep v-if="!pub.username.value" />
	<p v-else-if="pub.loading.value" class="muted">{{ t('share.loading') }}</p>

	<template v-else>
		<p v-if="pub.hub_hidden.value" class="warn">
			{{ t('publish.hidden') }}
			<a :href="pub.appeal.value">{{ t('publish.appeal', { email: ABUSE_EMAIL }) }}</a>
		</p>
		<p v-if="!pub.on_hub.value" class="muted">{{ t('publish.hub_lead') }}</p>

		<HubCardEditor />

		<template v-if="!pub.on_hub.value">
			<SlugField v-if="!pub.is_public.value" :hint="t('publish.link_with_card')" />
			<div v-else class="plaque">{{ pub.plaque.value }}</div>
			<Button
				class="cta"
				block
				:icon="TREE_FILTERS.in_hub.icon"
				:loading="pub.saving.value"
				:disabled="!pub.is_public.value && !!pub.slug_state.value.problem"
				@click="pub.publish_on_hub"
			>{{ t('share.publish_hub') }}</Button>
			<p v-if="pub.hub_explain.value && pub.hub_cap.value != null" class="err center">
				{{ t('publish.hub_blocked', { used: pub.hub_used.value, cap: pub.hub_cap.value }) }}
			</p>
			<p v-else-if="pub.hub_cap.value != null" class="quota">
				{{ t('publish.free_cards', { used: pub.hub_used.value, cap: pub.hub_cap.value }) }}
			</p>
		</template>

		<template v-else>
			<Button
				v-if="pub.card_dirty.value"
				block
				:loading="pub.saving.value"
				@click="pub.save_card"
			>{{ t('publish.save') }}</Button>
			<div class="pair">
				<Button icon="tabler:external-link" @click="pub.open_public">{{ t('publish.open_hub') }}</Button>
				<Button :icon="pub.link_copied.value ? 'tabler:check' : 'tabler:copy'" @click="pub.copy_link">
					{{ pub.link_copied.value ? t('publish.copied') : t('publish.copy_link') }}
				</Button>
			</div>
			<button type="button" class="quiet" @click="pub.ask_delist">{{ t('publish.delist_link') }}</button>
		</template>
	</template>
</template>

<style scoped>
.muted {
	margin: 0;
	color: var(--text-secondary);
}
.warn {
	margin: 0;
	padding: 8px 10px;
	border-radius: 8px;
	background: var(--bg-warning, #faeeda);
	color: var(--text-warning, #854f0b);
}
.warn a {
	color: inherit;
}
.plaque {
	padding: 8px 10px;
	border-radius: 8px;
	background: var(--surface-1);
	font-family: var(--font-mono);
	font-size: 12px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.cta {
	margin-top: 4px;
}
.quota {
	margin: -2px 0 0;
	text-align: center;
	color: var(--text-muted);
	font-size: 12px;
}
.err {
	margin: 0;
	color: var(--text-danger);
	font-size: 12px;
}
.center {
	text-align: center;
}
.pair {
	display: flex;
	gap: 6px;
}
.pair > * {
	flex: 1;
}
.quiet {
	align-self: center;
	margin-top: 2px;
	padding: 2px 4px;
	border: 0;
	background: none;
	color: var(--text-danger);
	font: inherit;
	font-size: 12px;
	cursor: pointer;
}
.quiet:hover {
	text-decoration: underline;
	text-underline-offset: 2px;
}
</style>
