import { reactive } from 'vue'

/**
 * Publications opened in this session, by workspace id: the new interface
 * shows each as a read-only folder of the "public" drive. What the folder
 * header needs about one (name, author, address) and what the server allows
 * (fork, edit). Not kept across launches: a publication is opened by its link
 */
export type PublicRoot = {
	id: string
	name: string
	username: string
	slug: string
	can_fork: boolean
	/** The visitor owns or edits the source: "Edit" instead of "Fork" */
	can_edit_source: boolean
}

export const public_roots = reactive(new Map<string, PublicRoot>())

/** Drives that are not the user's own places: never remembered, never bookmarked */
export const TRANSIENT_DRIVES = ['public', 'demo'] as const

export function is_transient_drive(drive_id: string): boolean {
	return (TRANSIENT_DRIVES as readonly string[]).includes(drive_id)
}

export const DEMO_ROOT = '/demo'
