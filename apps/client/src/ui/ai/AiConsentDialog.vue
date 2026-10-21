<script setup lang="ts">
import { computed } from 'vue'
import { ai_consent_request, answer_ai_consent } from '@/store/aiConsent'

const lines = computed(() => {
	const host = ai_consent_request.host
	return ai_consent_request.needs.map((need) => {
		switch (need) {
			case 'cloud':
				return { icon: 'i-lucide:cloud', text: `File names and note text will be sent to ${host} to answer the request.` }
			case 'images':
				return { icon: 'i-lucide:image', text: `Images will be sent to ${host}, reduced to 512 px.` }
			case 'shared':
				return { icon: 'i-lucide:users', text: 'This workspace is shared: files by other members will be sent too.' }
		}
	})
})
</script>

<template>
	<UModal
		:open="ai_consent_request.open"
		:title="`Send to ${ai_consent_request.host}?`"
		description="The provider is in the cloud. You'll be asked once for each of these."
		:ui="{ footer: 'justify-end' }"
		@update:open="(value: boolean) => { if (!value) answer_ai_consent(false) }"
	>
		<template #body>
			<ul class="flex flex-col gap-2 text-sm">
				<li v-for="line in lines" :key="line.icon" class="flex items-start gap-2">
					<UIcon :name="line.icon" class="mt-0.5 size-4 shrink-0 text-muted" />
					<span>{{ line.text }}</span>
				</li>
			</ul>
		</template>
		<template #footer>
			<UButton label="Cancel" color="neutral" variant="outline" @click="answer_ai_consent(false)" />
			<UButton label="Send" @click="answer_ai_consent(true)" />
		</template>
	</UModal>
</template>
