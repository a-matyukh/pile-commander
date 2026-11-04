<script setup lang="ts">
import { ref } from 'vue'
import { Icon } from '@iconify/vue'
import { HUB_PREVIEW_ACCEPT } from '@pile-commander/file-manager'
import { t } from '@/i18n'
import { MAX_DESCRIPTION, MAX_TAGS, share_publish } from '@/store/explorer/sharePublishPanel'
import IconButton from '@/ui/kit/IconButton.vue'
import { use_publication } from './usePublication'

/** The Hub card as visitors will see it, edited in place: preview, description, tags. */
const pub = use_publication()
const file_input = ref<HTMLInputElement | null>(null)
const writing = ref(false)

function on_file(event: Event) {
	const input = event.target as HTMLInputElement
	const file = input.files?.[0]
	input.value = ''
	if (file) pub.choose_preview(file)
}

function on_tag_key(event: KeyboardEvent) {
	event.stopPropagation()
	if (event.key === 'Enter' || event.key === ',') {
		event.preventDefault()
		pub.add_tag()
	} else if (event.key === 'Backspace' && !pub.tag_input.value && pub.tags.value.length) {
		pub.remove_tag(pub.tags.value[pub.tags.value.length - 1]!)
	}
}
</script>

<template>
	<div class="card">
		<div class="cover">
			<button
				type="button"
				class="shot"
				:class="{ filled: pub.preview_src.value }"
				:aria-label="pub.preview_src.value ? t('publish.replace_preview') : t('publish.add_preview')"
				@click="file_input?.click()"
			>
				<img
					v-if="pub.preview_src.value && pub.preview_src.value !== pub.failed_preview_src.value"
					:src="pub.preview_src.value"
					alt=""
					@error="pub.failed_preview_src.value = pub.preview_src.value"
				>
				<span v-else class="empty">
					<Icon icon="tabler:photo-plus" class="ic" />
					<span>{{ pub.preview_src.value ? t('publish.preview_unavailable') : t('publish.add_preview') }}</span>
					<span class="sm">{{ t('publish.preview_hint') }}</span>
				</span>
			</button>
			<IconButton
				v-if="pub.preview_src.value"
				class="x"
				icon="tabler:x"
				:icon_size="14"
				:aria-label="t('publish.remove_preview')"
				@click="pub.clear_preview"
			/>
		</div>
		<div class="bd">
			<p class="nm">{{ share_publish.folder_name }}</p>
			<textarea
				v-model="pub.description.value"
				class="ds"
				rows="1"
				:maxlength="MAX_DESCRIPTION"
				:placeholder="t('publish.description_placeholder')"
				@focus="writing = true"
				@blur="writing = false"
				@keydown.stop
			/>
			<p v-if="writing || pub.description.value.length > MAX_DESCRIPTION - 40" class="count">
				{{ pub.description.value.length }}/{{ MAX_DESCRIPTION }}
			</p>
			<div class="tags">
				<button
					v-for="tag in pub.tags.value"
					:key="tag"
					type="button"
					class="tag"
					:aria-label="t('publish.remove_tag', { tag })"
					@click="pub.remove_tag(tag)"
				>#{{ tag }}<Icon icon="tabler:x" class="tx" /></button>
				<input
					v-if="pub.tags.value.length < MAX_TAGS"
					v-model="pub.tag_input.value"
					class="tagin"
					:placeholder="t('publish.add_tag')"
					autocapitalize="none"
					:spellcheck="false"
					@keydown="on_tag_key"
					@blur="pub.add_tag"
				>
			</div>
		</div>
	</div>
	<input ref="file_input" type="file" class="file" :accept="HUB_PREVIEW_ACCEPT" @change="on_file">
	<p v-if="pub.preview_error.value" class="err">{{ pub.preview_error.value }}</p>
	<p v-if="pub.tag_issue.value === 'format'" class="err">{{ t('publish.tag_format') }}</p>
	<p v-else-if="pub.tag_issue.value === 'dup'" class="err">{{ t('publish.tag_dup') }}</p>
	<p v-else-if="pub.tag_issue.value === 'limit'" class="err">{{ t('publish.tag_limit', { n: MAX_TAGS }) }}</p>
</template>

<style scoped>
.card {
	border: 0.5px solid var(--border-strong);
	border-radius: 10px;
	background: var(--surface-2);
	overflow: hidden;
}
.cover {
	position: relative;
}
.shot {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 100%;
	height: 118px;
	padding: 0;
	border: 0;
	border-bottom: 0.5px solid var(--border);
	background: var(--surface-1);
	color: var(--text-secondary);
	font: inherit;
	cursor: pointer;
}
.shot:hover {
	background: var(--fill-ghost-hover, var(--surface-1));
}
.shot.filled {
	height: auto;
	aspect-ratio: 16 / 9;
	max-height: 180px;
}
.shot img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}
.empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 2px;
}
.ic {
	width: 20px;
	height: 20px;
	margin-bottom: 2px;
}
.sm {
	color: var(--text-muted);
	font-size: 11px;
}
.x {
	position: absolute;
	top: 6px;
	right: 6px;
	background: var(--surface-3);
}
.bd {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 10px 12px 12px;
}
.nm {
	margin: 0;
	overflow: hidden;
	font-weight: 600;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.ds {
	width: 100%;
	box-sizing: border-box;
	min-height: 1.4em;
	max-height: 8em;
	margin: 0;
	padding: 0;
	border: 0;
	background: transparent;
	color: var(--text-secondary);
	font: inherit;
	line-height: 1.4;
	resize: none;
	field-sizing: content;
	outline: none;
	user-select: text;
	-webkit-user-select: text;
}
.count {
	margin: 0;
	text-align: right;
	color: var(--text-muted);
	font-size: 11px;
}
.tags {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 4px;
	margin-top: 4px;
}
.tag {
	display: inline-flex;
	align-items: center;
	gap: 2px;
	padding: 1px 6px 1px 8px;
	border: 0;
	border-radius: 6px;
	background: var(--bg-accent);
	color: var(--text-accent);
	font: inherit;
	font-size: 12px;
	cursor: pointer;
}
.tx {
	width: 11px;
	height: 11px;
	opacity: .6;
}
.tag:hover .tx {
	opacity: 1;
}
.tagin {
	width: 6.5em;
	padding: 1px 8px;
	border: 0.5px dashed var(--border-strong);
	border-radius: 6px;
	background: transparent;
	color: var(--text-primary);
	font: inherit;
	font-size: 12px;
	outline: none;
	user-select: text;
	-webkit-user-select: text;
}
.tagin:focus {
	border-style: solid;
	border-color: var(--border-accent, var(--border-stronger));
}
.err {
	margin: 0;
	color: var(--text-danger);
	font-size: 12px;
}
.file {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip: rect(0 0 0 0);
}
</style>
