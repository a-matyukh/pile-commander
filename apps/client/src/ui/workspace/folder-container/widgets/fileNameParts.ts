/** Split a display filename into stem and extension (without the dot). */
export function splitFileName(name: string): { stem: string; extension: string } {
	const dot = name.lastIndexOf('.')
	if (dot <= 0) return { stem: name, extension: '' }
	return {
		stem: name.slice(0, dot),
		extension: name.slice(dot + 1),
	}
}
