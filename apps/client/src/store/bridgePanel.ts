import type { PlanLimits } from '@pile-commander/file-manager'
import type { CopyTreeProgress } from '@/services/cloud/bridge/copyTree'
import { is_blocked, selected_bytes, type BridgeFile, type BridgePreflight } from '@/services/cloud/bridge/preflight'
import { locale, t } from '@/i18n'
import { format_bytes } from '@/utils/format_bytes'
import type { BridgeDoor, BridgeStep } from '@/store/bridge'

/** Files from this size get a checkbox, next to the refused and the left-out ones. */
export const HEAVY_BYTES = 1024 * 1024
const LIST_LIMIT = 100

/** The anchored bridge panel. The sync popover uses the same width while the steps are in it. */
export const BRIDGE_PANEL_WIDTH = 320

/** How long the "done" line stays, the same pause as the export panel. */
export const BRIDGE_DONE_MS = 6000

export type BridgePanelInput = {
	door: BridgeDoor
	step: BridgeStep
	source_name: string
	preflight: BridgePreflight | null
	exclude: readonly string[]
	pro: PlanLimits | null
	pro_step: 'idle' | 'asking' | 'sent'
	resumable: boolean
	copied: boolean
	progress: CopyTreeProgress | null
	error: string | null
	plan: string | null
}

export type BridgeFileRow = {
	relative: string
	label: string
	included: boolean
	disabled: boolean
}

/** The three numbers of the measured folder. */
export type BridgeStats = {
	size: string
	count: string
	count_label: string
	largest: string | null
	largest_label: string | null
}

/** The cloud space bar: what is taken, what this folder adds, what is left. Fractions of the quota. */
export type BridgeMeter = {
	plan: string
	used: number
	adding: number
	over: boolean
	free_line: string
	per_file: string
	pro_line: string | null
}

/**
 * Everything the panel says for one state.
 */
export type BridgePanelView = {
	title: string
	source_name: string
	step: BridgeStep
	lead: string
	note: string
	file_name: string | null
	error: string | null
	summary: string | null
	plan_line: string | null
	stats: BridgeStats | null
	meter: BridgeMeter | null
	/** Sync goes both ways, a copy only up. */
	direction: 'both' | 'up'
	fit_line: string | null
	files: BridgeFileRow[]
	resumable_note: string | null
	copied_note: string | null
	copied_action: 'sync' | 'open' | null
	pro_step: 'idle' | 'asking' | 'sent'
	primary: string | null
	primary_disabled: boolean
	show_pro: boolean
	track: 'slide' | 'share' | null
	fraction: number
}

/** sync and device live in the sync popover. */
export function bridge_in_sync_menu(door: BridgeDoor): boolean {
	return door === 'sync' || door === 'device'
}

/** share and publish sit under the Share button. */
export function bridge_in_share_panel(door: BridgeDoor): boolean {
	return door === 'share' || door === 'publish'
}

/** list and tile, the old list doors, use the device sentences. */
function wording(door: BridgeDoor): 'share' | 'publish' | 'device' | 'sync' {
	if (door === 'share' || door === 'publish' || door === 'sync') return door
	return 'device'
}

function plural_form(n: number): 'one' | 'few' | 'many' {
	const mod10 = n % 10
	const mod100 = n % 100
	if (locale.value === 'en') return n === 1 ? 'one' : 'many'
	return mod10 === 1 && mod100 !== 11 ? 'one' : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20) ? 'few' : 'many'
}

function count_files(n: number): string {
	return t(`bridge.count_${plural_form(n)}`, { n })
}

function fraction(part: number, whole: number): number {
	if (whole <= 0) return part > 0 ? 1 : 0
	return Math.max(0, Math.min(1, part / whole))
}

export function bridge_title(door: BridgeDoor): string {
	return t(`bridge.title_${wording(door)}`)
}

function lead_of(door: BridgeDoor): string {
	return t(`bridge.lead_${wording(door)}`)
}

function plan_name(plan: string): string {
	if (plan === 'free') return t('bridge.plan_free')
	if (plan === 'pro') return t('bridge.plan_pro')
	return plan.charAt(0).toUpperCase() + plan.slice(1)
}

function kind_label(kind: BridgeFile['kind']): string {
	return t(`bridge.kind_${kind}`)
}

function refusal(file: BridgeFile, preflight: BridgePreflight): string | null {
	if (file.bad_name) return t('bridge.blocked_name')
	if (file.over_file_limit) return t('bridge.blocked_size', { size: format_bytes(preflight.limits.max_file_bytes) })
	return null
}

function heavy_files(preflight: BridgePreflight, excluded: ReadonlySet<string>): BridgeFileRow[] {
	return preflight.files
		.filter(file => is_blocked(file) || excluded.has(file.relative) || file.size_bytes >= HEAVY_BYTES)
		.sort((a, b) => b.size_bytes - a.size_bytes)
		.slice(0, LIST_LIMIT)
		.map(file => ({
			relative: file.relative,
			label: refusal(file, preflight) ?? format_bytes(file.size_bytes),
			included: !excluded.has(file.relative),
			disabled: is_blocked(file),
		}))
}

function fraction_of(done: number, total: number): number {
	if (total <= 0) return 0
	return Math.min(1, done / total)
}

/**
 * Tooltip on the sync or share button while a copy of this folder is running
 * and the panel is hidden. Null when the button should stay as it is.
 */
export function bridge_hidden_tip(
	input: {
		open: boolean
		step: BridgeStep
		door: BridgeDoor
		source_id: string | null
		progress: CopyTreeProgress | null
	},
	folder_id: string,
	host: 'sync' | 'share',
): string | null {
	if (input.open || input.step !== 'copying' || input.source_id !== folder_id) return null
	const mine = host === 'sync' ? bridge_in_sync_menu(input.door) : input.door === 'share' || input.door === 'publish'
	if (!mine) return null
	const progress = input.progress
	return t('bridge.uploading_tip', {
		done: progress?.files_done ?? 0,
		total: progress?.total_files ?? 0,
	})
}

export function bridge_panel_view(input: BridgePanelInput): BridgePanelView {
	const door = wording(input.door)
	const preflight = input.preflight
	const excluded = new Set(input.exclude)
	const wall = !!preflight && (preflight.over_quota || preflight.blocked.length > 0)
	const selected = preflight ? selected_bytes(preflight.files, excluded) : 0
	const fits = !!preflight && selected <= preflight.free_bytes
	const base: BridgePanelView = {
		title: bridge_title(input.door),
		source_name: input.source_name,
		step: input.step,
		lead: '',
		note: '',
		file_name: null,
		error: null,
		summary: null,
		plan_line: null,
		stats: null,
		meter: null,
		direction: door === 'sync' ? 'both' : 'up',
		fit_line: null,
		files: [],
		resumable_note: null,
		copied_note: null,
		copied_action: null,
		pro_step: input.pro_step,
		primary: null,
		primary_disabled: false,
		show_pro: false,
		track: null,
		fraction: 0,
	}

	if (input.step === 'auth') {
		return { ...base, lead: lead_of(input.door), note: t('bridge.sign_in_note') }
	}
	if (input.step === 'measuring') {
		return { ...base, note: t('bridge.measuring'), track: 'slide' }
	}
	if (input.step === 'error') {
		return { ...base, note: input.error ?? '', error: input.error }
	}
	if (input.step === 'copying') {
		const progress = input.progress
		if (progress?.phase === 'folders') {
			return {
				...base,
				note: t('bridge.folders', { done: progress.folders_done, total: progress.total_folders }),
				track: 'share',
				fraction: fraction_of(progress.folders_done, progress.total_folders),
			}
		}
		const files_done = progress?.files_done ?? 0
		const total_files = progress?.total_files ?? 0
		return {
			...base,
			note: t('bridge.files', { done: files_done, total: total_files }),
			file_name: progress?.current ?? null,
			track: 'share',
			fraction: progress ? fraction_of(progress.loaded_bytes, progress.total_bytes) : 0,
		}
	}
	if (input.step === 'done') {
		return {
			...base,
			note: door === 'sync' ? t('bridge.done_sync') : t('bridge.done_copy'),
			primary: door === 'sync' ? t('bridge.open_cloud') : t('bridge.open'),
		}
	}
	if (!preflight) return base

	const largest = preflight.largest
		? `, ${t('bridge.largest', { size: format_bytes(preflight.largest.size_bytes), kind: kind_label(preflight.largest.kind) })}`
		: ''
	const summary = `${format_bytes(preflight.total_bytes)}, ${count_files(preflight.files.length)}${largest}.`
	const plan = input.plan
	const own = plan
		? t('bridge.plan', {
			plan: plan_name(plan),
			quota: format_bytes(preflight.limits.quota_bytes),
			per_file: format_bytes(preflight.limits.max_file_bytes),
			free: format_bytes(preflight.free_bytes),
		})
		: ''
	const pro = input.pro
		? ` · ${t('bridge.plan_pro', { quota: format_bytes(input.pro.quota_bytes), per_file: format_bytes(input.pro.max_file_bytes) })}`
		: ''
	const quota = preflight.limits.quota_bytes
	const taken = Math.max(0, quota - preflight.free_bytes)
	const stats: BridgeStats = {
		size: format_bytes(preflight.total_bytes),
		count: String(preflight.files.length),
		count_label: t(`bridge.files_${plural_form(preflight.files.length)}`),
		largest: preflight.largest ? format_bytes(preflight.largest.size_bytes) : null,
		largest_label: preflight.largest ? t('bridge.stat_largest', { kind: kind_label(preflight.largest.kind) }) : null,
	}
	const meter: BridgeMeter | null = plan
		? {
			plan: plan_name(plan),
			used: fraction(taken, quota),
			adding: Math.min(fraction(selected, quota), 1 - fraction(taken, quota)),
			over: !fits,
			free_line: t('bridge.meter_free', { free: format_bytes(preflight.free_bytes), quota: format_bytes(quota) }),
			per_file: t('bridge.meter_per_file', { size: format_bytes(preflight.limits.max_file_bytes) }),
			pro_line: input.pro && plan !== 'pro'
				? t('bridge.meter_pro', { quota: format_bytes(input.pro.quota_bytes), per_file: format_bytes(input.pro.max_file_bytes) })
				: null,
		}
		: null
	let primary = t('bridge.copy')
	if (input.resumable) primary = t('bridge.resume')
	else if (door === 'sync') primary = wall ? t('bridge.sync_without') : t('bridge.start_sync')
	else if (wall) primary = t('bridge.copy_without')
	else if (input.copied) primary = t('bridge.copy_again')

	return {
		...base,
		lead: lead_of(input.door),
		error: input.error,
		summary,
		plan_line: own ? `${own}${pro}` : null,
		stats,
		meter,
		fit_line: wall
			? fits
				? t('bridge.fits', { size: format_bytes(selected) })
				: t('bridge.over', { size: format_bytes(Math.max(0, selected - preflight.free_bytes)) })
			: null,
		files: wall ? heavy_files(preflight, excluded) : [],
		resumable_note: input.resumable ? t('bridge.resumable') : null,
		copied_note: !input.resumable && input.copied ? t('bridge.already') : null,
		copied_action: !input.resumable && input.copied ? (door === 'sync' ? 'sync' : 'open') : null,
		primary,
		primary_disabled: !fits,
		show_pro: wall && !!input.pro && input.pro_step === 'idle',
	}
}

/** Every sentence the panel shows, joined. A file name appears only once its upload has started. */
export function bridge_panel_text(view: BridgePanelView): string {
	const parts = [
		view.title,
		view.source_name,
		view.lead,
		view.note,
		view.file_name,
		view.error,
		view.summary,
		view.plan_line,
		view.fit_line,
		view.resumable_note,
		view.copied_note,
		view.primary,
	]
	for (const file of view.files) parts.push(file.relative, file.label)
	return parts.filter((part): part is string => !!part).join('\n')
}
