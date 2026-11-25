/**
 * The addresses a glTF model asks its viewer to fetch: `uri` of its buffers
 * and images. A `.glb` normally carries everything inside, a `.gltf` names
 * sibling files, and either may name a file on any site. The viewer fetches
 * them by itself and offers no hook to refuse one, so a model from someone
 * else's folder is read here first (store/externalMedia.ts decides).
 * `data:` addresses are part of the file and are left out.
 */
export function model_uris(bytes: Uint8Array): string[] {
	const json = model_json(bytes)
	if (!json || typeof json !== 'object') return []
	const uris: string[] = []
	for (const list of [(json as { buffers?: unknown }).buffers, (json as { images?: unknown }).images]) {
		if (!Array.isArray(list)) continue
		for (const item of list) {
			const uri = (item as { uri?: unknown } | null)?.uri
			if (typeof uri === 'string' && uri && !/^data:/i.test(uri.trim())) uris.push(uri.trim())
		}
	}
	return uris
}

const GLB_MAGIC = 0x46546c67 // "glTF"
const JSON_CHUNK = 0x4e4f534a // "JSON"

/** The model's JSON: the whole of a `.gltf`, the first chunk of a `.glb`. Null when it is neither. */
function model_json(bytes: Uint8Array): unknown {
	try {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
		if (bytes.byteLength >= 20 && view.getUint32(0, true) === GLB_MAGIC) {
			const length = view.getUint32(12, true)
			if (view.getUint32(16, true) !== JSON_CHUNK || 20 + length > bytes.byteLength) return null
			return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)))
		}
		return JSON.parse(new TextDecoder().decode(bytes))
	} catch {
		return null
	}
}
