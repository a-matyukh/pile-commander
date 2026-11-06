<script setup lang="ts">
import { Icon } from '@iconify/vue'
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

/** The computer → cloud picture: while choosing, while copying, and once it is done. */
const route = computed(() =>
	!!view.value.source_name && (view.value.step === 'summary' || view.value.step === 'copying' || view.value.step === 'done'),
)

function percent(value: number): string {
	return `${(value * 100).toFixed(2)}%`
}

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
		<div v-if="route" class="route" :class="[view.direction, view.step]">
			<div class="end">
				<span class="badge"><Icon icon="tabler:folder" /></span>
				<span class="end-name" :title="view.source_name">{{ view.source_name }}</span>
				<span class="end-sub">{{ t('bridge.here') }}</span>
			</div>
			<div class="link" aria-hidden="true">
				<span class="line" />
				<span class="pulse fwd" />
				<span v-if="view.direction === 'both'" class="pulse back" />
				<span class="arrow">
					<Icon :icon="view.direction === 'both' ? 'tabler:arrows-left-right' : 'tabler:arrow-narrow-right'" />
				</span>
			</div>
			<div class="end">
				<span class="badge cloud"><Icon :icon="view.step === 'done' ? 'tabler:cloud-check' : 'tabler:cloud'" /></span>
				<span class="end-name">{{ t('bridge.there') }}</span>
				<span class="end-sub">{{ view.meter?.plan ?? '' }}</span>
			</div>
		</div>
		<div v-else-if="view.source_name" class="name">{{ view.source_name }}</div>
		<p v-if="view.lead" :class="{ lead: route }">{{ view.lead }}</p>
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
		<div v-if="view.stats" class="stats">
			<div class="stat">
				<b>{{ view.stats.size }}</b>
				<span>{{ t('bridge.stat_total') }}</span>
			</div>
			<div class="stat">
				<b>{{ view.stats.count }}</b>
				<span>{{ view.stats.count_label }}</span>
			</div>
			<div v-if="view.stats.largest" class="stat">
				<b>{{ view.stats.largest }}</b>
				<span>{{ view.stats.largest_label }}</span>
			</div>
		</div>
		<p v-else-if="view.summary">{{ view.summary }}</p>
		<div v-if="view.meter" class="meter" :class="{ over: view.meter.over }">
			<div class="meter-hd">
				<span>{{ t('bridge.there') }} · {{ view.meter.plan }}</span>
				<span class="muted">{{ view.meter.free_line }}</span>
			</div>
			<div class="bar" aria-hidden="true">
				<span class="used" :style="{ width: percent(view.meter.used) }" />
				<span class="adding" :style="{ width: percent(view.meter.adding) }" />
			</div>
			<div class="legend">
				<span><i class="sw used" />{{ t('bridge.meter_used') }}</span>
				<span><i class="sw adding" />{{ t('bridge.meter_adding') }}</span>
				<span class="per">{{ view.meter.per_file }}</span>
			</div>
			<p v-if="view.meter.pro_line" class="pro-line">{{ view.meter.pro_line }}</p>
		</div>
		<p v-else-if="view.plan_line" class="muted">{{ view.plan_line }}</p>
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

/* computer → cloud */
.route {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 64px minmax(0, 1fr);
	align-items: start;
	gap: 4px;
	padding: 12px 6px 10px;
	border-radius: 10px;
	background: linear-gradient(180deg, var(--bg-accent), transparent);
}
.end {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 2px;
	min-width: 0;
	text-align: center;
}
.badge {
	display: grid;
	place-items: center;
	width: 40px;
	height: 40px;
	margin-bottom: 4px;
	border-radius: 12px;
	background: var(--surface-3);
	border: 0.5px solid var(--border-strong);
	box-shadow: 0 2px 6px rgba(0, 0, 0, .06);
	color: var(--text-secondary);
	font-size: 22px;
}
.badge.cloud {
	color: var(--fill-accent);
}
.done .badge.cloud {
	color: var(--text-success);
}
.end-name {
	max-width: 100%;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: 600;
}
.end-sub {
	color: var(--text-muted);
	font-size: 11px;
}
.link {
	position: relative;
	height: 40px;
}
.line {
	position: absolute;
	top: 50%;
	left: 0;
	right: 0;
	border-top: 1.5px dashed var(--border-accent);
}
.arrow {
	position: absolute;
	top: 50%;
	left: 50%;
	display: grid;
	place-items: center;
	width: 22px;
	height: 22px;
	border-radius: 50%;
	background: var(--surface-3);
	border: 0.5px solid var(--border-accent);
	color: var(--text-accent);
	font-size: 14px;
	transform: translate(-50%, -50%);
}
.pulse {
	position: absolute;
	top: 50%;
	width: 6px;
	height: 6px;
	margin-top: -3px;
	border-radius: 50%;
	background: var(--fill-accent);
	opacity: 0;
}
.pulse.fwd {
	animation: pulse-fwd 2.4s ease-in-out infinite;
}
.pulse.back {
	animation: pulse-back 2.4s ease-in-out 1.2s infinite;
}
.copying .pulse.fwd {
	animation-duration: 1s;
}
.copying .pulse.back,
.done .pulse {
	display: none;
}
@keyframes pulse-fwd {
	0% { left: 0; opacity: 0; }
	15% { opacity: 1; }
	85% { opacity: 1; }
	100% { left: calc(100% - 6px); opacity: 0; }
}
@keyframes pulse-back {
	0% { left: calc(100% - 6px); opacity: 0; }
	15% { opacity: 1; }
	85% { opacity: 1; }
	100% { left: 0; opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
	.pulse {
		display: none;
	}
}
.lead {
	color: var(--text-secondary);
	font-size: 12px;
	text-align: center;
}

/* size, files, largest */
.stats {
	display: flex;
	gap: 6px;
}
.stat {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: 1px;
	min-width: 0;
	padding: 7px 8px;
	border-radius: 8px;
	background: var(--surface-1);
	border: 0.5px solid var(--border);
}
.stat b {
	font-size: 15px;
	font-weight: 600;
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
}
.stat span {
	color: var(--text-muted);
	font-size: 11px;
	line-height: 1.25;
}

/* cloud space */
.meter {
	display: flex;
	flex-direction: column;
	gap: 6px;
}
.meter-hd {
	display: flex;
	justify-content: space-between;
	gap: 8px;
	font-size: 12px;
	font-weight: 600;
}
.meter-hd .muted {
	font-weight: 400;
}
.bar {
	display: flex;
	height: 8px;
	border-radius: 999px;
	background: var(--border);
	overflow: hidden;
}
.bar .used {
	background: var(--text-muted);
}
.bar .adding {
	min-width: 4px;
	background: var(--fill-accent);
}
.over .bar .adding,
.over .sw.adding {
	background: var(--fill-danger);
}
.legend {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 4px 10px;
	color: var(--text-muted);
	font-size: 11px;
}
.legend > span {
	display: inline-flex;
	align-items: center;
	gap: 4px;
}
.legend .per {
	margin-left: auto;
}
.sw {
	width: 8px;
	height: 8px;
	border-radius: 2px;
}
.sw.used {
	background: var(--text-muted);
}
.sw.adding {
	background: var(--fill-accent);
}
.pro-line {
	color: var(--text-muted);
	font-size: 11px;
}
:global(.explorer.lg) .stat b {
	font-size: 17px;
}
:global(.explorer.lg) .body {
	font-size: 15px;
}
</style>
