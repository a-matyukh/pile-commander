/**
 * Step timings of slow cloud paths, for measuring before and after speed
 * work. Off unless localStorage holds `pile_cloud_timing` = "1"; then each
 * traced operation prints one `[cloud-timing]` console line with its steps
 * and keeps it in `globalThis.__cloud_timing` (DevTools truncates objects).
 * Server steps come from the backend's `Server-Timing` header as `srv.<name>`.
 */
export const CLOUD_TIMING_KEY = "pile_cloud_timing"

export type CloudTrace = {
	/** Times `run` under `name`. Repeated names add up. */
	step<T>(name: string, run: () => Promise<T>): Promise<T>
	add(name: string, ms: number): void
	/** A value printed beside the steps (bytes, a path) */
	note(name: string, value: string | number): void
	/** Prints the line once. Later calls do nothing. */
	end(): void
}

const NOOP_TRACE: CloudTrace = {
	step: (_name, run) => run(),
	add() {},
	note() {},
	end() {},
}

export function cloud_timing_enabled(): boolean {
	try {
		return globalThis.localStorage?.getItem(CLOUD_TIMING_KEY) === "1"
	} catch {
		return false
	}
}

/** The last lines, also kept on `globalThis.__cloud_timing`: `copy(__cloud_timing)` in DevTools */
const KEPT_LINES = 200

function console_sink(line: string, data: Record<string, string | number>) {
	console.info(line, data)
	const store = globalThis as { __cloud_timing?: string[] }
	const lines = store.__cloud_timing ??= []
	lines.push(`${line} ${JSON.stringify(data)}`)
	if (lines.length > KEPT_LINES) lines.splice(0, lines.length - KEPT_LINES)
}

export function cloud_trace(
	label: string,
	sink: (line: string, data: Record<string, string | number>) => void = console_sink,
	enabled: boolean = cloud_timing_enabled(),
): CloudTrace {
	if (!enabled) return NOOP_TRACE
	const started = performance.now()
	const data: Record<string, string | number> = {}
	let ended = false
	const add = (name: string, ms: number) => {
		const previous = data[name]
		data[name] = (typeof previous === "number" ? previous : 0) + Math.round(ms)
	}
	return {
		async step(name, run) {
			const at = performance.now()
			try {
				return await run()
			} finally {
				add(name, performance.now() - at)
			}
		},
		add,
		note(name, value) {
			data[name] = value
		},
		end() {
			if (ended) return
			ended = true
			sink(`[cloud-timing] ${label} ${Math.round(performance.now() - started)}ms`, { ...data })
		},
	}
}

/**
 * The trace of the navigation in progress. Store and drive code deep in the
 * open path records into it without a parameter on every call. A step takes
 * the trace that was active when it started, so a later navigation does not
 * collect an earlier one's slow steps.
 */
let active: CloudTrace | null = null

export function begin_active_trace(label: string): CloudTrace {
	active?.note("superseded", 1)
	active?.end()
	const trace = cloud_trace(label)
	active = trace === NOOP_TRACE ? null : trace
	return trace
}

export function end_active_trace(trace: CloudTrace) {
	trace.end()
	if (active === trace) active = null
}

export function active_step<T>(name: string, run: () => Promise<T>): Promise<T> {
	return active ? active.step(name, run) : run()
}

/**
 * `Server-Timing: auth;dur=1.2, quota;dur=30` → { auth: 1.2, quota: 30 }.
 * Entries without a duration are skipped.
 */
export function parse_server_timing(header: string | null): Record<string, number> {
	const result: Record<string, number> = {}
	if (!header) return result
	for (const entry of header.split(",")) {
		const [name, ...params] = entry.trim().split(";")
		if (!name) continue
		for (const param of params) {
			const [key, value] = param.trim().split("=")
			if (key !== "dur" || value === undefined) continue
			const ms = Number(value)
			if (Number.isFinite(ms)) result[name.trim()] = ms
		}
	}
	return result
}

/** Adds the backend's own steps of one response as `srv.<name>` */
export function add_server_timing(trace: CloudTrace, response: Response) {
	for (const [name, ms] of Object.entries(parse_server_timing(response.headers.get("Server-Timing")))) {
		trace.add(`srv.${name}`, ms)
	}
}
