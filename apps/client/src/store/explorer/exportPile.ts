import { shallowRef, reactive } from 'vue'
import { t } from '@/i18n'

/**
 * One export of a folder to `.pile`. Its own state, so the panel stays up
 * when the exported workspace is not the open board. The import toast keeps
 * `import_progress` and is not written here.
 */
export type PileExportPhase = 'preparing' | 'downloading' | 'packing' | 'done' | 'error'

export type PileExport = {
	phase: PileExportPhase
	folder_name: string
	/** The archive name, set when the export finishes. Download names stay out. */
	file_name: string
	done: number
	total: number
	message: string
	/** Desktop path of the saved archive. Empty on the web. */
	path: string | null
}

const DONE_MS = 6000

export const pile_export = reactive({ current: null as PileExport | null })

/** The Share button, so the panel sits under it whichever header row holds it. */
export const export_anchor = shallowRef<{ el: HTMLElement; align: 'start' | 'end' } | null>(null)

let hide_timer: ReturnType<typeof setTimeout> | null = null

function clear_timer() {
	if (hide_timer === null) return
	clearTimeout(hide_timer)
	hide_timer = null
}

export function set_export_anchor(anchor: { el: HTMLElement; align: 'start' | 'end' } | null) {
	export_anchor.value = anchor
}

/** Opens the panel at once, before the tree is listed. */
export function begin_pile_export(folder_name: string) {
	clear_timer()
	pile_export.current = {
		phase: 'preparing',
		folder_name,
		file_name: '',
		done: 0,
		total: 0,
		message: '',
		path: null,
	}
}

/** Counts only. A file name from the download is not stored. */
export function pile_export_downloading(done: number, total: number) {
	const current = pile_export.current
	if (!current || current.phase === 'done' || current.phase === 'error') return
	current.phase = 'downloading'
	current.done = done
	current.total = total
}

export function pile_export_packing() {
	const current = pile_export.current
	if (!current || current.phase === 'done' || current.phase === 'error') return
	current.phase = 'packing'
}

export function finish_pile_export(file_name: string, path: string | null) {
	const current = pile_export.current
	if (!current) return
	current.phase = 'done'
	current.file_name = file_name
	current.path = path
	clear_timer()
	hide_timer = setTimeout(() => dismiss_pile_export(), DONE_MS)
}

export function fail_pile_export(message: string) {
	clear_timer()
	const current = pile_export.current
	if (!current) {
		pile_export.current = {
			phase: 'error',
			folder_name: '',
			file_name: '',
			done: 0,
			total: 0,
			message,
			path: null,
		}
		return
	}
	current.phase = 'error'
	current.message = message
}

export function dismiss_pile_export() {
	clear_timer()
	pile_export.current = null
}

export function pile_archive_name(path: string, fallback: string): string {
	const base = path.split(/[/\\]/).pop()
	return base && base.length > 0 ? base : fallback
}

/** The line under the folder name. */
export function pile_export_status(state: PileExport): string {
	switch (state.phase) {
		case 'preparing':
			return t('export.preparing')
		case 'downloading':
			return t('export.downloading', { done: state.done, total: state.total })
		case 'packing':
			return t('export.packing')
		case 'done':
			return t('export.done')
		case 'error':
			return state.message
	}
}

/** Where the archive went, once it is written. */
export function pile_export_saved(state: PileExport): string | null {
	if (state.phase !== 'done') return null
	return state.path
		? t('export.saved_desktop', { name: state.file_name })
		: t('export.saved_downloads', { name: state.file_name })
}

/** Every sentence the panel shows, joined. Download names are not among them. */
export function pile_export_copy(state: PileExport): string {
	const parts = [t('export.title'), state.folder_name, pile_export_status(state)]
	const saved = pile_export_saved(state)
	if (saved) parts.push(saved)
	if (state.phase === 'done' && state.path) parts.push(t('export.show_in_finder'))
	return parts.join('\n')
}

export type PileExportResult = { file_name: string; path: string | null }

/**
 * Runs one export with the panel open from the first line. The desktop save
 * dialog stays outside this call: cancelling it must not open the panel.
 * `work` returns null when there is nothing to show. A thrown error stays on
 * the panel and is not rethrown — the panel is the report.
 */
export async function run_pile_export(
	folder_name: string,
	work: (notify: {
		downloading: (done: number, total: number) => void
		packing: () => void
	}) => Promise<PileExportResult | null>,
): Promise<void> {
	begin_pile_export(folder_name)
	try {
		const result = await work({
			downloading: pile_export_downloading,
			packing: pile_export_packing,
		})
		if (!result) {
			dismiss_pile_export()
			return
		}
		finish_pile_export(result.file_name, result.path)
	} catch (error) {
		fail_pile_export(error instanceof Error ? error.message : String(error))
	}
}

export async function reveal_exported_pile(): Promise<void> {
	const path = pile_export.current?.path
	if (!path) return
	const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
	await revealItemInDir(path)
}
