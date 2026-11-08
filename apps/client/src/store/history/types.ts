import type { RemoveReceipt } from '@pile-commander/file-manager'
import type { FolderRef } from '@/domain/Drive'
import type { SyncedEntry } from './synced'
import type { Connection, StrokeNode } from '@/domain/Widget'

/** The store a record belongs to, as Drive keys its stores */
export type HistoryStoreRef = { drive_id: string; root_id: string }

/**
 * One attribute of one entry: its stored value before and after the action
 * (null: not set). `look`: written the way a look is (on screen at once,
 * queued per attribute), not after the write
 */
export type AttrStep = {
	kind: 'attr'
	id: string
	name: string
	before: string | null
	after: string | null
	look: boolean
}

/** A text file's whole content: a note's markdown, or a shape's SVG */
export type ContentStep = {
	kind: 'content'
	id: string
	format: 'note' | 'svg'
	before: string
	after: string
}

/**
 * The canvas edges of one folder the action touched (`ids`), as they were
 * and as they became. An id missing from `before` was created, from `after`
 * deleted
 */
export type EdgesStep = {
	kind: 'edges'
	folder_id: string
	ids: string[]
	before: Connection[]
	after: Connection[]
}

/** The ink strokes of one folder the action touched, the same way as edges */
export type StrokesStep = {
	kind: 'strokes'
	folder_id: string
	ids: string[]
	before: StrokeNode[]
	after: StrokeNode[]
}

/** The order of a folder's children: layers, a stack, slides */
export type OrderStep = {
	kind: 'order'
	folder_id: string
	before: string[]
	after: string[]
}

/**
 * How to make a created entry again (redo): its text, an empty folder, a copy
 * of another entry or of a file outside the store (an import on the desktop),
 * or an upload (a file from the browser, or one read from a path)
 */
export type CreateRecipe =
	| { via: 'text'; content: string; format: 'note' | 'svg' | 'plain' }
	| { via: 'folder' }
	| { via: 'copy'; source: string; external: boolean; size?: number }
	| { via: 'upload'; file?: File; path?: string; mime?: string; size: number }

/**
 * An entry the action made. Undo removes it for good while it is untouched
 * (`expect`: the text it holds, its size, or a folder's children by name),
 * otherwise leaves it; redo makes it again by `recipe`, with `xattrs` as it
 * was born
 */
export type CreateStep = {
	kind: 'entry_create'
	id: string
	entry_type: 'file' | 'folder'
	expect: { text?: string; size?: number; children?: string[] }
	xattrs: Record<string, string>
	recipe: CreateRecipe
}

/** An entry renamed or moved within its store: its path before and after */
export type MoveStep = {
	kind: 'entry_move'
	from: string
	to: string
	entry_type: 'file' | 'folder'
}

/**
 * An entry the action sent to the trash: undo brings it back by `receipt`
 * with the edges of its folder's board that went with it (`folder_id`); the
 * receipt is spent then, and redo removes it again and keeps the new one.
 * `sync`: it was in a synced folder, linked to that cloud row then
 */
export type DeleteStep = {
	kind: 'entry_delete'
	id: string
	entry_type: 'file' | 'folder'
	receipt: RemoveReceipt
	folder_id: string
	edges: Connection[]
	sync?: SyncedEntry
}

export type HistoryStep = AttrStep | ContentStep | EdgesStep | StrokesStep | OrderStep | CreateStep | MoveStep | DeleteStep

/**
 * What a store method writes its step into. It is passed explicitly: there is
 * no "current transaction", so a write that does not get one (a background
 * sync, the app's own automatic writes, an undo replaying) records nothing
 */
export type HistoryTx = {
	record(step: HistoryStep): void
}

/**
 * An action outside any store's entries that undoes and redoes itself: a
 * whole cloud workspace to the trash and back, a restore from the trash page.
 * Each side resolves true once done, or says why it could not be
 */
export type CustomAction = {
	undo(): Promise<boolean | { message: string }>
	redo(): Promise<boolean | { message: string }>
}

export type HistoryRecord = {
	id: number
	/** What the person did, as a toast names it after a colon: "перемещение «Note»" */
	label: string
	/** Where it happened: "Показать" opens it, and it names the store the steps belong to */
	folder: FolderRef
	folder_name: string
	steps: HistoryStep[]
	/** Records with the same key merge while they follow each other quickly (arrow-key nudges) */
	merge_key?: string
	/** Said in a toast with "Отменить" once the action is done: "Перенесено: «Note»" */
	notice?: string
	/** A record with no steps that undoes itself */
	custom?: CustomAction
	updated_at: number
}
