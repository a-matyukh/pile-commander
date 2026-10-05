<script setup lang="ts">
import { ref } from 'vue'
import type { TabsItem } from '@nuxt/ui'
import WorkspacesList from './WorkspacesList.vue'
import AccountPanel from './AccountPanel.vue'
import SettingsPanel from './SettingsPanel.vue'
import DesktopUpdateControls from '@/ui/desktop/DesktopUpdateControls.vue'
import desktops from '@/store/desktops'
import { useWindowContext } from '@/ui/window/windowContext'

const props = withDefaults(
	defineProps<{
		/**
		 * `replace` — open into the current window / fullscreen app (header button).
		 * `new-window` — always open a new desktop window (Start menu).
		 */
		open_as?: 'replace' | 'new-window'
		content?: {
			side?: 'top' | 'right' | 'bottom' | 'left'
			align?: 'start' | 'center' | 'end'
			onOpenAutoFocus?: (event: Event) => void
		}
	}>(),
	{ open_as: 'replace' },
)

const emit = defineEmits<{
	/** Fullscreen app has no window to replace; the host shows Hub in-place. */
	hub: []
	opened: []
}>()

const open = defineModel<boolean>('open', { default: false })
const window_ctx = useWindowContext()
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
	if (props.open_as === 'new-window') {
		desktops.open_window({ kind: 'hub' })
		return
	}
	if (window_ctx) {
		desktops.set_window_content(window_ctx.window_id, { kind: 'hub' })
		return
	}
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
							<WorkspacesList :open_as="open_as" @opened="on_opened" @account="tab = 'account'" />
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
