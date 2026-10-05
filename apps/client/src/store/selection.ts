import type { SelectionStore } from '@/domain/Store'

export default function makeSelection(): SelectionStore {
	return {
		selection: [] as string[],
		selection_mode: false,
		select(id: string) {
			if (this.selection.includes(id)) return
			this.selection.push(id)
		},
		deselect(id: string) {
			const index = this.selection.indexOf(id)
			if (index !== -1) {
				this.selection.splice(index, 1)
			}
		},
		clear_selection() {
			this.selection.length = 0
		},
		set_selection(ids: string[]) {
			this.selection.length = 0
			for (const id of ids) {
				if (!this.selection.includes(id)) {
					this.selection.push(id)
				}
			}
		},
		is_selected(id: string): boolean {
			return this.selection.includes(id)
		},
		toggle_selection(id: string) {
			if (this.is_selected(id)) {
				this.deselect(id)
			} else {
				this.select(id)
			}
		},
		enter_selection_mode() {
			this.selection_mode = true
		},
		exit_selection_mode() {
			this.selection_mode = false
			this.clear_selection()
		},
		can_select_with_click(event?: { shiftKey?: boolean }): boolean {
			return this.selection_mode || !!event?.shiftKey
		},
	}
}
