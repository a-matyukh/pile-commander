import { createApp } from 'vue'
import ui from '@nuxt/ui/vue-plugin'
import DesktopShell from './ui/desktop/DesktopShell.vue'
import desktops, { prune_missing_desktop_windows } from './store/desktops'
import { sync_workspaces_list } from './store/workspaces_list'
import cloud from './store/cloud'
import { desktops_enabled } from './store/experiments'
import { is_desktop } from './isDesktop'
import { prune_orphaned_desktop_folders } from './services/desktop/desktopFolders'
import { check_for_updates } from './store/updater'
import {
	browser_storage_available,
	prune_orphaned_browser_desktops,
} from './services/desktop/browserDesktopFolders'
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
	// confirms the URL (Enter) so we do not leak windows via localStorage.
	await when_not_prerendering()

	// Cached session only. A token refresh talks to Supabase and must not
	// hold the shell — local windows start reading disk as soon as we mount.
	await cloud.init()
	// Pruning bookmarks stats every folder. A disconnected network volume
	// can hang that stat; the sidebar updates when it finishes.
	void sync_workspaces_list().catch((error) => {
		console.error('[workspaces] failed to prune missing folders', error)
	})
	strip_empty_location_hash()

	// Desktops are opt-in (store/experiments.ts): a desktops mode saved before
	// the switch went off starts as the fullscreen app. Desktops stay stored.
	if (!desktops_enabled.value && desktops.mode === 'desktops') desktops.exit_to_fullscreen()

	// GC: desktop children folders whose desktops no longer exist (e.g. after
	// a localStorage reset). Never blocks startup.
	if (is_desktop) {
		void check_for_updates().catch((error) => {
			console.error('[updater] failed to check for updates', error)
		})
		void prune_orphaned_desktop_folders(desktops.desktops.map(d => d.id))
			.catch((error) => {
				console.error('[desktops] failed to prune orphaned folders', error)
			})
		// drop windows whose local folders were moved/deleted outside the app
		void prune_missing_desktop_windows(desktops)
			.catch((error) => {
				console.error('[desktops] failed to prune windows with missing folders', error)
			})
	} else if (browser_storage_available()) {
		void prune_orphaned_browser_desktops(desktops.desktops.map(d => d.id))
			.catch((error) => {
				console.error('[desktops] failed to prune orphaned browser folders', error)
			})
		// ask the browser not to evict desktop data under storage pressure
		void navigator.storage?.persist?.().catch(() => {
			// best-effort: some browsers reject or lack the API
		})
	}

	// URL routes: /demo opens the demo workspace, /hub the gallery,
	// /invite/<token> a pending share, /<username> a profile page,
	// /<username>/<slug> a public workspace
	// read-only (anon included); anything else is the regular app.
	// In desktops mode a route opens as a new window instead, and the
	// address bar resets to the app root.
	apply_public_route(resolve_public_route(window.location.pathname), public_route_deps())
	install_document_title()

	const app = createApp(DesktopShell)

	app.config.errorHandler = (err, instance, info) => {
		console.error('[app]', info, err)
	}

	app.use(ui)
	app.mount('#app')
	notify_demo_embed_ready()
}

void bootstrap()
