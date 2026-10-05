/** Works on insecure origins too (e.g. http://192.168.x.x from a phone). */
export function createId(): string {
	try {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID()
		}
	} catch {
		/* randomUUID is secure-context-only on some browsers */
	}

	if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
		const bytes = new Uint8Array(16)
		crypto.getRandomValues(bytes)
		bytes[6] = (bytes[6]! & 0x0f) | 0x40
		bytes[8] = (bytes[8]! & 0x3f) | 0x80
		const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
	}

	return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`
}
