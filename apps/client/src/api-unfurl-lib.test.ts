import { describe, expect, it } from 'vitest'
import {
	APP_TITLE,
	HUB_TITLE,
	build_unfurl_meta,
	inject_unfurl_tags,
	unfurl_route,
} from '../api/unfurl-lib.ts'

describe('api unfurl-lib', () => {
	it('maps public paths', () => {
		expect(unfurl_route('/hub')).toEqual({ kind: 'hub' })
		expect(unfurl_route('/matyukh/momo')).toEqual({
			kind: 'slug',
			username: 'matyukh',
			slug: 'momo',
		})
		expect(unfurl_route('/assets/index.js')).toEqual({ kind: 'none' })
	})

	it('builds a Hub card and injects it once', () => {
		const meta = build_unfurl_meta(
			{ kind: 'hub' },
			null,
			'https://www.pile-commander.app/',
			'',
		)
		expect(meta.title).toBe(HUB_TITLE)
		const html = inject_unfurl_tags(
			'<!doctype html><html><head><title>Pile Commander</title></head><body></body></html>',
			meta,
		)
		expect(html).toContain(`<title>${HUB_TITLE}</title>`)
		expect(html.match(/<title>/g)?.length).toBe(1)
	})

	it('does not leak a name when the board is missing', () => {
		const meta = build_unfurl_meta(
			{ kind: 'slug', username: 'x', slug: 'y' },
			null,
			'https://www.pile-commander.app',
			'',
		)
		expect(meta.title).toBe(APP_TITLE)
	})
})
