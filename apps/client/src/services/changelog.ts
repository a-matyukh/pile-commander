/**
 * "What's new": the changes written for people, not the commit list.
 *
 * The entries live in `apps/client/public/changelog/changelog.json`, written
 * by hand, with pictures and videos beside it in the same folder. The web
 * build serves the file with its deploy; the desktop app reads it from the
 * web app's address, so an installed app learns what the next version brings
 * before it installs it.
 *
 * ```json
 * {
 *   "entries": [
 *     {
 *       "version": "2.8.0",
 *       "date": "2026-11-20",
 *       "title": { "ru": "Что нового", "en": "What's new" },
 *       "text": { "ru": "Абзац.\n\nЕщё абзац.", "en": "A paragraph.\n\nAnother one." },
 *       "media": [{ "src": "2.8.0/clip.mp4", "alt": { "ru": "…", "en": "…" } }]
 *     }
 *   ]
 * }
 * ```
 *
 * One entry is one change; a version may have several or none. `text` and
 * `media` are optional; `src` is relative to the changelog folder; `.mp4` and
 * `.webm` play as a muted looping video, anything else shows as a picture.
 * A blank line in `text` starts a new paragraph. An entry with a broken shape
 * is skipped, not the whole file.
 */

export type Localized = { ru: string; en: string }

export type ChangelogMedia = {
	/** Absolute URL, resolved against the changelog folder */
	src: string
	kind: 'image' | 'video'
	alt: Localized | null
}

export type ChangelogEntry = {
	version: string
	date: string | null
	title: Localized
	text: Localized | null
	media: ChangelogMedia[]
}

/** The public web app; the desktop app reads the changelog from here. */
export const WEB_APP_ORIGIN = 'https://www.pile-commander.app'

const CHANGELOG_PATH = '/changelog/changelog.json'

/**
 * Where the changelog is read from. A page served over http(s) (the web app,
 * and the desktop app in development) uses its own origin; the packaged
 * desktop app, served from `tauri://`, the public web app.
 */
export function changelog_url(location_origin: string): string {
	const own = /^https?:\/\//.test(location_origin)
	return `${own ? location_origin : WEB_APP_ORIGIN}${CHANGELOG_PATH}`
}

/** `2.10.0` > `2.9.3`; a missing part counts as 0, anything after `-` is ignored. */
export function compare_versions(a: string, b: string): number {
	const parts = (v: string) => v.replace(/^v/, '').split('-')[0]!.split('.').map(n => Number.parseInt(n, 10) || 0)
	const pa = parts(a)
	const pb = parts(b)
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0)
		if (d !== 0) return d < 0 ? -1 : 1
	}
	return 0
}

function localized(value: unknown): Localized | null {
	if (!value || typeof value !== 'object') return null
	const { ru, en } = value as Record<string, unknown>
	if (typeof ru !== 'string' || typeof en !== 'string') return null
	if (!ru.trim() || !en.trim()) return null
	return { ru, en }
}

const VIDEO = /\.(mp4|webm)(\?|#|$)/i

function media_of(value: unknown, base: string): ChangelogMedia[] {
	if (!Array.isArray(value)) return []
	const out: ChangelogMedia[] = []
	for (const item of value) {
		if (!item || typeof item !== 'object') continue
		const raw = (item as Record<string, unknown>).src
		if (typeof raw !== 'string' || !raw.trim()) continue
		let src: string
		try {
			src = new URL(raw, base).href
		} catch {
			continue
		}
		if (!/^https?:/.test(src)) continue
		out.push({
			src,
			kind: VIDEO.test(src) ? 'video' : 'image',
			alt: localized((item as Record<string, unknown>).alt),
		})
	}
	return out
}

/**
 * The entries of a changelog file, newest version first. `url` is where the
 * file was read from: media paths resolve against it.
 */
export function parse_changelog(data: unknown, url: string): ChangelogEntry[] {
	const list = (data as { entries?: unknown } | null)?.entries
	if (!Array.isArray(list)) return []
	const out: ChangelogEntry[] = []
	for (const raw of list) {
		if (!raw || typeof raw !== 'object') continue
		const item = raw as Record<string, unknown>
		const version = typeof item.version === 'string' ? item.version.trim().replace(/^v/, '') : ''
		const title = localized(item.title)
		if (!/^\d+(\.\d+)*/.test(version) || !title) continue
		out.push({
			version,
			date: typeof item.date === 'string' && item.date.trim() ? item.date.trim() : null,
			title,
			text: localized(item.text),
			media: media_of(item.media, url),
		})
	}
	// Stable: entries of one version keep the order they were written in.
	return out
		.map((entry, i) => ({ entry, i }))
		.sort((a, b) => compare_versions(b.entry.version, a.entry.version) || a.i - b.i)
		.map(({ entry }) => entry)
}

/** Entries newer than `from` and no newer than `to`: what an update from `from` to `to` brings. */
export function entries_between(entries: ChangelogEntry[], from: string, to: string): ChangelogEntry[] {
	return entries.filter(e => compare_versions(e.version, from) > 0 && compare_versions(e.version, to) <= 0)
}

/** Entries grouped by version, newest first, in the order they were written. */
export function group_by_version(entries: ChangelogEntry[]): { version: string; date: string | null; entries: ChangelogEntry[] }[] {
	const groups: { version: string; date: string | null; entries: ChangelogEntry[] }[] = []
	for (const entry of entries) {
		const last = groups[groups.length - 1]
		if (last && last.version === entry.version) {
			last.entries.push(entry)
			last.date ??= entry.date
		} else {
			groups.push({ version: entry.version, date: entry.date, entries: [entry] })
		}
	}
	return groups
}

/** Paragraphs of an entry's text: split on blank lines. */
export function paragraphs(text: string): string[] {
	return text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
}

export async function fetch_changelog(url: string, fetcher: typeof fetch = fetch): Promise<ChangelogEntry[]> {
	const response = await fetcher(url, { cache: 'no-cache' })
	if (!response.ok) throw new Error(`changelog: HTTP ${response.status}`)
	return parse_changelog(await response.json(), url)
}
