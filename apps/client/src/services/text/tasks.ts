/**
 * A task item's line: optional quote markers, a bullet, then `[ ]` or `[x]`
 * and a space. The same shape the note's parser treats as a task (an ordered
 * `1. [ ]` is not one there), so the n-th match here is the n-th checkbox in
 * the rendered note.
 */
const TASK_LINE = /^((?:[ \t]*>)*[ \t]*[-*+][ \t]+\[)([ xX])(\][ \t])/
const FENCE = /^(?:[ \t]*>)*[ \t]*(`{3,}|~{3,})/

/**
 * Ticks or unticks the task at `index` (counting task items in document order,
 * the way the rendered note's checkboxes are ordered) by changing that one
 * character. The rest of the file stays byte for byte. Null when there is no
 * such task. Fenced code is skipped: a `- [ ]` inside it is text, not a task.
 */
export function toggle_task(markdown: string, index: number, checked: boolean): string | null {
	const lines = markdown.split('\n')
	let fence: string | null = null
	let seen = -1
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!
		const open = FENCE.exec(line)
		if (open) {
			const marker = open[1]!
			if (fence === null) fence = marker
			else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null
			continue
		}
		if (fence !== null) continue
		if (!TASK_LINE.test(line)) continue
		seen++
		if (seen !== index) continue
		lines[i] = line.replace(TASK_LINE, `$1${checked ? 'x' : ' '}$3`)
		return lines.join('\n')
	}
	return null
}
