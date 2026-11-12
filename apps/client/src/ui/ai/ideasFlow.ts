import { computed, reactive, ref, watch } from 'vue'
import type { WorkspaceStore } from '@/domain/Store'
import type { Position } from '@/domain/Widget'
import { count_notes, t } from '@/i18n'
import { ai_chat, explain_chat_error } from '@/services/ai/client'
import { is_abort_error } from '@/services/ai/errors'
import { build_idea_messages, idea_note, parse_ideas, type Idea } from '@/services/ai/ideas'
import { add_new_notes, NEW_NOTE_SIZE, new_note_positions, planned_note_names, type NewNoteOutcome } from '@/services/ai/newNotes'
import { model_label } from '@/services/ai/presets'
import { collect_summary_sources, coverage_line } from '@/services/ai/summarize'
import { signal_agent_proposal } from '@/services/mcp/attention'
import { basename_of } from '@/services/mcp/path'
import { close_proposal } from '@/services/mcp/proposal'
import { confirm_create } from '@/services/mcp/propose_create'
import type { CreateRowResult } from '@/services/mcp/types'
import { to_folder_container } from '@/services/workspace/folderContainer'
import { ai_settings, vision_support } from '@/store/ai'
import { ensure_ai_consent } from '@/store/aiConsent'
import { close_ideas, ideas_on_board, ideas_session, type IdeaRow } from '@/store/aiIdeas'
import { record_action } from '@/store/history'

/**
 * The new-notes session behind its three views: the dialog, and on a Board
 * or a Canvas the cards in place (`IdeaGhosts`) with their bar (`IdeasBar`).
 * One session at a time, so its state lives here, not in a component.
 */

/** `ask`: the model's wish field, nothing asked yet. */
export type IdeasPhase = 'ask' | 'reading' | 'writing' | 'review' | 'applying' | 'done'

export const ideas_flow = reactive({
	phase: 'review' as IdeasPhase,
	notice: null as string | null,
	error: null as string | null,
	prompt: '',
	read: 0,
	coverage: null as string | null,
	truncated: false,
})

let controller: AbortController | null = null
let next_key = 0
/**
 * The session (its `run`) that has shown on a board: leaving the board
 * cancels it, and it never moves into the dialog meanwhile.
 */
const shown_on_board_run = ref(-1)

/** The dialog shows the session: not on a board, and never one that was. */
export const ideas_in_dialog = computed(() => ideas_session.open
	&& !ideas_on_board.value
	&& shown_on_board_run.value !== ideas_session.run)

export const ideas_rows = computed(() => ideas_session.rows)
export const ideas_from_model = computed(() => ideas_session.source === 'model')
export const ideas_busy = computed(() => ideas_flow.phase === 'reading' || ideas_flow.phase === 'writing')

function sibling_names(): string[] {
	return (ideas_session.workspace?.resolve_folder_data(ideas_session.folder_id)?.children ?? []).map(child => child.name)
}

/** What each note will be called: a taken name, or one repeated here, gets ` (1)`. */
export const ideas_planned = computed(() => planned_note_names(ideas_rows.value.map(row => row.name), sibling_names()))
export const ideas_to_add = computed(() => ideas_rows.value.filter(row => row.checked && row.status === 'ready'))

export const ideas_title = computed(() => ideas_from_model.value
	? t('ideas.title', { name: ideas_session.board_name })
	: (ideas_session.client_name || t('ideas.agent')))
export const ideas_description = computed(() => ideas_from_model.value
	? model_label(ai_settings.value.model)
	: ideas_session.reason)

export function idea_title_of(name: string): string {
	return name.replace(/\.md$/i, '')
}

/** Where `count` new notes go: from the anchor, right of what the folder holds, or wherever the folder puts them. */
function places(ws: WorkspaceStore, folder_id: string, count: number): (Position | null)[] {
	const folder = ws.resolve_folder_data(folder_id)
	const children = folder ? to_folder_container(folder, ws.preview_folders).children : []
	return new_note_positions(children, count, ideas_session.anchor)
}

/** On a board, every card has its place, where its note will be written. */
function place_rows() {
	const ws = ideas_session.workspace
	if (!ws || !ideas_on_board.value) return
	const spots = places(ws, ideas_session.folder_id, ideas_rows.value.length)
	ideas_rows.value.forEach((row, index) => {
		const spot = spots[index] ?? null
		if (row.position?.x !== spot?.x || row.position?.y !== spot?.y) row.position = spot
	})
}

async function start() {
	controller?.abort()
	controller = null
	ideas_flow.notice = null
	ideas_flow.error = null
	ideas_flow.coverage = null
	ideas_flow.truncated = false
	ideas_flow.prompt = ''
	if (ideas_from_model.value) {
		ideas_flow.phase = 'ask'
	} else {
		ideas_flow.phase = 'review'
		signal_agent_proposal(
			ideas_session.proposal_id,
			ideas_title.value,
			t('ideas.notify', { folder: basename_of(ideas_session.folder_id), n: ideas_rows.value.length }),
		)
	}
	await ideas_session.workspace?.ensure_preview_folder(ideas_session.folder_id)
	place_rows()
}

function row_of(idea: Idea, status: IdeaRow['status']): IdeaRow {
	const note = idea_note(idea, ai_settings.value.name_style)
	return {
		key: `idea-${next_key++}`,
		name: note.name,
		title: idea.title,
		text: note.text,
		checked: true,
		position: null,
		status,
		error: null,
	}
}

/** The answer so far as rows after `base`: whole ideas ready, the one being written last. */
function show_answer(base: number, answer: string, done: boolean) {
	const { ideas, writing } = parse_ideas(answer, done)
	const list = writing && writing.title ? [...ideas, writing] : ideas
	list.forEach((idea, index) => {
		const status = index < ideas.length ? 'ready' : 'writing'
		const row = ideas_rows.value[base + index]
		if (!row) {
			ideas_session.rows.push(row_of(idea, status))
			return
		}
		const note = idea_note(idea, ai_settings.value.name_style)
		row.title = idea.title
		row.name = note.name
		row.text = note.text
		row.status = status
	})
	ideas_session.rows.splice(base + list.length)
}

/** Asks the model: the first ideas, or ("More") as many again without the ones shown. */
export async function generate_ideas() {
	const ws = ideas_session.workspace
	if (!ws || ideas_busy.value) return
	controller?.abort()
	const own = new AbortController()
	controller = own
	const is_current = () => controller === own
	const base = ideas_rows.value.length
	const shown = ideas_rows.value.map(row => row.title)
	let answer = ''
	ideas_flow.notice = null
	ideas_flow.error = null
	ideas_flow.truncated = false
	ideas_flow.read = 0
	ideas_flow.phase = 'reading'
	try {
		const { base_url, model } = ai_settings.value
		const sources = await collect_summary_sources(ws, ideas_session.entries, {
			images_refused: vision_support(base_url, model) === false,
			signal: own.signal,
			on_progress: (done) => {
				if (is_current()) ideas_flow.read = done
			},
		})
		if (!is_current()) return
		if (own.signal.aborted) {
			ideas_flow.phase = base ? 'review' : 'ask'
			return
		}
		ideas_flow.coverage = coverage_line(sources)
		if (!(await ensure_ai_consent(ws, { sends_images: sources.images.length > 0 }))) {
			if (!is_current()) return
			ideas_flow.notice = t('ideas.nothing_sent')
			ideas_flow.phase = base ? 'review' : 'ask'
			return
		}
		if (!is_current() || own.signal.aborted) return
		ideas_flow.phase = 'writing'
		const result = await ai_chat(build_idea_messages(sources, ideas_session.board_name, ideas_flow.prompt, shown), {
			signal: own.signal,
			on_delta: (text) => {
				if (!is_current()) return
				answer += text
				show_answer(base, answer, false)
			},
		})
		if (!is_current()) return
		answer = result.text
		show_answer(base, answer, true)
		ideas_flow.truncated = result.truncated
		if (ideas_rows.value.length === base) ideas_flow.error = t('ideas.none')
		ideas_flow.phase = ideas_rows.value.length ? 'review' : 'ask'
	} catch (failure) {
		if (!is_current()) return
		// What was whole stays; the idea still being written goes
		ideas_session.rows = ideas_rows.value.filter(row => row.status !== 'writing')
		if (is_abort_error(failure)) {
			if (ideas_rows.value.length > base) ideas_flow.notice = t('ideas.stopped')
		} else {
			ideas_flow.error = await explain_chat_error(failure)
		}
		ideas_flow.phase = ideas_rows.value.length ? 'review' : 'ask'
	} finally {
		if (is_current()) controller = null
	}
}

export function stop_ideas() {
	controller?.abort()
}

function added_text(created: number): { label?: string; notice?: string } {
	if (!created) return {}
	const count = count_notes(created)
	return { label: t('undo.notes', { count }), notice: t('undo.notes_added', { count }) }
}

type RowOutcome = { outcome: 'created' | 'failed' | 'skipped' | 'pending'; error?: string } | null

/** Marks each row with what the write did; returns how many failed. */
function show_outcomes(outcomes: RowOutcome[]): number {
	let failed = 0
	outcomes.forEach((result, index) => {
		const row = ideas_rows.value[index]
		if (!row || !result) return
		if (result.outcome === 'created') {
			row.status = 'created'
			row.checked = false
		} else if (result.outcome === 'failed') {
			row.status = 'failed'
			row.error = result.error ?? null
			row.checked = false
			failed++
		}
	})
	return failed
}

/**
 * Writes the checked notes as one undo. The answer: how many were created,
 * and whether the store has no history to toast it (the caller does then).
 */
export async function add_ideas(): Promise<{ created: number; untoasted: boolean }> {
	const ws = ideas_session.workspace
	if (!ws || !ideas_to_add.value.length || ideas_busy.value) return { created: 0, untoasted: false }
	const folder_id = ideas_session.folder_id
	const proposal_id = ideas_session.proposal_id
	const run = ideas_session.run
	const from_model = ideas_from_model.value
	ideas_flow.phase = 'applying'
	ideas_flow.notice = null
	await ws.ensure_preview_folder(folder_id)
	const names = ideas_planned.value
	const rows = ideas_rows.value
	const checked = rows.map(row => row.checked && row.status === 'ready')
	const chosen = rows.flatMap((row, index) => (checked[index] ? [{ index, row }] : []))
	const label = t('undo.notes', { count: count_notes(chosen.length) })
	const write = (picked: readonly { index: number; text: string }[], tx: Parameters<typeof add_new_notes>[3]) => {
		const spots = places(ws, folder_id, picked.length)
		return add_new_notes(ws, folder_id, picked.map((item, at) => {
			const position = rows[item.index]?.position ?? spots[at] ?? null
			return {
				name: names[item.index] ?? rows[item.index]!.name,
				text: item.text,
				position,
				size: position ? NEW_NOTE_SIZE : null,
			}
		}), tx)
	}
	let outcomes: RowOutcome[]
	if (from_model) {
		// The ideas the person kept are one undo
		const written: NewNoteOutcome[] = await record_action(ws, { folder_id }, label, tx => write(
			chosen.map(({ index, row }) => ({ index, text: row.text })),
			tx,
		), { describe: done => added_text(done.filter(outcome => !outcome.error).length) })
		outcomes = rows.map(() => null)
		chosen.forEach(({ index }, at) => {
			const outcome = written[at]
			outcomes[index] = outcome?.error ? { outcome: 'failed', error: outcome.error } : { outcome: 'created' }
		})
	} else {
		// What the agent proposed and the person kept is one undo, as with names
		const results: CreateRowResult[] = await record_action(ws, { folder_id }, label, tx => confirm_create(
			proposal_id,
			checked,
			picked => write(picked, tx),
		), { describe: done => added_text(done.filter(row => row.outcome === 'created').length) })
		outcomes = results
	}
	const created = outcomes.filter(outcome => outcome?.outcome === 'created').length
	const untoasted = created > 0 && !ws.history_ref
	if (ideas_session.run !== run) return { created, untoasted }
	const failed = show_outcomes(outcomes)
	if (failed) {
		ideas_flow.notice = t('ideas.not_added', { n: failed })
		ideas_flow.phase = 'done'
		return { created, untoasted }
	}
	if (!from_model) close_proposal(proposal_id)
	close_ideas()
	return { created, untoasted }
}

/** Closed, cancelled, or left: nothing more is written. */
export function cancel_ideas() {
	stop_ideas()
	if (!ideas_from_model.value) close_proposal(ideas_session.proposal_id)
	close_ideas()
}

watch(() => ideas_session.run, () => {
	if (ideas_session.open) void start()
})

// A card has its place once the board shows the session, and so does each new idea
watch(() => [ideas_rows.value.length, ideas_on_board.value] as const, () => place_rows())

// Leaving the board, or switching it to another view, is the same as Cancel.
// A board that only remounts (a new key) shows the folder again at once.
watch(ideas_on_board, (on) => {
	if (on) {
		shown_on_board_run.value = ideas_session.run
		return
	}
	const run = shown_on_board_run.value
	if (!ideas_session.open || run !== ideas_session.run) return
	setTimeout(() => {
		if (ideas_session.open && ideas_session.run === run && !ideas_on_board.value && ideas_flow.phase !== 'applying') cancel_ideas()
	}, 0)
})
