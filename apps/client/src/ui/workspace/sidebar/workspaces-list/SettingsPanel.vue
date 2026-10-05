<script setup lang="ts">
import store from '@/store'
import cloud from '@/store/cloud'
import { desktops_enabled } from '@/store/experiments'
import { supabase } from '@/services/cloud/client'
import { mark_desktops_opt_in } from '@/services/cloud/desktopsExperiment'

// No VITE_LANDING_URL, no link (same rule as AuthForm): a dead link would be
// worse than plain text
const landing_url = (import.meta.env.VITE_LANDING_URL as string | undefined)
	?.trim()
	.replace(/\/$/, '') || null
const feedback_url = landing_url ? `${landing_url}/feedback` : null

function set_desktops(enabled: boolean) {
	desktops_enabled.value = enabled
	if (!enabled) {
		// leave desktops mode; desktops and windows stay stored
		store.exit_desktops_mode()
		return
	}
	// best-effort mark for the experiment report — never blocks the switch
	if (supabase && cloud.user) {
		void mark_desktops_opt_in(supabase).catch((error) => {
			console.error('[desktops] failed to mark the experiment opt-in', error)
		})
	}
}
</script>

<template>
	<div class="flex flex-col gap-3 p-2">
		<section class="flex flex-col gap-2">
			<h3 class="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
				<UIcon name="i-lucide:flask-conical" class="size-3.5 shrink-0" />
				Experimental
			</h3>

			<div class="flex flex-col gap-2 rounded-md border border-default p-2.5">
				<p class="text-xs leading-relaxed text-muted">
					<strong class="font-semibold text-default">Desktops and windows</strong>
					may overlap with what workspaces and folder previews already do, so this
					feature may be removed in the future. If it is, nothing will be lost: your
					desktops' folders and files will become regular workspaces.
					<template v-if="feedback_url">
						Tell us how you use it on the
						<a :href="feedback_url" target="_blank" rel="noopener noreferrer" class="text-primary underline">Feedback page</a>.
					</template>
					<template v-else>
						Tell us how you use it on the Feedback page.
					</template>
				</p>

				<USwitch
					:model-value="desktops_enabled"
					label="Show desktops and windows"
					size="sm"
					@update:model-value="set_desktops"
				/>
			</div>
		</section>
	</div>
</template>
