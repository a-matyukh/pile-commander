/** A folder cover or a pane background stored as a file in `.pile`. */
export type PileImageRole = "cover" | "background"

/**
 * `pile:cover-<hash8>.webp` / `pile:background-<hash8>.webp`.
 * The hash is of the stored webp bytes, so a replacement changes the token
 * even when the extension stays. Cloud storage will read this same token later.
 */
const PILE_IMAGE_TOKEN = /^pile:(cover|background)-([0-9a-f]{8})\.webp$/

export function pile_image_token(role: PileImageRole, hash8: string): string {
	return `pile:${role}-${hash8}.webp`
}

export function parse_pile_image_token(value: string): { role: PileImageRole; hash8: string; file: string } | null {
	const match = PILE_IMAGE_TOKEN.exec(value.trim())
	if (!match) return null
	const role = match[1] as PileImageRole
	const hash8 = match[2]!
	return { role, hash8, file: `${role}-${hash8}.webp` }
}

export function is_pile_image_token(value: string): boolean {
	return PILE_IMAGE_TOKEN.test(value.trim())
}

/** First 8 hex characters of sha-256. */
export async function pile_image_hash8(bytes: Uint8Array): Promise<string> {
	const copy = new Uint8Array(bytes.byteLength)
	copy.set(bytes)
	const digest = await crypto.subtle.digest("SHA-256", copy)
	const hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("")
	return hex.slice(0, 8)
}

/** Cloud, browser and demo stores have no `.pile` directory. */
export const pile_images_off = {
	pile_images: false,
	async write_pile_image(): Promise<string> {
		throw new Error("pile images are stored only on a local folder")
	},
	async read_pile_image(): Promise<Uint8Array | null> {
		return null
	},
}
