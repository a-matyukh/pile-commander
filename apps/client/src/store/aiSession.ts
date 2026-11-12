/**
 * AI sessions share one preview slot with agents' proposals (names, new
 * notes, moves). While the person has a session of their own open, an
 * agent's proposal is `busy`. When the person starts an AI action, an agent
 * preview that is still waiting closes as dismissed and nothing is written:
 * the person's action wins. Each kind's store registers itself here, so no
 * store imports another.
 */
export type AiSessionKind = {
	/** The person's own session of this kind is open. */
	own_open(): boolean
	/** Closes this kind's agent preview, if one is showing. Its proposal is dismissed. */
	close_agent_preview(): void
}

const kinds = new Set<AiSessionKind>()

export function register_ai_session_kind(kind: AiSessionKind): void {
	kinds.add(kind)
}

export function own_ai_session_open(): boolean {
	for (const kind of kinds) {
		if (kind.own_open()) return true
	}
	return false
}

/** The person starts an AI action, or agent access goes off: every waiting agent preview closes. */
export function close_agent_previews(): void {
	for (const kind of kinds) kind.close_agent_preview()
}
