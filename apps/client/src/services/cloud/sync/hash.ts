/** JSON with object keys sorted at every level: equal data, equal text. */
export function stable_json(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
	if (Array.isArray(value)) return `[${value.map(stable_json).join(',')}]`
	const record = value as Record<string, unknown>
	const keys = Object.keys(record).filter(key => record[key] !== undefined).sort()
	return `{${keys.map(key => `${JSON.stringify(key)}:${stable_json(record[key])}`).join(',')}}`
}

/** cyrb53: a fast 53-bit string hash, enough to notice that layout changed. */
export function hash_text(text: string): string {
	let h1 = 0xdeadbeef
	let h2 = 0x41c6ce57
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index)
		h1 = Math.imul(h1 ^ code, 2654435761)
		h2 = Math.imul(h2 ^ code, 1597334677)
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

export function hash_value(value: unknown): string {
	return hash_text(stable_json(value))
}

/**
 * A uuid derived from a name (SHA-256, shaped like a v5 uuid). Cloud stroke
 * ids are a table-wide key: the same local ink synced into two workspaces
 * must not share ids, and one workspace must get the same id every pass
 */
export async function derived_uuid(namespace: string, name: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${namespace}\u0000${name}`))
	const bytes = new Uint8Array(digest).slice(0, 16)
	bytes[6] = (bytes[6]! & 0x0f) | 0x50
	bytes[8] = (bytes[8]! & 0x3f) | 0x80
	const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
