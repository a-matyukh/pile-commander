<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { count_notes, t } from '@/i18n'
import { model_label } from '@/services/ai/presets'
import { ai_base_check, ai_settings } from '@/store/ai'
import { ideas_session } from '@/store/aiIdeas'
import { Icon } from '@iconify/vue'
import Button from '@/ui/kit/Button.vue'
import Checkbox from '@/ui/kit/Checkbox.vue'
import Modal from '@/ui/kit/Modal.vue'
import TextField from '@/ui/kit/TextField.vue'
import AiReachBadge from './AiReachBadge.vue'
import './aiDialog.css'
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
const field = ref<InstanceType<typeof TextField> | null>(null)

watch(() => [ideas_session.run, open.value] as const, async () => {
	if (!open.value || !ideas_from_model.value || ideas_flow.phase !== 'ask') return
	await nextTick()
	field.value?.focus()
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
	<Modal
		:open="open"
		:title="ideas_title"
		:description="ideas_description"
		:width="640"
		@update:open="on_open_change"
	>
		<div class="aid">
			<form v-if="ideas_from_model" class="ideas-ask" @submit.prevent="generate_ideas">
				<TextField
					ref="field"
					v-model="ideas_flow.prompt"
					class="ideas-field"
					icon="tabler:sparkles"
					:placeholder="t('ideas.prompt_placeholder')"
					:disabled="ideas_busy || ideas_flow.phase === 'applying'"
				/>
				<Button v-if="ideas_flow.phase === 'ask'" type="submit" variant="primary">{{ t('ideas.generate') }}</Button>
			</form>

			<div v-if="ideas_from_model" class="aid-status">
				<AiReachBadge v-if="ai_base_check.ok" :reach="ai_base_check.reach" />
				<span v-if="ideas_flow.phase === 'reading'">{{ t('ideas.reading', { done: ideas_flow.read, total: ideas_session.entries.length }) }}</span>
				<span v-else-if="ideas_flow.phase === 'writing'">{{ t('ideas.asking', { model: model_label(ai_settings.model) }) }}</span>
				<span v-if="ideas_flow.coverage">{{ ideas_flow.coverage }}</span>
			</div>

			<p v-if="ideas_flow.phase === 'review' && ideas_rows.length" class="aid-hint">{{ t('ideas.hint') }}</p>
			<p v-if="ideas_flow.error" class="aid-error">{{ ideas_flow.error }}</p>
			<p v-if="ideas_flow.notice" class="aid-warn">{{ ideas_flow.notice }}</p>
			<p v-if="ideas_flow.truncated" class="aid-warn">{{ t('ideas.truncated') }}</p>

			<ul v-if="ideas_rows.length" class="aid-cards">
				<li
					v-for="(row, index) in ideas_rows"
					:key="row.key"
					class="aid-card idea"
					:class="{ 'idea--off': (!row.checked && row.status === 'ready') || row.status === 'writing' }"
				>
					<Checkbox
						v-model="row.checked"
						class="idea-check"
						:disabled="row.status !== 'ready' || ideas_flow.phase !== 'review'"
						:label="t('ideas.check', { name: idea_title_of(ideas_planned[index] ?? row.name) })"
					/>
					<div class="idea-body">
						<p class="idea-title" :title="ideas_planned[index] ?? row.name">
							<Icon v-if="row.status === 'writing'" icon="tabler:loader-2" class="aid-spin aid-icon" />
							{{ idea_title_of(ideas_planned[index] ?? row.name) }}
						</p>
						<IdeaNotePreview :text="row.text" class="idea-text" />
						<p v-if="row.status === 'failed' && row.error" class="aid-error">{{ row.error }}</p>
					</div>
				</li>
			</ul>
		</div>

		<template #aside>
			<template v-if="ideas_flow.phase === 'review'">{{ t('ideas.to_add', { n: ideas_to_add.length }) }}</template>
		</template>
		<template #footer>
			<Button v-if="ideas_busy" icon="tabler:player-stop" @click="stop_ideas">{{ t('ideas.stop') }}</Button>
			<Button v-else-if="ideas_flow.phase === 'ask'" @click="cancel_ideas">{{ t('ideas.cancel') }}</Button>
			<template v-else-if="ideas_flow.phase === 'review'">
				<Button v-if="ideas_from_model" icon="tabler:sparkles" @click="generate_ideas">{{ t('ideas.more') }}</Button>
				<Button @click="cancel_ideas">{{ t('ideas.cancel') }}</Button>
				<Button variant="primary" :disabled="!ideas_to_add.length" @click="add">{{ t('ideas.add', { n: ideas_to_add.length }) }}</Button>
			</template>
			<Button v-else-if="ideas_flow.phase === 'applying'" variant="primary" loading>{{ t('ideas.adding') }}</Button>
			<Button v-else @click="cancel_ideas">{{ t('ideas.close') }}</Button>
		</template>
	</Modal>
</template>

<style scoped>
.ideas-ask {
	display: flex;
	gap: 8px;
}
.ideas-field {
	flex: 1 1 auto;
	min-width: 0;
}
.idea {
	display: flex;
	gap: 10px;
	padding: 10px;
}
.idea--off {
	opacity: .6;
}
.idea-check {
	margin-top: 1px;
}
.idea-body {
	flex: 1 1 auto;
	min-width: 0;
}
.idea-title {
	display: flex;
	align-items: center;
	gap: 6px;
	margin: 0;
	overflow: hidden;
	font-weight: 500;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.idea-text {
	max-height: 7rem;
	margin-top: 4px;
}
</style>
