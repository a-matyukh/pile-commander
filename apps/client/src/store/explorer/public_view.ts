import { computed, ref } from 'vue'
import cloud from '@/store/cloud'
import { explorer_enabled } from './enabled'
import type { ExplorerPage } from './navigation'

/**
 * A publication (or an author's profile) opened from the Explorer's Hub page
 * shows in the current app's public viewer until the Explorer has folder
 * views (step 3.6). Its "Back to Hub" comes back to the Explorer's Hub page
 */
export const explorer_public_open = computed(() => explorer_enabled.value && !!(
	cloud.publication_view
	|| cloud.public_not_found
	|| cloud.profile_view
	|| cloud.profile_not_found
))

/** The page the Explorer opens when it comes back from the public viewer, instead of the last folder */
export const explorer_return_page = ref<ExplorerPage | null>(null)

export function back_to_explorer_hub(): void {
	cloud.publication_view = null
	cloud.public_not_found = null
	cloud.profile_view = null
	cloud.profile_not_found = null
	explorer_return_page.value = 'hub'
	// The Explorer has no addresses of its own
	if (window.location.pathname !== '/') history.replaceState(null, '', '/')
}
