<script setup lang="ts" generic="T extends string | number | boolean">
import { MINIS, type MiniKey } from './settings_minis'

/** A choice shown as small previews of the window */
defineProps<{
	options: { value: T; label: string; mini: MiniKey }[]
	disabled?: boolean
}>()

const model = defineModel<T>({ required: true })
</script>

<template>
	<div class="segv" :class="{ dis: disabled }">
		<button
			v-for="o in options"
			:key="String(o.value)"
			type="button"
			class="vo"
			:class="{ on: model === o.value }"
			:disabled="disabled"
			@click="model = o.value"
		>
			<span class="mini">
				<span
					v-for="(r, i) in MINIS[o.mini]"
					:key="i"
					class="q"
					:style="{ left: r[0] + 'px', top: r[1] + 'px', width: r[2] + 'px', height: r[3] + 'px', background: r[4], borderRadius: r[5] + 'px' }"
				/>
			</span>
			<span>{{ o.label }}</span>
		</button>
	</div>
</template>

<style scoped>
.segv {
	display: flex;
	gap: 6px;
	flex-wrap: wrap;
	flex: none;
}
.vo {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 5px;
	padding: 5px 5px 4px;
	border-radius: 9px;
	border: 1.5px solid transparent;
	background: none;
	font: inherit;
	cursor: pointer;
	font-size: 11px;
	color: var(--text-secondary);
	white-space: nowrap;
}
.vo.on {
	border-color: var(--fill-accent);
	color: var(--text-primary);
}
.mini {
	position: relative;
	display: block;
	width: 76px;
	height: 48px;
	border: 0.5px solid var(--border-strong);
	border-radius: 5px;
	background: #fff;
	overflow: hidden;
}
.q {
	position: absolute;
	display: block;
}
.segv.dis .vo {
	cursor: default;
	color: var(--text-muted);
}
.segv.dis .vo.on {
	border-color: var(--border-strong);
}
.segv.dis .mini {
	filter: grayscale(1);
	opacity: .45;
}
.explorer.lg .vo {
	font-size: 12px;
}
@media (hover: hover) {
	.segv:not(.dis) .vo:hover {
		background: var(--surface-1);
	}
}
</style>
