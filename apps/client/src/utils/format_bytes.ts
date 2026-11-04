import { locale } from '@/i18n'

const UNITS = {
	en: ['B', 'KB', 'MB', 'GB', 'TB'],
	ru: ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'],
} as const

export function format_bytes(bytes: number): string {
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
			minimumFractionDigits: 1,
			maximumFractionDigits: 1,
		}).format(value)
	return `${rounded} ${UNITS[lang][unit_index]}`
}
