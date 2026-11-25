/** What the menus name for the shortcut modifier: ⌘ on a Mac, Ctrl elsewhere */
const on_mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** "⌘C" or "Ctrl+C": the hint of a menu row whose key is the modifier plus a letter */
export function mod_key_hint(letter: string): string {
	return on_mac ? `⌘${letter}` : `Ctrl+${letter}`
}

/** The same as `kbds` of a selection menu item */
export function mod_kbds(letter: string): string[] {
	return on_mac ? ['meta', letter] : ['Ctrl', letter]
}
