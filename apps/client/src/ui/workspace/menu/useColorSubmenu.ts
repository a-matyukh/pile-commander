import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Color } from '@/domain/Widget'
import { isEmbeddedDataUrl } from '@/ui/workspace/folder-container/widgets/resolveBackground'
import { useWorkspace } from '@/ui/workspace/useWorkspace'

export const PRESET_COLORS: { label: string; color: Color }[] = [
	{ label: 'Transparent', color: 'transparent' },
	{ label: 'White', color: '#FFFFFF' },
	{ label: 'Gray', color: 'var(--pc-gray-muted)' },
	{ label: 'Slate', color: 'var(--pc-gray-header)' },
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

const PICKER_HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export type ColorMenuMode = 'background' | 'cover' | 'shape_fill'

/**
 * Menu item with a CSS swatch in `swatch` — not Nuxt UI's semantic `color`
 * prop (hex / `transparent` crash its color parser).
 */
export type ColorSwatchMenuItem = Omit<DropdownMenuItem, 'color' | 'children'> & {
	swatch?: string
	children?: ColorSwatchMenuItem[]
}

type ColorSubmenuOptions = {
	label: string
	entityId: string
	mode: ColorMenuMode
	currentColor?: Color
	/** Extra "color or image URL" input — folder pane and desktop backgrounds. */
	includeCustomValue?: boolean
	/** Override persist (desktop xattrs). Empty string means reset. */
	apply?: (value: string) => void | Promise<void>
	/** When set, replaces the workspace `can_write` check. */
	disabled?: boolean
}

export function useColorSubmenu(options: MaybeRefOrGetter<ColorSubmenuOptions | null>) {
	const workspace = useWorkspace()
	const pickerColor = ref('#FFFFFF')
	const customValue = ref('')

	watch(
		() => toValue(options)?.currentColor,
		(color) => {
			customValue.value = color && color !== 'none' ? color : ''
			if (color && PICKER_HEX_RE.test(color.trim())) {
				pickerColor.value = color
			}
		},
		{ immediate: true },
	)

	function restoreCustomValue() {
		const opts = toValue(options)
		customValue.value = opts?.currentColor && opts.currentColor !== 'none'
			? opts.currentColor
			: ''
	}

	async function apply(color: Color) {
		const opts = toValue(options)
		if (!opts) return

		if (isEmbeddedDataUrl(color)) {
			restoreCustomValue()
			return
		}

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

	function onPickerPointerDown() {
		window.addEventListener('pointerup', commitPickerColor, { once: true })
	}

	function commitPickerColor() {
		const opts = toValue(options)
		if (!opts || pickerColor.value === opts.currentColor) return
		void apply(pickerColor.value)
	}

	function commitCustomValue() {
		const opts = toValue(options)
		if (!opts) return
		const value = customValue.value.trim()
		const current = opts.currentColor && opts.currentColor !== 'none'
			? opts.currentColor
			: ''
		if (value === current) return
		void apply(value)
	}

	const colorMenuItem = computed<ColorSwatchMenuItem | null>(() => {
		const opts = toValue(options)
		if (!opts) return null

		const children: ColorSwatchMenuItem[] = [
			{
				label: 'Presets',
				slot: 'preset-colors' as const,
				onSelect(e: Event) {
					e.preventDefault()
				},
			},
			{
				label: 'Custom color',
				slot: 'color-picker' as const,
				onSelect(e: Event) {
					e.preventDefault()
				},
			},
		]

		if (opts.includeCustomValue) {
			children.push({
				label: 'Color or image URL',
				slot: 'background-value' as const,
				onSelect(e: Event) {
					e.preventDefault()
				},
			})
		}

		return {
			label: opts.label,
			disabled: opts.disabled ?? workspace.value?.can_write === false,
			children,
		}
	})

	return {
		colorMenuItem,
		pickerColor,
		onPickerPointerDown,
		commitPickerColor,
		customValue,
		commitCustomValue,
		applyColor: apply,
	}
}
