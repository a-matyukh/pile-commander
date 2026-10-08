<script setup lang="ts">
import { computed } from 'vue'
import store from '@/store'
import cloud from '@/store/cloud'
import { sync_link_of, sync_now, sync_statuses, unlink_folder } from '@/store/localSync'

const props = defineProps<{
	/** The synced folder's path (the local workspace id). */
	root: string
}>()

const link = computed(() => sync_link_of(props.root))
const status = computed(() => sync_statuses[props.root] ?? null)

/** Synced, but some items failed this pass (they are retried on the next one). */
const has_failures = computed(() => status.value?.phase === 'idle' && status.value.errors.length > 0)

const icon = computed(() => {
	if (!status.value) return 'i-lucide-cloud'
	if (has_failures.value) return 'i-lucide-cloud-alert'
	switch (status.value.phase) {
		case 'syncing': return 'i-lucide-refresh-cw'
		case 'paused': return 'i-lucide-circle-pause'
		case 'error': return 'i-lucide-cloud-off'
		default: return 'i-lucide-cloud-check'
	}
})

const label = computed(() => {
	if (!status.value) return 'Waiting to sync'
	if (has_failures.value) return 'Some items did not sync'
	switch (status.value.phase) {
		case 'syncing': return 'Syncing…'
		case 'paused': return 'Sync paused'
		case 'error': return 'Sync failed'
		default: return 'Synced'
	}
})

function ago(epoch_ms: number): string {
	const minutes = Math.round((Date.now() - epoch_ms) / 60_000)
	if (minutes < 1) return 'just now'
	if (minutes < 60) return `${minutes} min ago`
	return new Date(epoch_ms).toLocaleString()
}

const last_synced = computed(() => {
	const at = status.value?.last_synced_at
	return at ? `Last synced ${ago(at)}` : 'Not synced yet'
})

const cloud_copy = computed(() => cloud.workspaces.find(ws => ws.id === link.value?.workspace_id) ?? null)

function open_cloud_copy() {
	if (cloud_copy.value) void store.load_workspace(cloud_copy.value)
}
</script>

<template>
	<UPopover v-if="link" :content="{ align: 'end', side: 'bottom', sideOffset: 8 }">
		<UButton
			:icon="icon"
			color="neutral"
			variant="ghost"
			size="xs"
			:aria-label="label"
			:title="label"
			:ui="{ leadingIcon: status?.phase === 'syncing' ? 'animate-spin' : '' }"
		/>
		<template #content>
			<div class="flex w-72 flex-col gap-2 p-3 text-sm" role="status" aria-live="polite">
				<div>
					<p class="font-medium">{{ label }}</p>
					<p class="text-xs text-muted">{{ last_synced }}</p>
				</div>
				<p class="text-xs text-muted">
					Changes go both ways between this folder and its cloud copy while the app is open.
				</p>
				<p v-if="status?.message" class="text-xs" :class="status.phase === 'error' ? 'text-error' : ''">
					{{ status.message }}
				</p>
				<p v-if="status?.conflicts.length" class="text-xs">
					{{ status.conflicts.length }} {{ status.conflicts.length === 1 ? 'file was' : 'files were' }} changed on both sides.
					The cloud version kept the name; yours is beside it as a conflicted copy: {{ status.conflicts.slice(-3).join(', ') }}
				</p>
				<p v-if="status?.skipped.length" class="text-xs text-muted">
					{{ status.skipped.length }} {{ status.skipped.length === 1 ? 'item is' : 'items are' }} not synced
					(names the cloud refuses, files over the plan's limit, files left out).
				</p>
				<div v-if="status?.errors.length" class="text-xs text-error">
					<p>{{ status.errors.length }} {{ status.errors.length === 1 ? 'item' : 'items' }} failed and will be retried:</p>
					<p v-for="failure in status.errors.slice(0, 3)" :key="failure.relative" class="truncate" :title="failure.message">
						{{ failure.relative }} — {{ failure.message }}
					</p>
				</div>
				<div class="flex flex-wrap gap-2 pt-1">
					<UButton
						v-if="status?.reason === 'mass_delete_cloud'"
						size="xs"
						color="error"
						:label="`Move ${status.pending_deletes} files to the cloud trash`"
						@click="sync_now(root, { allow_cloud_deletes: true })"
					/>
					<UButton
						v-if="status?.reason === 'mass_delete_local'"
						size="xs"
						color="error"
						:label="`Move ${status.pending_deletes} files here to the Trash`"
						@click="sync_now(root, { allow_local_deletes: true })"
					/>
					<UButton
						size="xs"
						color="neutral"
						variant="outline"
						label="Sync now"
						:disabled="status?.phase === 'syncing'"
						@click="sync_now(root)"
					/>
					<UButton
						v-if="cloud_copy"
						size="xs"
						color="neutral"
						variant="outline"
						label="Open cloud copy"
						@click="open_cloud_copy"
					/>
					<UButton
						size="xs"
						color="neutral"
						variant="ghost"
						label="Turn off Auto-sync"
						@click="unlink_folder(root)"
					/>
				</div>
			</div>
		</template>
	</UPopover>
</template>
