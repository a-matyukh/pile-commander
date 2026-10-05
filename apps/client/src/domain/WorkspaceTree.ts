export
type WorkspaceTree = WorkspaceTreeNode[]

export
type WorkspaceTreeNode = {
	id: string
	type: "file" | "folder"
	name: string
	children?: WorkspaceTreeNode[]
	children_loaded?: boolean
}
