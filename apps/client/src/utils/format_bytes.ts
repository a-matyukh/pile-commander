import { locale } from '@/i18n'

const UNITS = {
	en: ['B', 'KB', 'MB', 'GB', 'TB'],
	ru: ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'],
} as const

/** `trim`: no ".0" on whole amounts — a plan's room reads "50 GB", "1 TB" */
export function format_bytes(bytes: number, options?: { trim?: boolean }): string {
	const lang = locale.value
	if (!Number.isFinite(bytes) || bytes < 0) return `0 ${UNITS[lang][0]}`
	let value = bytes
	let unit_index = 0
	while (value >= 1024 && unit_index < UNITS.en.length - 1) {
		value /= 1024
		unit_index += 1
	}
	const rounded = unit_index === 0
		? String(Math.round(value))
		: new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US', {
			minimumFractionDigits: options?.trim ? 0 : 1,
			maximumFractionDigits: 1,
		}).format(value)
	return `${rounded} ${UNITS[lang][unit_index]}`
}
