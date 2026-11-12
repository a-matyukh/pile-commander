<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { strip_think, untrusted_markdown } from '@/services/ai/text'
import { parseNoteMarkdown } from '@/ui/workspace/folder-container/widgets/markdown'
import { loadedNoteRenderer, loadNoteRenderer } from '@/ui/workspace/folder-container/widgets/noteRenderer'

/** A proposed note the way the note will show: untrusted Markdown, small headings. */
const props = defineProps<{ text: string }>()

const render = shallowRef(loadedNoteRenderer())
if (!render.value) {
	void loadNoteRenderer().then((loaded) => {
		render.value = loaded
	})
}

const html = computed(() => (render.value ?? parseNoteMarkdown)(untrusted_markdown(strip_think(props.text))))
</script>

<template>
	<div
		class="note-preview prose prose-sm prose-gray max-w-none overflow-hidden text-muted prose-headings:my-1 prose-headings:text-sm prose-headings:font-semibold prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0"
		v-html="html"
	/>
</template>
