/**
 * The feedback form (the Feedback page): the same POST /feedback the landing
 * form uses, then each screenshot PUT to the signed Storage URL it returns.
 * Limits match apps/backend/src/feedback.ts
 */
export const FEEDBACK_MESSAGE_MAX = 4000
export const FEEDBACK_ATTACHMENT_MAX = 5
export const FEEDBACK_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024
export const FEEDBACK_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
export const FEEDBACK_CATEGORIES = ['bug', 'idea', 'other'] as const
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]

export type FeedbackResult = 'ok' | 'rate_limited' | 'invalid' | 'upload_failed' | 'failed'

export type FeedbackDraft = {
	email: string
	category: FeedbackCategory
	message: string
	files: File[]
	/** the hidden trap field: empty from a person, filled by bots */
	website?: string
}

/** `fetch`, narrowed to what the form calls, so tests can pass a plain function */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

type UploadTicket = { path: string; token: string; signedUrl: string }

const IMAGE_TYPES = new Set<string>([...FEEDBACK_IMAGE_TYPES, 'image/jpg'])

/**
 * Adds picked files to the ones already chosen: images up to 5 MB, five at
 * most. `refused` is true when a file was left out for its type or size
 */
export function accept_feedback_files(current: File[], picked: Iterable<File>): { files: File[]; refused: boolean } {
	const files = [...current]
	let refused = false
	for (const file of picked) {
		if (files.length >= FEEDBACK_ATTACHMENT_MAX) break
		if (!IMAGE_TYPES.has(file.type) || file.size < 1 || file.size > FEEDBACK_ATTACHMENT_MAX_BYTES) {
			refused = true
			continue
		}
		files.push(file)
	}
	return { files, refused }
}

export async function send_feedback(
	backend: string,
	draft: FeedbackDraft,
	fetch_impl: FetchLike = (input, init) => fetch(input, init),
): Promise<FeedbackResult> {
	let uploads: UploadTicket[]
	try {
		const response = await fetch_impl(`${backend.replace(/\/$/, '')}/feedback`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				email: draft.email.trim(),
				category: draft.category,
				message: draft.message,
				website: draft.website ?? '',
				attachments: draft.files.map(file => ({ mime: file.type, size: file.size })),
			}),
		})
		if (response.status === 429) return 'rate_limited'
		if (response.status === 400) return 'invalid'
		if (!response.ok) return 'failed'
		const body = (await response.json()) as { uploads?: UploadTicket[] }
		uploads = body.uploads ?? []
	} catch {
		return 'failed'
	}
	try {
		for (let i = 0; i < uploads.length; i++) {
			const file = draft.files[i]
			const ticket = uploads[i]
			if (!file || !ticket) continue
			const put = await fetch_impl(ticket.signedUrl, {
				method: 'PUT',
				headers: {
					Authorization: `Bearer ${ticket.token}`,
					'Content-Type': file.type,
					'x-upsert': 'false',
				},
				body: file,
			})
			if (!put.ok) return 'upload_failed'
		}
	} catch {
		return 'upload_failed'
	}
	return 'ok'
}
