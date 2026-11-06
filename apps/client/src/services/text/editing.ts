/**
 * How a note behaves while it is edited, on top of the schema
 * (extensions.ts). The note keeps the meaning its markdown had in the old
 * textarea, where the file is read with `breaks`: Enter starts a new line in
 * the same paragraph (a newline in the file), Enter on an empty line starts
 * a new paragraph (a blank line). A list, a task, a heading or a quote starts
 * by typing its marker at the start of a line, as it did in the file.
 */
import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'

/** What the line-start rule needs of the view (two prosemirror-view copies in the tree disagree on the full type). */
type ViewLike = { state: EditorState; dispatch: (tr: Transaction) => void }

export type NoteEditingOptions = {
	/** Esc: the note leaves editing. */
	on_escape: (() => void) | null
}

const LIST_ITEMS = ['taskItem', 'listItem'] as const

/** The list item the cursor is in, innermost first, or null. */
function list_item_at(editor: Editor): (typeof LIST_ITEMS)[number] | null {
	const { $from } = editor.state.selection
	for (let depth = $from.depth; depth > 0; depth--) {
		const name = $from.node(depth).type.name
		if (name === 'taskItem' || name === 'listItem') return name
	}
	return null
}

/**
 * Enter in a paragraph outside a list. Right after a line break (an empty
 * line, or the start of a line) the paragraph splits there; elsewhere a line
 * break goes in. At the start of a paragraph and in an empty one, Tiptap's
 * own Enter makes a new paragraph.
 */
function enter_as_line_break(editor: Editor): boolean {
	const { state } = editor
	const { $from, empty } = state.selection
	if (!empty || $from.parent.type.name !== 'paragraph') return false
	if (list_item_at(editor)) return false
	if ($from.parentOffset === 0 || $from.parent.content.size === 0) return false
	const before = $from.nodeBefore
	if (before?.type.name === 'hardBreak') {
		const at = $from.pos - before.nodeSize
		const tr = state.tr.delete(at, $from.pos).split(at)
		tr.setSelection(TextSelection.create(tr.doc, at + 2)).scrollIntoView()
		editor.view.dispatch(tr)
		return true
	}
	return editor.commands.setHardBreak()
}

type LineStart =
	| { kind: 'bullet' }
	| { kind: 'ordered'; start: number }
	| { kind: 'task'; checked: boolean }
	| { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6 }
	| { kind: 'quote' }
	| { kind: 'rule' }

/** The block a marker typed at the start of a line opens, given the marker and the key typed after it. */
export function line_start(marker: string, typed: string): LineStart | null {
	if (typed === '-' && (marker === '--' || marker === '—')) return { kind: 'rule' }
	if (typed !== ' ') return null
	if (/^[-+*]$/.test(marker)) return { kind: 'bullet' }
	const ordered = /^(\d{1,9})[.)]$/.exec(marker)
	if (ordered) return { kind: 'ordered', start: Number(ordered[1]) }
	const task = /^\[([ xX]?)\]$/.exec(marker)
	if (task) return { kind: 'task', checked: task[1]!.toLowerCase() === 'x' }
	if (/^#{1,6}$/.test(marker)) return { kind: 'heading', level: marker.length as 1 | 2 | 3 | 4 | 5 | 6 }
	if (marker === '>') return { kind: 'quote' }
	return null
}

/**
 * A marker typed at the start of a line after a line break: the paragraph
 * splits at that break and the new part becomes the block. (At the start of
 * a paragraph Tiptap's own input rules do the same.)
 */
function open_block_after_break(editor: Editor, view: ViewLike, from: number, to: number, typed: string): boolean {
	const { state } = view
	if (from !== to) return false
	const $from = state.doc.resolve(from)
	const paragraph = $from.parent
	if (paragraph.type.name !== 'paragraph' || list_item_at(editor)) return false
	const content_start = $from.start()
	let break_at = -1
	paragraph.forEach((child, offset) => {
		if (child.type.name === 'hardBreak' && content_start + offset < from) break_at = content_start + offset
	})
	if (break_at < 0) return false
	const block = line_start(state.doc.textBetween(break_at + 1, from), typed)
	if (!block) return false
	const after = $from.nodeAfter
	// A line only becomes a rule when nothing follows on it.
	if (block.kind === 'rule' && after && after.type.name !== 'hardBreak') return false

	const tr = state.tr.delete(break_at, from).split(break_at)
	tr.setSelection(TextSelection.create(tr.doc, break_at + 2))
	view.dispatch(tr)
	const chain = editor.chain()
	if (block.kind === 'bullet') chain.toggleBulletList()
	else if (block.kind === 'ordered') {
		chain.toggleOrderedList()
		if (block.start !== 1) chain.updateAttributes('orderedList', { start: block.start })
	} else if (block.kind === 'task') {
		chain.toggleTaskList()
		if (block.checked) chain.updateAttributes('taskItem', { checked: true })
	} else if (block.kind === 'heading') chain.setHeading({ level: block.level })
	else if (block.kind === 'quote') chain.toggleBlockquote()
	else chain.setHorizontalRule()
	chain.run()
	return true
}

export const NoteEditing = Extension.create<NoteEditingOptions>({
	name: 'noteEditing',
	// Before the list items' own Tab and Enter.
	priority: 1000,

	addOptions() {
		return { on_escape: null }
	},

	addKeyboardShortcuts() {
		return {
			'Enter': () => enter_as_line_break(this.editor),
			// Tab nests a list item or types a Tab; it never moves focus out of the note.
			'Tab': () => {
				const item = list_item_at(this.editor)
				if (item) {
					this.editor.commands.sinkListItem(item)
					return true
				}
				return this.editor.commands.insertContent('\t')
			},
			'Shift-Tab': () => {
				const item = list_item_at(this.editor)
				if (item) {
					this.editor.commands.liftListItem(item)
					return true
				}
				const { $from, empty } = this.editor.state.selection
				const before = $from.nodeBefore
				if (empty && before?.isText && before.text?.endsWith('\t')) {
					this.editor.view.dispatch(this.editor.state.tr.delete($from.pos - 1, $from.pos))
				}
				return true
			},
			'Escape': () => {
				this.options.on_escape?.()
				return true
			},
		}
	},

	addProseMirrorPlugins() {
		const editor = this.editor
		return [
			new Plugin({
				key: new PluginKey('noteLineStart'),
				props: {
					handleTextInput: (view, from, to, text) => open_block_after_break(editor, view, from, to, text),
				},
			}),
		]
	},
})
