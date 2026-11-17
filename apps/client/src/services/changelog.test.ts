import { describe, expect, it } from 'vitest'
import {
	changelog_url,
	compare_versions,
	entries_between,
	group_by_version,
	paragraphs,
	parse_changelog,
	WEB_APP_ORIGIN,
} from './changelog'

const URL_ = 'https://www.pile-commander.app/changelog/changelog.json'
const T = (s: string) => ({ ru: `${s} ru`, en: `${s} en` })

describe('compare_versions', () => {
	it('compares part by part, not as text', () => {
		expect(compare_versions('2.10.0', '2.9.3')).toBe(1)
		expect(compare_versions('2.7.2', '2.7.2')).toBe(0)
		expect(compare_versions('2.7', '2.7.0')).toBe(0)
		expect(compare_versions('v2.7.1', '2.7.2')).toBe(-1)
		expect(compare_versions('2.8.0-beta.1', '2.8.0')).toBe(0)
	})
})

describe('changelog_url', () => {
	it('reads from its own origin on the web and in desktop development', () => {
		expect(changelog_url('https://www.pile-commander.app')).toBe(URL_)
		expect(changelog_url('http://localhost:5173')).toBe('http://localhost:5173/changelog/changelog.json')
	})
	it('reads from the web app in the packaged desktop app', () => {
		expect(changelog_url('tauri://localhost')).toBe(`${WEB_APP_ORIGIN}/changelog/changelog.json`)
	})
})

describe('parse_changelog', () => {
	it('sorts newest first and keeps the written order inside a version', () => {
		const entries = parse_changelog({
			entries: [
				{ version: '2.8.0', title: T('a') },
				{ version: '2.9.0', title: T('b') },
				{ version: '2.8.0', title: T('c') },
			],
		}, URL_)
		expect(entries.map(e => e.title.en)).toEqual(['b en', 'a en', 'c en'])
	})

	it('skips broken entries, not the whole file', () => {
		const entries = parse_changelog({
			entries: [
				null,
				{ version: '2.8.0' },
				{ version: 'soon', title: T('x') },
				{ version: '2.8.0', title: { ru: 'только ru' } },
				{ version: '2.8.0', title: T('ok'), text: { ru: '', en: 'x' } },
			],
		}, URL_)
		expect(entries).toHaveLength(1)
		expect(entries[0]!.text).toBeNull()
	})

	it('resolves media against the changelog folder and tells video from picture', () => {
		const [entry] = parse_changelog({
			entries: [{
				version: '2.8.0',
				title: T('m'),
				media: [
					{ src: '2.8.0/clip.mp4', alt: T('clip') },
					{ src: '2.8.0/shot.png' },
					{ src: 'javascript:alert(1)' },
					{ src: '' },
				],
			}],
		}, URL_)
		expect(entry!.media).toEqual([
			{ src: 'https://www.pile-commander.app/changelog/2.8.0/clip.mp4', kind: 'video', alt: T('clip') },
			{ src: 'https://www.pile-commander.app/changelog/2.8.0/shot.png', kind: 'image', alt: null },
		])
	})

	it('returns nothing for a file of another shape', () => {
		expect(parse_changelog(null, URL_)).toEqual([])
		expect(parse_changelog({ entries: {} }, URL_)).toEqual([])
	})
})

describe('entries_between', () => {
	const entries = parse_changelog({
		entries: ['2.9.0', '2.8.1', '2.8.0', '2.7.2'].map(version => ({ version, title: T(version) })),
	}, URL_)
	it('takes what is newer than the installed version and up to the new one', () => {
		expect(entries_between(entries, '2.7.2', '2.8.1').map(e => e.version)).toEqual(['2.8.1', '2.8.0'])
	})
})

describe('group_by_version', () => {
	it('groups neighbours of one version and takes the first date it finds', () => {
		const entries = parse_changelog({
			entries: [
				{ version: '2.8.0', title: T('a') },
				{ version: '2.8.0', title: T('b'), date: '2026-11-20' },
				{ version: '2.7.0', title: T('c') },
			],
		}, URL_)
		const groups = group_by_version(entries)
		expect(groups.map(g => [g.version, g.date, g.entries.length])).toEqual([
			['2.8.0', '2026-11-20', 2],
			['2.7.0', null, 1],
		])
	})
})

describe('paragraphs', () => {
	it('splits on blank lines', () => {
		expect(paragraphs('One.\nStill one.\n\n  Two.  \n\n\n')).toEqual(['One.\nStill one.', 'Two.'])
	})
})
