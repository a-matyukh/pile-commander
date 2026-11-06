import { ref } from 'vue'

/** A colour picked in the formatting popup: text or background, by its palette hex. */
export type RecentColor = { kind: 'text' | 'bg'; hex: string }

const KEY = 'pc.text.recent_colors'
const LIMIT = 6

function read(): RecentColor[] {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
		if (!Array.isArray(parsed)) return []
		return parsed.filter((item): item is RecentColor =>
			!!item && (item.kind === 'text' || item.kind === 'bg') && typeof item.hex === 'string',
		).slice(0, LIMIT)
	} catch {
		return []
	}
}

/** The last colours picked, newest first, kept across sessions on this device. */
export const recentColors = ref<RecentColor[]>(typeof localStorage === 'undefined' ? [] : read())

export function rememberColor(color: RecentColor) {
	const next = [color, ...recentColors.value.filter(item => item.kind !== color.kind || item.hex !== color.hex)].slice(0, LIMIT)
	recentColors.value = next
	try {
		localStorage.setItem(KEY, JSON.stringify(next))
	} catch {
		// Private mode or a full store: the list lives for this session only.
	}
}
