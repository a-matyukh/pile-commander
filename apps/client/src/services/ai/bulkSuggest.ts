import { ai_settings, vision_support } from '@/store/ai'
import { is_batch_stopping_error, run_pool, type BulkRow } from './bulkRename'
import { explain_chat_error } from './client'
import { is_abort_error, is_no_vision_error } from './errors'
import type { NameTarget } from './naming'
import { ask_name, collect_name_target, NameSkipped, type NameSources } from './suggestName'
import type { AiTransport } from './types'

const NO_VISION = 'The model doesn\'t accept images'

function vision_refused(): boolean {
	const { base_url, model } = ai_settings.value
	return vision_support(base_url, model) === false
}

export type BatchOutcome = {
	/** false when the user declined to send; nothing went out */
	consented: boolean
	/** why the batch stopped early for every remaining row, if it did */
	stop_reason: string | null
}

/**
 * Suggests names for every row, updating the rows in place as answers come.
 * Everything is read first (images reduced), then consent is asked once for
 * the whole batch, then the model is asked `concurrency` rows at a time.
 * An error that would fail every row (server down, bad key) stops the batch.
 */
export async function suggest_batch(input: {
	workspace: NameSources
	rows: BulkRow[]
	concurrency: number
	signal: AbortSignal
	confirm: (sends_images: boolean) => Promise<boolean>
	transport?: AiTransport
}): Promise<BatchOutcome> {
	const { workspace, rows, signal, transport } = input
	const targets = new Map<BulkRow, NameTarget>()

	for (const row of rows) {
		if (signal.aborted) break
		try {
			const target = await collect_name_target(workspace, row.entry)
			if (target.kind === 'image' && vision_refused()) {
				row.status = 'skipped'
				row.reason = NO_VISION
			} else {
				targets.set(row, target)
			}
		} catch (error) {
			row.status = error instanceof NameSkipped ? 'skipped' : 'failed'
			row.reason = error instanceof Error ? error.message : String(error)
		}
	}
	const mark_unasked_stopped = () => {
		for (const row of targets.keys()) {
			if (row.status === 'waiting' || row.status === 'asking') row.status = 'stopped'
		}
	}
	if (signal.aborted) {
		mark_unasked_stopped()
		return { consented: true, stop_reason: null }
	}
	if (!targets.size) return { consented: true, stop_reason: null }

	const sends_images = [...targets.values()].some(target => target.kind === 'image')
	if (!(await input.confirm(sends_images))) {
		for (const row of targets.keys()) {
			row.status = 'stopped'
			row.reason = 'Not sent'
		}
		return { consented: false, stop_reason: null }
	}

	const batch = new AbortController()
	const forward_stop = () => batch.abort()
	signal.addEventListener('abort', forward_stop, { once: true })
	let stop_reason: string | null = null

	try {
		await run_pool([...targets.entries()], input.concurrency, async ([row, target]) => {
			if (batch.signal.aborted) return
			if (target.kind === 'image' && vision_refused()) {
				row.status = 'skipped'
				row.reason = NO_VISION
				return
			}
			row.status = 'asking'
			try {
				const name = await ask_name(target, row.entry, { signal: batch.signal, transport })
				row.suggestion = name
				row.status = name === row.entry.name ? 'same' : 'ready'
				row.checked = row.status === 'ready'
			} catch (error) {
				if (is_abort_error(error) || batch.signal.aborted) {
					row.status = 'stopped'
				} else if (error instanceof NameSkipped) {
					row.status = 'skipped'
					row.reason = error.message
				} else if (target.kind === 'image' && is_no_vision_error(error)) {
					row.status = 'skipped'
					row.reason = NO_VISION
				} else if (is_batch_stopping_error(error)) {
					row.status = 'failed'
					row.reason = await explain_chat_error(error, transport)
					stop_reason ??= row.reason
					batch.abort()
				} else {
					row.status = 'failed'
					row.reason = await explain_chat_error(error, transport)
				}
			}
		}, batch.signal)
	} finally {
		signal.removeEventListener('abort', forward_stop)
	}
	mark_unasked_stopped()
	return { consented: true, stop_reason }
}
