<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { locale } from '@/i18n'
import { load_turnstile, turnstile_site_key, type TurnstileApi } from '@/services/cloud/turnstile'

/** The Turnstile check; emits its token, and null once it expires or fails */
const emit = defineEmits<{ token: [string | null] }>()

const box = ref<HTMLElement | null>(null)
const failed = ref(false)
let api: TurnstileApi | null = null
let widget: string | null = null

onMounted(async () => {
	if (!turnstile_site_key || !box.value) return
	try {
		api = await load_turnstile()
	} catch {
		failed.value = true
		return
	}
	if (!box.value) return
	widget = api.render(box.value, {
		sitekey: turnstile_site_key,
		language: locale.value,
		callback: (token: string) => emit('token', token),
		'expired-callback': () => emit('token', null),
		'error-callback': () => emit('token', null),
	})
})

/** A token is good for one sign-up: after a try the form asks for a new one */
function reset() {
	if (api && widget) api.reset(widget)
	emit('token', null)
}

defineExpose({ reset })

onBeforeUnmount(() => {
	if (api && widget) api.remove(widget)
})
</script>

<template>
	<div ref="box" class="ts" />
	<slot v-if="failed" name="failed" />
</template>

<style scoped>
.ts {
	min-height: 65px;
}
</style>
