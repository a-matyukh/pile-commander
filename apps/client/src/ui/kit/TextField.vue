<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { t } from '@/i18n'

const props = defineProps<{
	icon?: string
	type?: string
	placeholder?: string
	autocomplete?: string
	autofocus?: boolean
	invalid?: boolean
	disabled?: boolean
	spellcheck?: boolean
	autocapitalize?: string
}>()

const model = defineModel<string>({ required: true })
const input_el = ref<HTMLInputElement | null>(null)

/** A password field has an eye that shows what was typed, and hides it again */
const revealed = ref(false)
const is_password = computed(() => props.type === 'password')
const input_type = computed(() => (is_password.value && revealed.value ? 'text' : props.type ?? 'text'))

/** `select`: true for the whole text, or its `[start, end]` part */
function focus(select: boolean | [number, number] = false) {
	const input = input_el.value
	if (!input) return
	input.focus()
	if (Array.isArray(select)) input.setSelectionRange(select[0], select[1])
	else if (select) input.select()
}

defineExpose({ focus })
</script>

<template>
	<label class="tf" :class="{ bad: invalid, off: disabled }">
		<Icon v-if="icon" :icon="icon" class="ic" />
		<input
			ref="input_el"
			v-model="model"
			:type="input_type"
			:placeholder="placeholder"
			:autocomplete="autocomplete"
			:autofocus="autofocus"
			:disabled="disabled"
			:spellcheck="spellcheck"
			:autocapitalize="autocapitalize"
		/>
		<!-- mousedown kept: the caret stays in the field while the eye is pressed -->
		<button
			v-if="is_password"
			type="button"
			class="eye"
			:disabled="disabled"
			:aria-pressed="revealed"
			:aria-label="revealed ? t('text_field.hide_password') : t('text_field.show_password')"
			:title="revealed ? t('text_field.hide_password') : t('text_field.show_password')"
			@mousedown.prevent
			@click="revealed = !revealed"
		>
			<Icon :icon="revealed ? 'tabler:eye-off' : 'tabler:eye'" />
		</button>
	</label>
</template>

<style scoped>
.tf {
	display: flex;
	align-items: center;
	gap: 8px;
	height: 34px;
	padding: 0 10px;
	border: 0.5px solid var(--border-strong);
	border-radius: 7px;
	background: var(--surface-2);
	box-sizing: border-box;
	cursor: text;
}
.tf:focus-within {
	border-color: var(--fill-accent);
	box-shadow: 0 0 0 3px var(--bg-accent);
}
.tf.bad {
	border-color: var(--fill-danger);
}
.tf.off {
	opacity: .45;
	cursor: default;
}
.ic {
	font-size: 16px;
	color: var(--text-muted);
}
input {
	flex: 1;
	min-width: 0;
	border: none;
	outline: none;
	background: none;
	padding: 0;
	font: inherit;
	color: var(--text-primary);
	user-select: text;
	-webkit-user-select: text;
}
input::placeholder {
	color: var(--text-muted);
}
.eye {
	display: flex;
	flex: none;
	align-items: center;
	justify-content: center;
	width: 26px;
	height: 26px;
	margin-right: -6px;
	padding: 0;
	border: none;
	border-radius: 5px;
	background: none;
	color: var(--text-muted);
	font-size: 16px;
	cursor: pointer;
}
.eye:focus-visible {
	outline: 2px solid var(--fill-accent);
	outline-offset: 1px;
}
.eye:disabled {
	cursor: default;
}
@media (hover: hover) {
	.eye:hover:not(:disabled) {
		color: var(--text-secondary);
		background: var(--surface-1);
	}
}
.explorer.lg .tf {
	height: 42px;
}
.explorer.lg .eye {
	font-size: 19px;
}
</style>
