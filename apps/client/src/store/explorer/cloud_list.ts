import cloud from '@/store/cloud'
import { on_cloud_workspaces_synced } from '@/store/workspaces_list'

/**
 * The cloud's top-level folders come from fetch_workspaces. Until its first
 * answer, cloud.workspaces is empty: "not loaded yet", not "no folders".
 * The sync hook fires only when a fetch finishes, so remember having seen one
 */
let synced = false
on_cloud_workspaces_synced(() => { synced = true })

/** How long to wait for the first list before showing what there is */
const WAIT_MS = 10_000

export async function cloud_workspaces_ready(): Promise<void> {
	if (!cloud.user) return
	if (!cloud.is_loading && (synced || cloud.workspaces.length > 0)) return
	await new Promise<void>(resolve => {
		const timer = setTimeout(done, WAIT_MS)
		const stop = on_cloud_workspaces_synced(done)
		function done() {
			clearTimeout(timer)
			stop()
			resolve()
		}
	})
}
