import type { Component } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'

/** Props shared by BoardWidgetShell and MasonryWidgetShell. */
export type WidgetShellVariantProps = {
	widget: FolderContainerWidgetChild
	index: number
	menuComponent: Component
	menuNode: WorkspaceTreeNode
	rootClass?: string | Record<string, boolean>
	allowFrom?: string | false
	ignoreFrom?: string
	minSize?: { width: number; height: number }
	interactionsEnabled?: boolean
	isFolderDropzone?: boolean
	extraStyle?: Record<string, string>
	menuProps?: Record<string, unknown>
}
