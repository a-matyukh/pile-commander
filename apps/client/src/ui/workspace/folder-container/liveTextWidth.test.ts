import { describe, expect, test } from 'vitest'
import { computed } from 'vue'
import { clear_live_text_width, is_text_width_live, set_live_text_width } from './liveTextWidth'

describe('live text width', () => {
	test('a block is live from the first drag move until it is cleared', () => {
		expect(is_text_width_live('/ws/Text 1.md')).toBe(false)
		set_live_text_width('/ws/Text 1.md', 120)
		expect(is_text_width_live('/ws/Text 1.md')).toBe(true)
		expect(is_text_width_live('/ws/Text 2.md')).toBe(false)
		clear_live_text_width('/ws/Text 1.md')
		expect(is_text_width_live('/ws/Text 1.md')).toBe(false)
	})

	test('a block that reads it re-renders when the drag starts and ends', () => {
		const wraps = computed(() => is_text_width_live('/ws/Text 3.md'))
		expect(wraps.value).toBe(false)
		set_live_text_width('/ws/Text 3.md', 90)
		expect(wraps.value).toBe(true)
		clear_live_text_width('/ws/Text 3.md')
		expect(wraps.value).toBe(false)
	})
})
