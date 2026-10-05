import type { WorkspacesListItem } from '@/domain/WorkspacesList'

/** Whether a persisted list item can be opened on this device / session. */
export function is_workspace_available(
	ws: WorkspacesListItem,
	ctx: { is_desktop: boolean; cloud_ids: ReadonlySet<string> },
): boolean {
	switch (ws.type) {
		case 'local': return ctx.is_desktop
		case 'browser': return !ctx.is_desktop
		case 'demo': return true
		case 'cloud': return ctx.cloud_ids.has(ws.id)
	}
}
