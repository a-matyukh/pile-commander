<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { count_notes, t } from '@/i18n'
import { model_label } from '@/services/ai/presets'
import { ai_settings } from '@/store/ai'
import { ideas_on_board, ideas_session } from '@/store/aiIdeas'
import {
	add_ideas,
	cancel_ideas,
	generate_ideas,
	ideas_busy,
	ideas_flow,
	ideas_from_model,
	ideas_title,
	ideas_to_add,
	stop_ideas,
} from './ideasFlow'

/**
 * The bar under the cards on a Board or a Canvas, as in the landing scene:
 * for the model "What ideas?…", then "Add N · More · Cancel"; for an agent
 * its name, its reason and "Add N · Cancel". Esc stops a request, or cancels.
 */
const props = withDefaults(defineProps<{ folderId: string; /** Clear of the view's own controls at the bottom */ bottom?: number }>(), { bottom: 52 })

const toast = useToast()
const shown = computed(() => ideas_on_board.value && ideas_session.folder_id === props.folderId)
const field = ref<{ inputRef?: HTMLInputElement } | null>(null)

const message = computed(() => ideas_flow.error ?? ideas_flow.notice ?? (ideas_flow.truncated ? t('ideas.truncated') : null))
const status = computed(() => {
	if (ideas_flow.phase === 'reading') return t('ideas.reading', { done: ideas_flow.read, total: ideas_session.entries.length })
	if (ideas_flow.phase === 'writing') return t('ideas.asking', { model: model_label(ai_settings.value.model) })
	return null
})

watch(() => [ideas_session.run, shown.value] as const, async () => {
	if (!shown.value || !ideas_from_model.value || ideas_flow.phase !== 'ask') return
	await nextTick()
	field.value?.inputRef?.focus()
}, { immediate: true })

function on_key(event: KeyboardEvent) {
	if (event.key !== 'Escape' || !shown.value || event.defaultPrevented) return
	event.preventDefault()
	if (ideas_busy.value) stop_ideas()
	else if (ideas_flow.phase !== 'applying') cancel_ideas()
}

watch(shown, (on) => {
	if (on) window.addEventListener('keydown', on_key)
	else window.removeEventListener('keydown', on_key)
}, { immediate: true })

onBeforeUnmount(() => window.removeEventListener('keydown', on_key))

async function add() {
	const { created, untoasted } = await add_ideas()
	// The history's toast says it, with "Undo"; a store without history says it here
	if (untoasted) toast.add({ title: t('undo.notes_added', { count: count_notes(created) }), color: 'success' })
}
</script>

<template>
	<div v-if="shown" class="ideas-bar nodrag nopan" role="region" :aria-label="ideas_title" :style="{ bottom: `${props.bottom}px` }" @pointerdown.stop @contextmenu.stop>
		<p v-if="message" class="ideas-bar__message" :class="{ 'ideas-bar__message--error': !!ideas_flow.error }">{{ message }}</p>
		<div class="ideas-bar__frame">
		<span v-if="ideas_busy" class="ideas-bar__glow" aria-hidden="true" />
		<div class="ideas-bar__panel">
			<form v-if="ideas_from_model" class="ideas-bar__field" @submit.prevent="generate_ideas">
				<UInput
					ref="field"
					v-model="ideas_flow.prompt"
					class="w-full"
					variant="none"
					icon="i-lucide:sparkles"
					:placeholder="t('ideas.prompt_placeholder')"
					:disabled="ideas_busy || ideas_flow.phase === 'applying'"
				/>
			</form>
			<div v-else class="ideas-bar__who">
				<span class="ideas-bar__name">{{ ideas_title }}</span>
				<span class="ideas-bar__reason" :title="ideas_session.reason">{{ ideas_session.reason }}</span>
			</div>

			<div class="ideas-bar__actions">
				<span v-if="status" class="ideas-bar__status">{{ status }}</span>
				<UButton class="rounded-full"
					v-if="ideas_busy"
					size="sm"
					:label="t('ideas.stop')"
					icon="i-lucide:square"
					color="neutral"
					variant="outline"
					@click="stop_ideas"
				/>
				<template v-else-if="ideas_flow.phase === 'ask'">
					<UButton class="rounded-full" size="sm" :label="t('ideas.cancel')" color="neutral" variant="ghost" @click="cancel_ideas" />
					<UButton class="rounded-full" size="sm" :label="t('ideas.generate')" @click="generate_ideas" />
				</template>
				<template v-else-if="ideas_flow.phase === 'review'">
					<UButton class="rounded-full"
						v-if="ideas_from_model"
						size="sm"
						:label="t('ideas.more')"
						icon="i-lucide:sparkles"
						color="neutral"
						variant="outline"
						@click="generate_ideas"
					/>
					<UButton class="rounded-full" size="sm" :label="t('ideas.cancel')" color="neutral" variant="ghost" @click="cancel_ideas" />
					<UButton class="rounded-full" size="sm" :label="t('ideas.add', { n: ideas_to_add.length })" :disabled="!ideas_to_add.length" @click="add" />
				</template>
				<UButton class="rounded-full" v-else-if="ideas_flow.phase === 'applying'" size="sm" :label="t('ideas.adding')" loading disabled />
				<UButton class="rounded-full" v-else size="sm" :label="t('ideas.close')" color="neutral" variant="outline" @click="cancel_ideas" />
			</div>
		</div>
		</div>
	</div>
</template>

<style scoped>
.ideas-bar {
	position: absolute;
	left: 50%;
	bottom: 52px;
	z-index: 40;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 6px;
	width: min(680px, calc(100% - 32px));
	transform: translateX(-50%);
}

.ideas-bar__message {
	margin: 0;
	border-radius: 8px;
	background: white;
	padding: 4px 10px;
	font-size: 12px;
	color: rgb(180 83 9);
	box-shadow: 0 4px 12px -6px rgb(15 23 42 / 0.25);
}

.ideas-bar__message--error {
	color: rgb(220 38 38);
}

.ideas-bar__frame {
	position: relative;
	width: 100%;
}

.ideas-bar__panel {
	position: relative;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px 10px;
	width: 100%;
	box-sizing: border-box;
	/* The same gray frame and shadow as the canvas dock */
	border: 0.5px solid var(--border-strong, rgba(0, 0, 0, .15));
	/* Fully round ends: one smooth curve, not a corner cut by the field */
	border-radius: 26px;
	background: var(--surface-3, #fff);
	padding: 6px 6px 6px 12px;
	box-shadow: 0 8px 24px rgba(0, 0, 0, .1), 0 2px 6px rgba(0, 0, 0, .06);
}

/* The field's hint and sparkle in neutral gray, not the blue-gray of the old kit */
.ideas-bar__field :deep(input) {
	color: var(--text-primary, #1f1f1e);
}

.ideas-bar__field :deep(input::placeholder),
.ideas-bar__field :deep(.iconify) {
	color: var(--text-muted, #9a9893);
}

/* While the model writes, a soft glow runs around the bar, as in the landing scene */
.ideas-bar__glow {
	position: absolute;
	inset: -2px;
	border-radius: 28px;
	background: linear-gradient(90deg, var(--pc-accent), #a78bfa, #38bdf8, #f0abfc, var(--pc-accent));
	background-size: 300% 100%;
	animation: ideas-bar-flow 2.4s linear infinite;
}

.ideas-bar__glow::after {
	content: '';
	position: absolute;
	inset: -6px;
	border-radius: 32px;
	background: inherit;
	filter: blur(10px);
	opacity: 0.5;
}

.ideas-bar__field {
	flex: 1 1 240px;
	min-width: 0;
}

.ideas-bar__who {
	display: flex;
	flex: 1 1 240px;
	min-width: 0;
	flex-direction: column;
	padding: 2px 4px;
	line-height: 1.3;
}

.ideas-bar__name {
	font-size: 13px;
	font-weight: 600;
	color: #1e293b;
}

.ideas-bar__reason {
	overflow: hidden;
	font-size: 12px;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--pc-text-muted);
}

.ideas-bar__actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: flex-end;
	gap: 6px;
	margin-left: auto;
}

.ideas-bar__status {
	font-size: 12px;
	color: var(--pc-text-muted);
}

@keyframes ideas-bar-flow {
	to {
		background-position: 300% 0;
	}
}

@media (prefers-reduced-motion: reduce) {
	.ideas-bar__glow {
		animation: none;
	}
}
</style>
