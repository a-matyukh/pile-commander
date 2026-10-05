/**
 * Why the backend refused to sign a media download: the egress fair use of a
 * public board's owner for a visitor (apps/backend/src/egress.ts), or, for
 * Download as .pile, the downloader's own monthly allowance. Owners and
 * invited members are never refused.
 */
export type MediaUnavailableReason = "public_file_size" | "visitor_share" | "egress_budget" | "download_budget"

const REASONS: readonly MediaUnavailableReason[] = ["public_file_size", "visitor_share", "egress_budget", "download_budget"]

// Shown in toasts (open_file, paste, Download as .pile); the visitor never
// learns the owner's plan — download_budget is the reader's own allowance
const MESSAGES: Record<MediaUnavailableReason, string> = {
	public_file_size: "This file is too large to open on a public board",
	visitor_share: "This media is temporarily unavailable",
	egress_budget: "This media is temporarily unavailable",
	download_budget: "You have used this month's download allowance",
}

export class MediaUnavailableError extends Error {
	readonly reason: MediaUnavailableReason

	constructor(reason: MediaUnavailableReason) {
		super(MESSAGES[reason])
		this.name = "MediaUnavailableError"
		this.reason = reason
	}
}

/** Reads the backend's `{ error: "media_unavailable", reason }` body; null for anything else. */
export function parse_media_unavailable(body: unknown): MediaUnavailableReason | null {
	if (!body || typeof body !== "object" || Array.isArray(body)) return null
	const record = body as Record<string, unknown>
	if (record.error !== "media_unavailable") return null
	const reason = record.reason as MediaUnavailableReason
	return REASONS.includes(reason) ? reason : null
}
