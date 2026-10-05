import { describe, expect, it } from 'vitest'
import { media_unavailable_label } from './mediaUnavailable'

describe('media_unavailable_label', () => {
	it('explains a file too large for public visitors', () => {
		expect(media_unavailable_label('public_file_size')).toBe('Too large to preview on a public board')
	})

	it('does not reveal why the owner ran out of egress', () => {
		expect(media_unavailable_label('egress_budget')).toBe('Media is temporarily unavailable')
		expect(media_unavailable_label('visitor_share')).toBe('Media is temporarily unavailable')
	})

	it('falls back to the generic text', () => {
		expect(media_unavailable_label(null)).toBe('Preview unavailable')
	})
})
