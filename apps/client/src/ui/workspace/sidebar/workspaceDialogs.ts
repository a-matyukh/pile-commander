import { inject, type InjectionKey } from 'vue'

export type WorkspaceDialogs = {
	open_publish: (workspace_id: string) => void
	open_share: (workspace_id: string) => void
	open_trash: (workspace_id: string) => void
}

export const workspaceDialogsKey: InjectionKey<WorkspaceDialogs> = Symbol('workspaceDialogs')

export function useWorkspaceDialogs(): WorkspaceDialogs {
	const dialogs = inject(workspaceDialogsKey)
	if (!dialogs) {
		throw new Error('workspace dialogs are not provided')
	}
	return dialogs
}
