import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { ContextMenuItem } from '@nuxt/ui'
import type { Desktop } from '@/domain/Desktop'
import desktops from '@/store/desktops'
import { useColorSubmenu } from '@/ui/workspace/menu/useColorSubmenu'

/**
 * Desktop-management menu items. New/rename/remove live on the tab strip.
 * `standalone_items` — the whole surface menu when there is no desktop
 * board (web / children unavailable). Snap/grid write desktop.xattrs
 * from the Grid submenu. The grid size is a numeric input through the
 * `grid-size` slot of the surface's own UContextMenu. Background uses
 * the same submenu as folders (presets + picker + URL input).
 *
 * When a board is present, Background lives on FolderContainerCtxMenu
 * via `backgroundOverride` — this composable is only the no-board menu.
 */
export function useDesktopMenuItems(desktop: MaybeRefOrGetter<Desktop>) {
	const grid_size = computed(() => toValue(desktop).xattrs.grid ?? 20)

	function on_grid_size_change(value: string | number) {
		const parsed = typeof value === 'number' ? value : Number(value)
		if (!Number.isFinite(parsed) || parsed < 1) return
		desktops.update_desktop_xattrs(toValue(desktop).id, { grid: parsed })
	}

	function snap_item(): ContextMenuItem {
		return {
			label: 'Snap to grid',
			icon: 'i-lucide:grid-3x3',
			type: 'checkbox',
			checked: toValue(desktop).xattrs.snap_to_grid ?? false,
			onSelect: (e: Event) => e.preventDefault(),
			onUpdateChecked: (checked: boolean) =>
				desktops.update_desktop_xattrs(toValue(desktop).id, { snap_to_grid: checked }),
		}
	}

	const colorSubmenuOptions = computed(() => ({
		label: 'Background',
		entityId: toValue(desktop).id,
		mode: 'background' as const,
		currentColor: toValue(desktop).xattrs.background,
		includeCustomValue: true,
		apply: (value: string) => {
			desktops.update_desktop_xattrs(toValue(desktop).id, {
				background: value.trim() || undefined,
			})
		},
		disabled: false,
	}))

	const {
		colorMenuItem,
		pickerColor,
		onPickerPointerDown,
		commitPickerColor,
		customValue,
		commitCustomValue,
		applyColor,
	} = useColorSubmenu(colorSubmenuOptions)

	const standalone_items = computed<ContextMenuItem[]>(() => {
		const background = colorMenuItem.value
		return [
			...(background ? [background as ContextMenuItem] : []),
			{
				label: 'Grid',
				icon: 'i-lucide:grid-3x3',
				children: [
					snap_item(),
					{
						label: 'Grid size',
						icon: 'i-lucide:ruler',
						slot: 'grid-size',
						onSelect: (e: Event) => e.preventDefault(),
					},
				],
			},
		]
	})

	return {
		standalone_items,
		grid_size,
		on_grid_size_change,
		pickerColor,
		onPickerPointerDown,
		commitPickerColor,
		customValue,
		commitCustomValue,
		applyColor,
	}
}
