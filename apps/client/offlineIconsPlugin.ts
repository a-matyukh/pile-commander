import { createRequire } from 'node:module'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import type { IconifyIcon, IconifyJSON } from '@iconify/types'
import type { Plugin } from 'vite'

const require = createRequire(import.meta.url)

/** Longest prefix first so `material-symbols-light` wins over `material-symbols`. */
export const ICON_COLLECTIONS = [
	'material-symbols-light',
	'material-symbols',
	'lucide',
	'tabler',
	'lsicon',
	'weui',
	'mdi',
	'fa',
	'ri',
	'la',
] as const

type IconCollection = (typeof ICON_COLLECTIONS)[number]

type IconRef = {
	prefix: IconCollection
	icon: string
}

type CollectionSubset = {
	prefix: string
	width?: number
	height?: number
	icons: Record<string, IconifyIcon>
}

const ICON_STRING_RE = new RegExp(
	`['"\`]((?:i-)?(?:${ICON_COLLECTIONS.join('|')})[:\-][a-z0-9-]+)['"\`]`,
	'g',
)

const NUXT_UI_LUCIDE_ICONS = [
	'arrow-down',
	'arrow-left',
	'arrow-right',
	'arrow-up',
	'arrow-up-right',
	'check',
	'chevron-down',
	'chevron-left',
	'chevron-right',
	'chevron-up',
	'chevrons-left',
	'chevrons-right',
	'circle-alert',
	'circle-check',
	'circle-x',
	'copy',
	'copy-check',
	'ellipsis',
	'eye',
	'eye-off',
	'file',
	'folder',
	'folder-open',
	'grip-vertical',
	'hash',
	'info',
	'lightbulb',
	'loader-circle',
	'menu',
	'minus',
	'monitor',
	'moon',
	'panel-left-close',
	'panel-left-open',
	'plus',
	'rotate-ccw',
	'search',
	'square',
	'sun',
	'triangle-alert',
	'upload',
	'x',
] as const

const VIRTUAL_ID = 'virtual:offline-icons'
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`

export function parseIconRef(raw: string): IconRef | null {
	const name = raw.startsWith('i-') ? raw.slice(2) : raw
	let prefix: string
	let icon: string
	if (name.includes(':')) {
		const idx = name.indexOf(':')
		prefix = name.slice(0, idx)
		icon = name.slice(idx + 1)
	} else {
		const found = ICON_COLLECTIONS.find((collection) => name.startsWith(`${collection}-`))
		if (!found) return null
		prefix = found
		icon = name.slice(found.length + 1)
	}
	if (!icon || !isIconCollection(prefix)) return null
	return { prefix, icon }
}

function isIconCollection(prefix: string): prefix is IconCollection {
	return (ICON_COLLECTIONS as readonly string[]).includes(prefix)
}

function walkSourceFiles(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules' || entry.startsWith('.')) continue
		const full = join(dir, entry)
		if (statSync(full).isDirectory()) {
			walkSourceFiles(full, files)
			continue
		}
		if (!/\.(vue|ts|js)$/.test(entry)) continue
		if (entry.endsWith('.test.ts') || entry.endsWith('.test.js')) continue
		files.push(full)
	}
	return files
}

function collectIconRefs(srcDir: string): IconRef[] {
	const refs = new Map<string, IconRef>()
	const add = (raw: string) => {
		const parsed = parseIconRef(raw)
		if (!parsed) return
		const key = `${parsed.prefix}:${parsed.icon}`
		if (!refs.has(key)) refs.set(key, parsed)
	}

	for (const name of NUXT_UI_LUCIDE_ICONS) add(`lucide:${name}`)

	for (const file of walkSourceFiles(srcDir)) {
		const source = readFileSync(file, 'utf8')
		ICON_STRING_RE.lastIndex = 0
		for (const match of source.matchAll(ICON_STRING_RE)) {
			if (match[1]) add(match[1])
		}
	}
	return [...refs.values()]
}

function loadCollection(prefix: IconCollection): IconifyJSON {
	return require(`@iconify-json/${prefix}/icons.json`) as IconifyJSON
}

function resolveIconData(collection: IconifyJSON, icon: string): IconifyIcon | null {
	if (collection.icons[icon]) return collection.icons[icon]
	const alias = collection.aliases?.[icon]
	if (!alias?.parent) return null
	const parent = collection.icons[alias.parent]
	if (!parent) return null
	const { parent: _parent, ...overrides } = alias
	return { ...parent, ...overrides }
}

export function offlineIconsPlugin(srcDir: string): Plugin {
	let collections: Record<IconCollection, IconifyJSON> | undefined
	const loadCollections = (): Record<IconCollection, IconifyJSON> => {
		collections ??= Object.fromEntries(
			ICON_COLLECTIONS.map((prefix) => [prefix, loadCollection(prefix)]),
		) as Record<IconCollection, IconifyJSON>
		return collections
	}

	const generate = (): string => {
		const data = loadCollections()
		const byPrefix = new Map<string, CollectionSubset>()
		const missing: string[] = []

		for (const ref of collectIconRefs(srcDir)) {
			const collection = data[ref.prefix]
			const icon = collection ? resolveIconData(collection, ref.icon) : null
			if (!icon) {
				missing.push(`${ref.prefix}:${ref.icon}`)
				continue
			}
			let bucket = byPrefix.get(ref.prefix)
			if (!bucket) {
				bucket = {
					prefix: ref.prefix,
					width: collection.width,
					height: collection.height,
					icons: {},
				}
				byPrefix.set(ref.prefix, bucket)
			}
			bucket.icons[ref.icon] = icon
		}

		if (missing.length > 0) {
			throw new Error(
				`[offline-icons] missing icon data: ${missing.join(', ')}. Install the collection or fix the name.`,
			)
		}

		const modules = [...byPrefix.values()]
			.map((collection) => `addCollection(${JSON.stringify(collection)})`)
			.join('\n')

		return `import { addCollection } from '@iconify/vue'\n${modules}\n`
	}

	return {
		name: 'offline-icons',
		resolveId(id) {
			if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID
		},
		load(id) {
			if (id === RESOLVED_VIRTUAL_ID) return generate()
		},
		configureServer(server) {
			server.watcher.on('change', (file) => {
				if (!file.includes(`${sep}src${sep}`) || !/\.(vue|ts|js)$/.test(file)) return
				const mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID)
				if (mod) void server.reloadModule(mod)
			})
		},
		buildStart() {
			for (const file of walkSourceFiles(srcDir)) {
				this.addWatchFile(file)
			}
		},
	}
}

export function listOfflineIconRefs(srcDir: string): string[] {
	return collectIconRefs(srcDir).map((ref) => `${ref.prefix}:${ref.icon}`).sort()
}

export function assertOfflineIcons(srcDir: string): string[] {
	const data = Object.fromEntries(
		ICON_COLLECTIONS.map((prefix) => [prefix, loadCollection(prefix)]),
	) as Record<IconCollection, IconifyJSON>
	const missing: string[] = []
	for (const ref of collectIconRefs(srcDir)) {
		if (!resolveIconData(data[ref.prefix], ref.icon)) {
			missing.push(`${ref.prefix}:${ref.icon}`)
		}
	}
	return missing
}
