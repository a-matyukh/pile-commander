export
type WorkspaceType = "local" | "cloud" | "demo" | "browser"

export
type WorkspacesList = WorkspacesListItem[]

export
type WorkspacesListItem = {
	id: string
	type: WorkspaceType
	name: string
}
