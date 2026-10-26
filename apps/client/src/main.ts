import { createApp } from 'vue'
import ui from '@nuxt/ui/vue-plugin'
import AppShell from './ui/app/AppShell.vue'
import { sync_workspaces_list } from './store/workspaces_list'
import cloud from './store/cloud'
import { is_desktop } from './isDesktop'
import { check_for_updates } from './store/updater'
import { browser_storage_available } from './services/workspace/browserStorage'
import { apply_public_route, resolve_public_route, when_not_prerendering } from './services/publicRoute'
import { public_route_deps } from './services/navigatePublic'
import { install_document_title } from './services/documentTitle'
import { notify_demo_embed_ready } from './services/demoEmbed'
import { strip_empty_location_hash } from './services/cloud/stripEmptyLocationHash'
import './modelViewer'
import './main.css'
import 'virtual:offline-icons'

async function bootstrap() {
	// Omnibox prerender runs this document hidden; wait until the user
	// confirms the URL (Enter) so we do not touch storage before they do.
	await when_not_prerendering()

	// Cached session only. A token refresh talks to Supabase and must not
	// hold the shell — local workspaces start reading disk as soon as we mount.
	await cloud.init()
	// Pruning bookmarks stats every folder. A disconnected network volume
	// can hang that stat; the sidebar updates when it finishes.
	void sync_workspaces_list().catch((error) => {
		console.error('[workspaces] failed to prune missing folders', error)
	})
	strip_empty_location_hash()

	// Leftover keys from the removed desktops experiment. Nothing reads them.
	localStorage.removeItem('desktops_state')
	localStorage.removeItem('pile_commander_experimental_desktops')

	if (is_desktop) {
		void check_for_updates().catch((error) => {
			console.error('[updater] failed to check for updates', error)
		})
	} else if (browser_storage_available()) {
		// ask the browser not to evict workspace data under storage pressure
		void navigator.storage?.persist?.().catch(() => {
			// best-effort: some browsers reject or lack the API
		})
	}

	// URL routes: /demo opens the demo workspace, /hub the gallery,
	// /invite/<token> a pending share, /<username> a profile page,
	// /<username>/<slug> a public workspace
	// read-only (anon included); anything else is the regular app.
	apply_public_route(resolve_public_route(window.location.pathname), public_route_deps())
	install_document_title()

	const app = createApp(AppShell)

	app.config.errorHandler = (err, instance, info) => {
		console.error('[app]', info, err)
	}

	app.use(ui)
	app.mount('#app')
	notify_demo_embed_ready()
}

void bootstrap()
