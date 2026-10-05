import type { WorkspaceStore } from '@/domain/Store'

/**
 * Returns the loaded workspace.
 * For code paths that only run with an open workspace (widget actions,
 * tree interactions); throws a descriptive error instead of a silent `!`.
 */
export function requireWorkspace(): WorkspaceStore {
	const ws = store.workspace
	if (!ws) {
		throw new Error('Workspace is not loaded')
	}
	return ws
}
