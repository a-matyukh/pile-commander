import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Color } from '@/domain/Widget'
import { isBlockedFillText } from '@/ui/workspace/folder-container/widgets/resolveBackground'
import { useWorkspace } from '@/ui/workspace/useWorkspace'

export const PRESET_COLORS: { label: string; color: Color }[] = [
	{ label: 'Transparent', color: 'transparent' },
	{ label: 'White', color: '#FFFFFF' },
	// Fixed grays: the surface tokens are both 96% lightness and read as one swatch.
	{ label: 'Gray', color: '#E5E7EB' },
	{ label: 'Slate', color: '#94A3B8' },
	{ label: 'Cream', color: '#FEF3C7' },
	{ label: 'Rose', color: '#FECACA' },
	{ label: 'Pink', color: '#FBCFE8' },
	{ label: 'Lavender', color: '#DDD6FE' },
	{ label: 'Blue', color: '#BFDBFE' },
	{ label: 'Green', color: '#BBF7D0' },
	{ label: 'Mint', color: '#99F6E4' },
	{ label: 'Yellow', color: '#FDE68A' },
	{ label: 'Peach', color: '#FED7AA' },
	{ label: 'Stone', color: '#E7E5E4' },
]

export type ColorMenuMode = 'background' | 'cover' | 'shape_fill'

type ColorSubmenuOptions = {
	label: string
	entityId: string
	mode: ColorMenuMode
	currentColor?: Color
	/** Override persist (desktop xattrs). Empty string means reset. */
	apply?: (value: string) => void | Promise<void>
	/** When set, replaces the workspace `can_write` check. */
	disabled?: boolean
}

export function useColorSubmenu(options: MaybeRefOrGetter<ColorSubmenuOptions | null>) {
	const workspace = useWorkspace()

	async function apply(color: Color) {
		const opts = toValue(options)
		if (!opts) return

		if (isBlockedFillText(color)) return

		if (opts.apply) {
			await opts.apply(color)
			return
		}

		const ws = workspace.value
		if (!ws) return

		const value = color.trim() === '' ? 'none' : color

		if (opts.mode === 'background') {
			await ws.change_background(opts.entityId, value)
		} else if (opts.mode === 'shape_fill') {
			await ws.change_shape_fill(opts.entityId, value)
		} else {
			await ws.change_cover(opts.entityId, value)
		}
	}

	const colorMenuItem = computed<DropdownMenuItem | null>(() => {
		const opts = toValue(options)
		if (!opts) return null
		return {
			label: opts.label,
			disabled: opts.disabled ?? workspace.value?.can_write === false,
		}
	})

	return {
		colorMenuItem,
		applyColor: apply,
	}
}
