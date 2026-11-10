import { onMounted, onUnmounted, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import type { EditorTool } from './drawing/types'

export const CANVAS_TOOL_HOTKEYS = {
	hand: 'H',
	select: 'S',
	lasso: 'L',
	connect: 'C',
	disconnect: 'D',
	pen: 'P',
	eraser: 'E',
} as const satisfies Record<EditorTool, string>

const TOOL_BY_KEY: Record<string, EditorTool> = Object.fromEntries(
	Object.entries(CANVAS_TOOL_HOTKEYS).map(([tool, key]) => [key.toLowerCase(), tool]),
) as Record<string, EditorTool>

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false
	if (target.isContentEditable) return true
	const tag = target.tagName
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * The tool for a key press. A Latin letter is taken as typed, so every Latin
 * layout works by its own letters. Anything else (a Cyrillic layout) goes by
 * the key's place, which is where these letters are printed on the keyboard.
 */
export function toolFromHotkey(key: string, code = ''): EditorTool | undefined {
	const letter = /^[a-z]$/i.test(key) ? key : code.startsWith('Key') ? code.slice(3) : ''
	return TOOL_BY_KEY[letter.toLowerCase()]
}

/**
 * Letter hotkeys for canvas editor tools. Inactive in embedded previews,
 * while a note is being edited, and when typing in an input.
 */
export function useCanvasToolShortcuts(options: {
	enabled: MaybeRefOrGetter<boolean>
	editingNoteId: Ref<string | null>
	setTool: (tool: EditorTool) => void
}) {
	function onKeyDown(event: KeyboardEvent) {
		if (!toValue(options.enabled)) return
		if (event.defaultPrevented) return
		if (event.repeat) return
		if (event.metaKey || event.ctrlKey || event.altKey) return
		if (isTypingTarget(event.target)) return
		if (options.editingNoteId.value) return

		const tool = toolFromHotkey(event.key, event.code)
		if (!tool) return

		event.preventDefault()
		options.setTool(tool)
	}

	onMounted(() => {
		window.addEventListener('keydown', onKeyDown)
	})

	onUnmounted(() => {
		window.removeEventListener('keydown', onKeyDown)
	})
}
