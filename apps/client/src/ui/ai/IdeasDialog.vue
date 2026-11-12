<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { count_notes, t } from '@/i18n'
import { model_label } from '@/services/ai/presets'
import { ai_base_check, ai_settings } from '@/store/ai'
import { ideas_session } from '@/store/aiIdeas'
import AiReachBadge from './AiReachBadge.vue'
import IdeaNotePreview from './IdeaNotePreview.vue'
import {
	add_ideas,
	cancel_ideas,
	generate_ideas,
	idea_title_of,
	ideas_busy,
	ideas_description,
	ideas_flow,
	ideas_from_model,
	ideas_in_dialog,
	ideas_planned,
	ideas_rows,
	ideas_title,
	ideas_to_add,
	stop_ideas,
} from './ideasFlow'

/**
 * The new-notes session as a dialog: everywhere a Board or a Canvas does not
 * show the folder (a list, a gallery, 3D, an agent's folder not on screen).
 * Each note shows the way it will look, checked, under the name it will get.
 */

const toast = useToast()
const open = computed(() => ideas_in_dialog.value)
const field = ref<{ inputRef?: HTMLInputElement } | null>(null)

watch(() => [ideas_session.run, open.value] as const, async () => {
	if (!open.value || !ideas_from_model.value || ideas_flow.phase !== 'ask') return
	await nextTick()
	field.value?.inputRef?.focus()
})

async function add() {
	const { created, untoasted } = await add_ideas()
	// The history's toast says it, with "Undo"; a store without history says it here
	if (untoasted) toast.add({ title: t('undo.notes_added', { count: count_notes(created) }), color: 'success' })
}

function on_open_change(value: boolean) {
	if (!value) cancel_ideas()
}
</script>

<template>
	<UModal
		:open="open"
		:title="ideas_title"
		:description="ideas_description"
		:ui="{ content: 'max-w-2xl', footer: 'justify-between' }"
		@update:open="on_open_change"
	>
		<template #body>
			<div class="flex flex-col gap-3">
				<form v-if="ideas_from_model" class="flex gap-2" @submit.prevent="generate_ideas">
					<UInput
						ref="field"
						v-model="ideas_flow.prompt"
						class="flex-1"
						:placeholder="t('ideas.prompt_placeholder')"
						:disabled="ideas_busy || ideas_flow.phase === 'applying'"
						icon="i-lucide:sparkles"
					/>
					<UButton v-if="ideas_flow.phase === 'ask'" type="submit" :label="t('ideas.generate')" />
				</form>

				<div v-if="ideas_from_model" class="flex flex-wrap items-center gap-2 text-xs text-muted">
					<AiReachBadge v-if="ai_base_check.ok" :reach="ai_base_check.reach" />
					<span v-if="ideas_flow.phase === 'reading'">{{ t('ideas.reading', { done: ideas_flow.read, total: ideas_session.entries.length }) }}</span>
					<span v-else-if="ideas_flow.phase === 'writing'">{{ t('ideas.asking', { model: model_label(ai_settings.model) }) }}</span>
					<span v-if="ideas_flow.coverage">{{ ideas_flow.coverage }}</span>
				</div>

				<p v-if="ideas_flow.phase === 'review' && ideas_rows.length" class="text-xs text-muted">{{ t('ideas.hint') }}</p>
				<p v-if="ideas_flow.error" class="text-sm text-error">{{ ideas_flow.error }}</p>
				<p v-if="ideas_flow.notice" class="text-sm text-warning">{{ ideas_flow.notice }}</p>
				<p v-if="ideas_flow.truncated" class="text-xs text-warning">{{ t('ideas.truncated') }}</p>

				<ul v-if="ideas_rows.length" class="flex max-h-[55vh] flex-col gap-2 overflow-y-auto">
					<li
						v-for="(row, index) in ideas_rows"
						:key="row.key"
						class="flex gap-2.5 rounded-md border border-default p-2.5"
						:class="{ 'opacity-60': (!row.checked && row.status === 'ready') || row.status === 'writing' }"
					>
						<UCheckbox
							v-model="row.checked"
							class="mt-0.5"
							:disabled="row.status !== 'ready' || ideas_flow.phase !== 'review'"
							:aria-label="t('ideas.check', { name: idea_title_of(ideas_planned[index] ?? row.name) })"
						/>
						<div class="min-w-0 flex-1">
							<p class="flex items-center gap-1.5 truncate text-sm font-medium" :title="ideas_planned[index] ?? row.name">
								<UIcon v-if="row.status === 'writing'" name="i-lucide:loader-circle" class="size-3.5 shrink-0 animate-spin text-muted" />
								{{ idea_title_of(ideas_planned[index] ?? row.name) }}
							</p>
							<IdeaNotePreview :text="row.text" class="mt-1 max-h-28" />
							<p v-if="row.status === 'failed' && row.error" class="mt-1 text-xs text-error">{{ row.error }}</p>
						</div>
					</li>
				</ul>
			</div>
		</template>

		<template #footer>
			<span class="text-xs text-muted">
				<template v-if="ideas_flow.phase === 'review'">{{ t('ideas.to_add', { n: ideas_to_add.length }) }}</template>
			</span>
			<div class="flex gap-2">
				<UButton
					v-if="ideas_busy"
					:label="t('ideas.stop')"
					icon="i-lucide:square"
					color="neutral"
					variant="outline"
					@click="stop_ideas"
				/>
				<UButton v-else-if="ideas_flow.phase === 'ask'" :label="t('ideas.cancel')" color="neutral" variant="outline" @click="cancel_ideas" />
				<template v-else-if="ideas_flow.phase === 'review'">
					<UButton
						v-if="ideas_from_model"
						:label="t('ideas.more')"
						icon="i-lucide:sparkles"
						color="neutral"
						variant="outline"
						@click="generate_ideas"
					/>
					<UButton :label="t('ideas.cancel')" color="neutral" variant="outline" @click="cancel_ideas" />
					<UButton :label="t('ideas.add', { n: ideas_to_add.length })" :disabled="!ideas_to_add.length" @click="add" />
				</template>
				<UButton v-else-if="ideas_flow.phase === 'applying'" :label="t('ideas.adding')" loading disabled />
				<UButton v-else :label="t('ideas.close')" color="neutral" variant="outline" @click="cancel_ideas" />
			</div>
		</template>
	</UModal>
</template>
