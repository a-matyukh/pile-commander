<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '@/i18n'
import cloud from '@/store/cloud'
import bridge, {
	cancel_copy,
	click_pro,
	delete_partial_copy,
	dismiss_bridge,
	measure,
	open_copied,
	open_finished,
	start_copy,
	submit_pro,
	sync_with_copied,
	toggle_exclude,
} from '@/store/bridge'
import { bridge_panel_view } from '@/store/bridgePanel'
import { explorer_navigation } from '@/store/explorer/navigation'
import Button from '@/ui/kit/Button.vue'
import Checkbox from '@/ui/kit/Checkbox.vue'
import PanelTrack from './PanelTrack.vue'

const answer = ref('')

const view = computed(() => bridge_panel_view({
	door: bridge.door,
	step: bridge.step,
	source_name: bridge.source?.name ?? '',
	preflight: bridge.preflight,
	exclude: bridge.exclude,
	pro: bridge.pro,
	pro_step: bridge.pro_step,
	resumable: bridge.resumable !== null,
	copied: bridge.copied !== null,
	progress: bridge.progress,
	error: bridge.error,
	plan: cloud.billing?.plan ?? null,
}))

function sign_in() {
	void explorer_navigation.open_page('account')
}

function send_answer(skip: boolean) {
	submit_pro(skip ? null : answer.value.trim() || null)
	answer.value = ''
}
</script>

<template>
	<!-- pointerdown and click stay inside the menu: a checkbox is not a menu item, so the popover stays open. -->
	<div class="body" @pointerdown.stop @click.stop>
		<div v-if="view.source_name" class="name">{{ view.source_name }}</div>
		<p v-if="view.lead">{{ view.lead }}</p>
		<p v-if="view.note" :class="{ err: view.step === 'error' }">{{ view.note }}</p>
		<p v-if="view.file_name" class="name">{{ view.file_name }}</p>
		<p v-if="view.step !== 'error' && view.error" class="err">{{ view.error }}</p>
		<p v-if="view.resumable_note" class="muted">
			{{ view.resumable_note }}
			<Button variant="danger-link" @click="delete_partial_copy">{{ t('bridge.delete_partial') }}</Button>
		</p>
		<p v-else-if="view.copied_note" class="muted">
			{{ view.copied_note }}
			<Button v-if="view.copied_action === 'sync'" variant="link" @click="sync_with_copied">{{ t('bridge.sync_instead') }}</Button>
			<Button v-else-if="view.copied_action === 'open'" variant="link" @click="open_copied">{{ t('bridge.open_that') }}</Button>
		</p>
		<p v-if="view.summary">{{ view.summary }}</p>
		<p v-if="view.plan_line" class="muted">{{ view.plan_line }}</p>
		<p v-if="view.fit_line">{{ view.fit_line }}</p>
		<ul v-if="view.files.length" class="files">
			<li v-for="file in view.files" :key="file.relative" @keydown.stop>
				<Checkbox
					:model-value="file.included"
					:disabled="file.disabled"
					:label="t('bridge.copy_file', { name: file.relative })"
					@update:model-value="toggle_exclude(file.relative)"
				/>
				<span class="path" :title="file.relative">{{ file.relative }}</span>
				<span class="size">{{ file.label }}</span>
			</li>
		</ul>
		<div v-if="view.step === 'summary' && view.pro_step === 'asking'" class="ask">
			<p>{{ t('bridge.pro_ask') }}</p>
			<textarea
				v-model="answer"
				class="ta"
				rows="2"
				:placeholder="t('bridge.pro_placeholder')"
				@keydown.stop
			/>
			<div class="ft">
				<Button @click="send_answer(true)">{{ t('bridge.pro_skip') }}</Button>
				<Button variant="primary" :disabled="!answer.trim()" @click="send_answer(false)">{{ t('bridge.pro_send') }}</Button>
			</div>
		</div>
		<p v-else-if="view.step === 'summary' && view.pro_step === 'sent'" class="muted">{{ t('bridge.pro_sent') }}</p>
		<PanelTrack v-if="view.track === 'slide'" :fraction="null" />
		<PanelTrack v-else-if="view.track === 'share'" :fraction="view.fraction" />
		<div v-if="view.step === 'auth'" class="ft">
			<Button variant="primary" @click="sign_in">{{ t('bridge.sign_in') }}</Button>
		</div>
		<div v-else-if="view.step === 'measuring'" class="ft">
			<Button @click="dismiss_bridge">{{ t('bridge.cancel') }}</Button>
		</div>
		<div v-else-if="view.step === 'copying'" class="ft">
			<Button @click="cancel_copy">{{ t('bridge.cancel_copy') }}</Button>
		</div>
		<div v-else-if="view.step === 'error'" class="ft">
			<Button @click="dismiss_bridge">{{ t('bridge.close') }}</Button>
			<Button variant="primary" @click="measure">{{ t('bridge.retry') }}</Button>
		</div>
		<div v-else-if="view.step === 'summary' && view.primary" class="ft">
			<Button @click="dismiss_bridge">{{ t('bridge.cancel') }}</Button>
			<Button v-if="view.show_pro" @click="click_pro">{{ t('bridge.pro') }}</Button>
			<Button variant="primary" :disabled="view.primary_disabled" @click="start_copy">{{ view.primary }}</Button>
		</div>
		<div v-else-if="view.step === 'done' && view.primary" class="ft">
			<Button variant="primary" @click="open_finished">{{ view.primary }}</Button>
		</div>
	</div>
</template>

<style scoped>
.body {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin-top: 6px;
	font-size: 13px;
	line-height: 1.4;
}
p {
	margin: 0;
}
.muted {
	color: var(--text-muted);
}
.err {
	color: var(--text-danger);
}
.name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.files {
	display: flex;
	flex-direction: column;
	gap: 4px;
	max-height: 220px;
	margin: 0;
	padding: 0;
	overflow-y: auto;
	list-style: none;
}
.files li {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
}
.path {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.size {
	flex: none;
	color: var(--text-muted);
	font-size: 12px;
}
.ask {
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.ta {
	width: 100%;
	box-sizing: border-box;
	padding: 8px;
	border: 0.5px solid var(--border-strong);
	border-radius: 7px;
	background: var(--surface-2);
	color: var(--text-primary);
	font: inherit;
	resize: vertical;
	user-select: text;
	-webkit-user-select: text;
}
.ft {
	display: flex;
	flex-wrap: wrap;
	justify-content: flex-end;
	gap: 8px;
}
:global(.explorer.lg) .body {
	font-size: 15px;
}
</style>
