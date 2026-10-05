/** Owned cloud rows that are public → id-to-slug map for the workspace list. */
export function owned_public_slugs(
	owned: { id: string; slug?: string | null; is_public?: boolean }[],
): Record<string, string> {
	const published: Record<string, string> = {}
	for (const ws of owned) {
		if (ws.is_public && ws.slug) published[ws.id] = ws.slug
	}
	return published
}

/** Owned rows with at least one invitee → id set for the workspace list Shared group. */
export function owned_shared_out(
	owned: { id: string; workspace_members?: unknown; workspace_invites?: unknown }[],
): Record<string, true> {
	const shared: Record<string, true> = {}
	for (const ws of owned) {
		if (has_rows(ws.workspace_members) || has_live_invites(ws.workspace_invites)) {
			shared[ws.id] = true
		}
	}
	return shared
}

function has_rows(value: unknown): boolean {
	return Array.isArray(value) ? value.length > 0 : value != null
}

function has_live_invites(value: unknown): boolean {
	if (!Array.isArray(value)) return value != null
	if (value.length === 0) return false
	const now = Date.now()
	return value.some((row) => {
		if (!row || typeof row !== 'object') return true
		const expires_at = (row as { expires_at?: unknown }).expires_at
		if (typeof expires_at !== 'string') return true
		const at = Date.parse(expires_at)
		return !Number.isFinite(at) || at > now
	})
}

/** Owned rows with a Hub listing → id set for the workspace list Hub group. */
export function owned_hub_listed(
	owned: { id: string; hub_publications?: unknown }[],
): Record<string, true> {
	const listed: Record<string, true> = {}
	for (const ws of owned) {
		const hub = ws.hub_publications
		const has_listing = Array.isArray(hub) ? hub.length > 0 : hub != null
		if (has_listing) listed[ws.id] = true
	}
	return listed
}

/** Owned Hub listings currently hidden from the gallery (still occupy a slot). */
export function owned_hub_hidden(
	owned: { id: string; hub_publications?: unknown }[],
): Record<string, true> {
	const hidden: Record<string, true> = {}
	for (const ws of owned) {
		const hub = first_hub_embed(ws.hub_publications)
		if (hub && hub.hidden_at) hidden[ws.id] = true
	}
	return hidden
}

function first_hub_embed(value: unknown): { hidden_at?: string | null } | null {
	if (value == null) return null
	if (Array.isArray(value)) {
		const row = value[0]
		if (!row || typeof row !== 'object') return null
		return row as { hidden_at?: string | null }
	}
	if (typeof value === 'object') return value as { hidden_at?: string | null }
	return null
}

/** True when a new Hub listing is blocked: at cap and this board is not already listed. */
export function hub_new_listing_blocked(
	used: number,
	cap: number | null | undefined,
	already_listed: boolean,
): boolean {
	if (cap == null) return false
	if (already_listed) return false
	return used >= cap
}

/** Visitor chrome for /<username>/<slug>: one workspace id, not a clone pair. */
export function publication_view_ids(pub: {
	id: string
	allow_fork: boolean
	fork: { fork_count: number } | null
}): { workspace_id: string; can_fork: boolean; fork_count: number } {
	return {
		workspace_id: pub.id,
		can_fork: pub.allow_fork,
		fork_count: pub.fork?.fork_count ?? 0,
	}
}
