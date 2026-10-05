<script setup lang="ts">
import { computed } from 'vue'
import { entry_clipboard } from '@/store/entryClipboard'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'

withDefaults(defineProps<{
	/** Lift the banner above the desktop taskbar (`h-12`). */
	above_taskbar?: boolean
}>(), { above_taskbar: false })

const requireWorkspace = useRequireWorkspace()
const ws = requireWorkspace()

// the entry clipboard is global: the banner shows on every surface while
// entries wait to be pasted
const clip = computed(() => entry_clipboard.current)

const visible = computed(() => (clip.value?.entry_ids.length ?? 0) > 0)

const countLabel = computed(() => {
	const current = clip.value
	if (!current) return ''
	const n = current.entry_ids.length
	const noun = n === 1 ? 'entry' : 'entries'
	const verb = current.mode === 'cut' ? 'cut' : 'copied'
	return `${n} ${noun} ${verb}`
})

const canPaste = computed(() => {
	const current = clip.value
	if (!current?.entry_ids.length) return false
	if (!ws.can_write) return false
	// cut is a no-op in the source folder of the source store
	if (
		current.mode === 'cut'
		&& current.source_store === ws
		&& ws.opened_folder_id === current.source_folder_id
	) {
		return false
	}
	return true
})

function pasteHere() {
	void ws.paste()
}
</script>

<template>
	<div
		v-if="visible"
		class="clipboard-banner board-no-drag"
		:class="{ 'clipboard-banner--above-taskbar': above_taskbar }"
		@click.stop
		@pointerdown.stop
	>
		<span class="clipboard-banner__label">{{ countLabel }}</span>
		<button
			v-if="canPaste"
			type="button"
			class="clipboard-banner__paste"
			@click="pasteHere"
		>
			Paste here
			<span class="clipboard-banner__kbds hidden md:inline-flex">
				<UKbd value="meta" size="sm" />
				<UKbd value="V" size="sm" />
			</span>
		</button>
	</div>
</template>

<style scoped>
.clipboard-banner {
	position: absolute;
	bottom: 0.5rem;
	left: 0.5rem;
	z-index: 20;
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
	max-width: calc(100% - 1rem);
	min-height: 32px;
	padding: 0.25rem 0.625rem;
	border: 1px solid rgba(0, 0, 0, 0.1);
	border-radius: 0.375rem;
	background: #fefefe;
	color: #111827;
	font-size: 12px;
	box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
	user-select: none;
	-webkit-user-select: none;
}

.clipboard-banner--above-taskbar {
	/* taskbar is h-12; keep the same 0.5rem gap above it */
	bottom: 3.5rem;
}

.clipboard-banner__label {
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.clipboard-banner__paste {
	display: inline-flex;
	align-items: center;
	gap: 0.375rem;
	flex-shrink: 0;
	padding: 0.125rem 0.5rem;
	border: 1px solid rgba(0, 0, 0, 0.12);
	border-radius: 0.25rem;
	background: var(--pc-gray-muted);
	color: inherit;
	font: inherit;
	cursor: pointer;
}

.clipboard-banner__paste:hover {
	background: var(--pc-gray-border);
}

.clipboard-banner__kbds {
	gap: 0.125rem;
}
</style>
