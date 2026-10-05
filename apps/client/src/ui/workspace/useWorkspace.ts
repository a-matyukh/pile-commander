import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue'
import type { WorkspaceStore } from '@/domain/Store'
import store from '@/store'

const workspaceStoreKey: InjectionKey<ComputedRef<WorkspaceStore | null>> = Symbol('workspaceStore')

/** Called by the window chrome (and implicitly by the fullscreen root) */
export function provideWorkspaceStore(workspace: ComputedRef<WorkspaceStore | null>) {
	provide(workspaceStoreKey, workspace)
}

/**
 * Workspace of the current window. Falls back to the global store.workspace
 * so components keep working in the fullscreen (single-workspace) mode.
 */
export function useWorkspace(): ComputedRef<WorkspaceStore | null> {
	return inject(workspaceStoreKey, null) ?? computed(() => store.workspace)
}

/**
 * Window-aware replacement for requireWorkspace: the inject is resolved at
 * setup time, the returned getter is safe to call from event handlers.
 */
export function useRequireWorkspace(): () => WorkspaceStore {
	const workspace = useWorkspace()
	return () => {
		const ws = workspace.value
		if (!ws) {
			throw new Error('Workspace is not loaded')
		}
		return ws
	}
}
