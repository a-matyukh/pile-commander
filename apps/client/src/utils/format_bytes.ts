const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

export function format_bytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
	let value = bytes
	let unit_index = 0
	while (value >= 1024 && unit_index < UNITS.length - 1) {
		value /= 1024
		unit_index++
	}
	const rounded = unit_index === 0 ? Math.round(value).toString() : value.toFixed(1)
	return `${rounded} ${UNITS[unit_index]}`
}
