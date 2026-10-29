<script setup lang="ts">
const model = defineModel<boolean>({ required: true })
</script>

<template>
	<button type="button" role="switch" class="sw" :class="{ on: model }" :aria-checked="model" @click="model = !model">
		<span class="kn" />
	</button>
</template>

<style scoped>
.sw {
	position: relative;
	width: 32px;
	height: 18px;
	flex: none;
	padding: 0;
	border: none;
	border-radius: 9px;
	background: var(--border-stronger);
	cursor: pointer;
	transition: background .15s;
}
.sw.on {
	background: var(--fill-accent);
}
.kn {
	position: absolute;
	top: 2px;
	left: 2px;
	width: 14px;
	height: 14px;
	border-radius: 50%;
	background: #fff;
	box-shadow: 0 1px 2px rgba(0, 0, 0, .2);
	transition: transform .15s;
}
.sw.on .kn {
	transform: translateX(14px);
}
.explorer.lg .sw {
	width: 40px;
	height: 22px;
	border-radius: 11px;
}
.explorer.lg .kn {
	width: 18px;
	height: 18px;
}
.explorer.lg .sw.on .kn {
	transform: translateX(18px);
}
</style>
