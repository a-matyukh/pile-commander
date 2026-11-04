<script setup lang="ts">
import { t } from '@/i18n'
import { use_publication } from './usePublication'

/**
 * The public address as one field: the host and username stay gray and
 * fixed, only the last part is typed. A taken or invalid address says so
 * before anything is sent, with a free one to take.
 */
defineProps<{ hint?: string }>()

const pub = use_publication()
</script>

<template>
	<div class="slug">
		<label class="addr" :class="{ bad: pub.slug_state.value.problem }">
			<span class="pre">{{ pub.prefix.value }}</span>
			<input
				v-model="pub.slug.value"
				:aria-label="t('publish.address_label')"
				autocapitalize="none"
				:spellcheck="false"
				@keydown.stop
			>
		</label>
		<p v-if="pub.slug_state.value.problem === 'taken'" class="err">{{ t('publish.slug_taken') }}</p>
		<p v-else-if="pub.slug_state.value.problem === 'format'" class="err">{{ t('publish.slug_invalid') }}</p>
		<button
			v-if="pub.slug_state.value.suggestion"
			type="button"
			class="suggest"
			@click="pub.slug.value = pub.slug_state.value.suggestion!"
		>{{ t('publish.slug_free', { slug: pub.slug_state.value.suggestion }) }}</button>
		<p v-else-if="hint && !pub.slug_state.value.problem" class="hint">{{ hint }}</p>
	</div>
</template>

<style scoped>
.slug {
	display: flex;
	flex-direction: column;
	gap: 4px;
}
.addr {
	display: flex;
	align-items: center;
	min-width: 0;
	height: 34px;
	padding: 0 10px;
	border: 0.5px solid var(--border-strong);
	border-radius: 8px;
	background: var(--surface-2);
	box-sizing: border-box;
	font-family: var(--font-mono);
	font-size: 12px;
	cursor: text;
}
.addr:focus-within {
	border-color: var(--border-accent, var(--border-stronger));
}
.addr.bad {
	border-color: var(--text-danger);
}
.pre {
	flex: none;
	max-width: calc(100% - 7em);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--text-muted);
}
.addr input {
	flex: 1;
	min-width: 4em;
	padding: 0;
	border: 0;
	background: transparent;
	color: var(--text-primary);
	font: inherit;
	outline: none;
	user-select: text;
	-webkit-user-select: text;
}
.err {
	margin: 0;
	color: var(--text-danger);
	font-size: 12px;
}
.hint {
	margin: 0;
	color: var(--text-muted);
	font-size: 12px;
}
.suggest {
	align-self: flex-start;
	padding: 0;
	border: 0;
	background: none;
	color: var(--text-accent, inherit);
	font: inherit;
	font-size: 12px;
	cursor: pointer;
	text-decoration: underline;
	text-underline-offset: 2px;
}
</style>
