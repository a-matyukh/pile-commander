import { ref } from 'vue'
import { addCollection, iconLoaded } from '@iconify/vue'

/**
 * The icons a folder can take. The recommended ones are in the build (the
 * offline icons plugin picks up the names below); searching loads all of
 * tabler's once, from the app itself, so it works offline too
 */
export const RECOMMENDED_ICONS = [
	'tabler:folder',
	'tabler:star',
	'tabler:heart',
	'tabler:bookmark',
	'tabler:flag',
	'tabler:bulb',
	'tabler:rocket',
	'tabler:target',
	'tabler:briefcase',
	'tabler:building',
	'tabler:home',
	'tabler:user',
	'tabler:users',
	'tabler:school',
	'tabler:book',
	'tabler:notebook',
	'tabler:pencil',
	'tabler:palette',
	'tabler:brush',
	'tabler:camera',
	'tabler:photo',
	'tabler:movie',
	'tabler:music',
	'tabler:microphone',
	'tabler:code',
	'tabler:terminal-2',
	'tabler:database',
	'tabler:cloud',
	'tabler:world',
	'tabler:map-pin',
	'tabler:plane',
	'tabler:car',
	'tabler:calendar',
	'tabler:clock',
	'tabler:checklist',
	'tabler:chart-bar',
	'tabler:coin',
	'tabler:shopping-cart',
	'tabler:gift',
	'tabler:package',
	'tabler:tool',
	'tabler:settings',
	'tabler:lock',
	'tabler:archive',
	'tabler:leaf',
	'tabler:paw',
	'tabler:coffee',
	'tabler:device-gamepad-2',
]

/** All of tabler's names once loaded; `ready` turns true then */
let all: Promise<string[]> | null = null
const ready = ref(false)

export function load_all_icons(): Promise<string[]> {
	all ??= import('@iconify-json/tabler/icons.json').then(({ default: json }) => {
		addCollection(json)
		ready.value = true
		return [...Object.keys(json.icons), ...Object.keys(json.aliases ?? {})].sort().map(name => `tabler:${name}`)
	})
	return all
}

/**
 * The icon to draw for a chosen one: itself once it is loaded, a folder
 * until then (its set loads in the background)
 */
export function shown_icon(name: string): string {
	if (ready.value || iconLoaded(name)) return name
	void load_all_icons().catch(() => {})
	return 'tabler:folder'
}

/** Names with every word of the query; those starting with it first */
export function search_icons(names: readonly string[], query: string, limit = 60): string[] {
	const words = query.trim().toLowerCase().split(/[\s-]+/).filter(Boolean)
	if (!words.length) return []
	const found = names.filter(name => words.every(word => name.slice(7).includes(word)))
	const first = words[0]!
	found.sort((a, b) => Number(!a.slice(7).startsWith(first)) - Number(!b.slice(7).startsWith(first)))
	return found.slice(0, limit)
}
