import type { FolderRef } from '@/domain/Drive'
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

export type HistoryStep = AttrStep | ContentStep | EdgesStep | StrokesStep | OrderStep

/**
 * What a store method writes its step into. It is passed explicitly: there is
 * no "current transaction", so a write that does not get one (a background
 * sync, the app's own automatic writes, an undo replaying) records nothing
 */
export type HistoryTx = {
	record(step: HistoryStep): void
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
	updated_at: number
}
