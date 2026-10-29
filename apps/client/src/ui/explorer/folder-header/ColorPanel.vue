<script setup lang="ts">
import { ref, watch } from 'vue'
import { t } from '@/i18n'
import { PRESET_COLORS } from '@/ui/workspace/menu/useColorSubmenu'
import MenuItem from '@/ui/kit/MenuItem.vue'
import MenuLabel from '@/ui/kit/MenuLabel.vue'

/**
 * A cover's (or a background's, a shape's fill) color in the new menus: the
 * current app's presets (transparent drawn as a checkerboard), a picker that
 * writes once the pointer is up, any CSS color or picture link, a reset
 */
const props = defineProps<{
	/** The current value; empty or "none" when unset */
	value: string | undefined
	label: string
	/** Offer a picture link beside colors */
	picture?: boolean
	reset_label: string
}>()

const emit = defineEmits<{ set: [value: string] }>()

const current = () => (props.value && props.value !== 'none' ? props.value : '')

const custom = ref('')
watch(() => props.value, () => { custom.value = current().startsWith('data:') ? '' : current() }, { immediate: true })

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
const picked = ref('#FFFFFF')
watch(() => props.value, () => { if (HEX.test(current())) picked.value = current().toUpperCase() }, { immediate: true })
watch(picked, (value) => { custom.value = value })

function set(value: string) {
	emit('set', value.trim())
}

/** The picker sets its color on the same release, so the write waits a tick */
function pick_start() {
	window.addEventListener('pointerup', () => {
		setTimeout(() => {
			if (picked.value.toUpperCase() !== current().toUpperCase()) set(picked.value)
		})
	}, { once: true, capture: true })
}
</script>

<template>
	<MenuLabel :label="label" />
	<div class="sw">
		<button
			v-for="preset in PRESET_COLORS"
			:key="preset.label"
			type="button"
			class="c"
			:class="{ on: current() === preset.color, clear: preset.color === 'transparent' }"
			:style="preset.color === 'transparent' ? undefined : { background: preset.color }"
			:aria-label="preset.label"
			:data-tip="preset.color === 'transparent' ? t('style.transparent') : preset.label"
			@click="set(preset.color)"
		/>
	</div>
	<div class="pk" @pointerdown.capture="pick_start" @pointerdown.stop @click.stop @keydown.stop>
		<UColorPicker v-model="picked" size="xs" />
	</div>
	<MenuLabel :label="picture ? t('style.cover_custom') : t('style.color_custom')" />
	<form class="cu" @submit.prevent="set(custom)">
		<input
			v-model="custom"
			class="in"
			:placeholder="picture ? t('background.custom_placeholder') : '#1a2b3c, red'"
			spellcheck="false"
			@keydown.stop
		>
		<p class="hn">{{ picture ? t('style.cover_hint') : t('style.color_hint') }}</p>
	</form>
	<MenuItem v-if="current()" icon="tabler:arrow-back-up" :label="reset_label" @select="set('')" />
</template>

<style scoped>
.sw {
	display: grid;
	grid-template-columns: repeat(7, 22px);
	gap: 4px;
	padding: 2px 8px 6px;
}
.c {
	width: 22px;
	height: 22px;
	border-radius: 6px;
	border: 0.5px solid var(--border-strong);
	cursor: pointer;
	padding: 0;
}
/* Transparent reads as such: a checkerboard crossed by a red line */
.c.clear {
	background-color: #fff;
	background-image:
		linear-gradient(to top right, transparent calc(50% - 0.75px), #e5484d calc(50% - 0.75px), #e5484d calc(50% + 0.75px), transparent calc(50% + 0.75px)),
		linear-gradient(45deg, #e4e4e7 25%, transparent 25%),
		linear-gradient(-45deg, #e4e4e7 25%, transparent 25%),
		linear-gradient(45deg, transparent 75%, #e4e4e7 75%),
		linear-gradient(-45deg, transparent 75%, #e4e4e7 75%);
	background-size: 100% 100%, 8px 8px, 8px 8px, 8px 8px, 8px 8px;
	background-position: 0 0, 0 0, 0 4px, 4px -4px, -4px 0;
}
.c.on {
	outline: 2px solid var(--fill-accent);
	outline-offset: 1px;
}
/* The picker draws its square a frame later; its height is kept from the
   start, or the submenu jumps up as it grows (a blink on opening) */
.pk {
	box-sizing: border-box;
	min-height: 160px;
	padding: 2px 8px 6px;
}
.cu {
	padding: 0 6px 6px;
	display: flex;
	flex-direction: column;
	gap: 6px;
}
.in {
	box-sizing: border-box;
	height: 28px;
	padding: 0 8px;
	border: 0.5px solid var(--border-strong);
	border-radius: 6px;
	background: var(--surface-2);
	font: inherit;
	font-size: 12px;
	color: var(--text-primary);
	outline: none;
}
.in:focus {
	border-color: var(--border-accent);
}
.hn {
	margin: 0;
	padding: 0 2px;
	font-size: 11px;
	line-height: 1.4;
	color: var(--text-muted);
	white-space: normal;
}
</style>
