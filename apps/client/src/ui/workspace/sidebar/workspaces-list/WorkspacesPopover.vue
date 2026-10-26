<script setup lang="ts">
import { ref } from 'vue'
import type { TabsItem } from '@nuxt/ui'
import WorkspacesList from './WorkspacesList.vue'
import AccountPanel from './AccountPanel.vue'
import SettingsPanel from './SettingsPanel.vue'
import DesktopUpdateControls from '@/ui/app/DesktopUpdateControls.vue'

defineProps<{
	content?: {
		side?: 'top' | 'right' | 'bottom' | 'left'
		align?: 'start' | 'center' | 'end'
		onOpenAutoFocus?: (event: Event) => void
	}
}>()

const emit = defineEmits<{
	/** Fullscreen app has no window to replace; the host shows Hub in-place. */
	hub: []
	opened: []
}>()

const open = defineModel<boolean>('open', { default: false })
const tab = ref('workspaces')

const tab_items: TabsItem[] = [
	{ label: 'Workspaces', value: 'workspaces', slot: 'workspaces' },
	{ label: 'My account', value: 'account', slot: 'account' },
	{ label: 'Settings', value: 'settings', slot: 'settings' },
]

function on_opened() {
	open.value = false
	emit('opened')
}

function open_hub() {
	open.value = false
	emit('hub')
}
</script>

<template>
	<UPopover v-model:open="open" :content="content">
		<slot />
		<template #content>
			<div class="flex max-h-[32rem] w-80 flex-col overflow-hidden">
				<div class="min-h-0 flex-1 overflow-y-auto p-2">
					<UTabs
						v-model="tab"
						:items="tab_items"
						variant="link"
						size="sm"
						class="w-full gap-0"
						:ui="{ list: 'w-full' }"
					>
						<template #list-trailing>
							<UButton
								label="Hub"
								icon="i-lucide:compass"
								color="neutral"
								variant="ghost"
								size="sm"
								class="ml-auto"
								@click="open_hub"
							/>
						</template>
						<template #workspaces>
							<WorkspacesList @opened="on_opened" @account="tab = 'account'" />
						</template>
						<template #account>
							<AccountPanel :show_desktop_update="false" />
						</template>
						<template #settings>
							<SettingsPanel />
						</template>
					</UTabs>
				</div>
				<div
					v-if="is_desktop"
					class="flex shrink-0 items-center justify-between gap-2 border-t border-default px-2 py-1.5"
				>
					<DesktopUpdateControls />
				</div>
			</div>
		</template>
	</UPopover>
</template>
