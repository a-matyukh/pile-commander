<script setup lang="ts">
import { t } from '@/i18n'
import { TREE_FILTERS } from '@/store/explorer/tree_view'
import Button from '@/ui/kit/Button.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import Switch from '@/ui/kit/Switch.vue'
import SlugField from './SlugField.vue'
import UsernameStep from './UsernameStep.vue'
import { use_publication } from './usePublication'

/**
 * "Make public folder". Before: what a link does, the address and one
 * button. After: the link to copy or open, the fork setting, and a quiet
 * way to close it.
 */
const pub = use_publication()
</script>

<template>
	<UsernameStep v-if="!pub.username.value" />
	<p v-else-if="pub.loading.value" class="muted">{{ t('share.loading') }}</p>

	<template v-else-if="!pub.is_public.value">
		<p class="muted">{{ t('publish.link_lead') }}</p>
		<SlugField />
		<label class="opt">
			<Switch :model-value="pub.allow_fork.value" @update:model-value="pub.set_fork" />
			<span>
				<span class="opt-t">{{ t('publish.allow_forks') }}</span>
				<span class="opt-h">{{ t('publish.forks_hint') }}</span>
			</span>
		</label>
		<Button
			class="cta"
			block
			:icon="TREE_FILTERS.public_link.icon"
			:loading="pub.saving.value"
			:disabled="!!pub.slug_state.value.problem"
			@click="pub.create_link"
		>{{ t('publish.create_link') }}</Button>
	</template>

	<template v-else>
		<template v-if="pub.editing_address.value">
			<SlugField />
			<div class="pair">
				<Button @click="pub.cancel_address_edit">{{ t('dialog.cancel') }}</Button>
				<Button
					:loading="pub.saving.value"
					:disabled="!!pub.slug_state.value.problem || pub.slug.value.trim() === pub.publication.value?.slug"
					@click="pub.save_address"
				>{{ t('publish.save') }}</Button>
			</div>
		</template>
		<template v-else>
			<div class="plaque">
				<span class="url">{{ pub.plaque.value }}</span>
				<IconButton icon="tabler:pencil" :icon_size="15" :aria-label="t('publish.change_address')" :data-tip="t('publish.change_address')" @click="pub.start_address_edit" />
			</div>
			<div class="pair">
				<Button :icon="pub.link_copied.value ? 'tabler:check' : 'tabler:copy'" @click="pub.copy_link">
					{{ pub.link_copied.value ? t('publish.copied') : t('publish.copy_link') }}
				</Button>
				<Button icon="tabler:external-link" @click="pub.open_public">{{ t('publish.open_link') }}</Button>
			</div>
		</template>
		<label class="opt">
			<Switch :model-value="pub.allow_fork.value" :disabled="pub.saving.value" @update:model-value="pub.set_fork" />
			<span>
				<span class="opt-t">{{ t('publish.allow_forks') }}</span>
				<span class="opt-h">{{ t('publish.forks_hint') }}</span>
			</span>
		</label>
		<button type="button" class="quiet" @click="pub.close_link">{{ t('publish.close_link') }}</button>
	</template>
</template>

<style scoped>
.muted {
	margin: 0;
	color: var(--text-secondary);
}
.opt {
	display: flex;
	align-items: flex-start;
	gap: 10px;
	cursor: pointer;
}
.opt > :first-child {
	margin-top: 1px;
}
.opt-t {
	display: block;
}
.opt-h {
	display: block;
	margin-top: 1px;
	color: var(--text-muted);
	font-size: 12px;
}
.cta {
	margin-top: 4px;
}
.plaque {
	display: flex;
	align-items: center;
	gap: 6px;
	min-height: 34px;
	padding: 0 4px 0 10px;
	border-radius: 8px;
	background: var(--surface-1);
	font-family: var(--font-mono);
	font-size: 12px;
}
.url {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.pair {
	display: flex;
	gap: 6px;
}
.pair > :first-child {
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
