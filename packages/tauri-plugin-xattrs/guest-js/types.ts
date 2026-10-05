export type Xattr = {
	name: string
	value: string
}

export type PathXattrsEntry = {
	path: string
	name: string
	type: "file" | "folder"
	xattrs: Xattr[]
}

export type FolderWithChildrenXattrs = {
	folder: PathXattrsEntry
	children: PathXattrsEntry[]
}
