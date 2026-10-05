export type PlanLimitKind = "quota" | "file_size" | "hub_limit"

export type PlanLimitInfo = {
	kind: PlanLimitKind
	used_bytes: number | null
	quota_bytes: number | null
	file_bytes: number | null
	needed_bytes: number | null
	max_file_bytes: number | null
	file_mime: string | null
}

export class PlanLimitError extends Error {
	readonly plan_kind: PlanLimitKind
	readonly used_bytes: number | null
	readonly quota_bytes: number | null
	readonly file_bytes: number | null
	readonly needed_bytes: number | null
	readonly max_file_bytes: number | null
	readonly file_mime: string | null

	constructor(info: PlanLimitInfo, message?: string) {
		super(message ?? info.kind)
		this.name = "PlanLimitError"
		this.plan_kind = info.kind
		this.used_bytes = info.used_bytes
		this.quota_bytes = info.quota_bytes
		this.file_bytes = info.file_bytes
		this.needed_bytes = info.needed_bytes
		this.max_file_bytes = info.max_file_bytes
		this.file_mime = info.file_mime
	}

	to_info(): PlanLimitInfo {
		return {
			kind: this.plan_kind,
			used_bytes: this.used_bytes,
			quota_bytes: this.quota_bytes,
			file_bytes: this.file_bytes,
			needed_bytes: this.needed_bytes,
			max_file_bytes: this.max_file_bytes,
			file_mime: this.file_mime,
		}
	}
}

const MESSAGE_KIND: { needle: string; kind: PlanLimitKind }[] = [
	{ needle: "file_too_large", kind: "file_size" },
	{ needle: "hub_listing_limit", kind: "hub_limit" },
	{ needle: "quota_exceeded", kind: "quota" },
]

function as_record(value: unknown): Record<string, unknown> | null {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>
	}
	return null
}

function as_finite_number(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value)
		if (Number.isFinite(parsed)) return parsed
	}
	return null
}

function as_mime_string(value: unknown): string | null {
	if (typeof value !== "string") return null
	const trimmed = value.trim()
	return trimmed ? trimmed : null
}

function info_from_fields(
	kind: PlanLimitKind,
	fields: Record<string, unknown> | null,
): PlanLimitInfo {
	const nested = fields ? as_record(fields.details) ?? fields : null
	let parsed_details: Record<string, unknown> | null = nested
	if (typeof fields?.details === "string") {
		try {
			parsed_details = as_record(JSON.parse(fields.details)) ?? nested
		} catch {
			parsed_details = nested
		}
	}
	const src = parsed_details ?? fields
	const src_kind = src?.kind
	const resolved_kind: PlanLimitKind =
		src_kind === "file_size" || src_kind === "hub_limit" || src_kind === "quota"
			? src_kind
			: kind
	return {
		kind: resolved_kind,
		used_bytes: as_finite_number(src?.used_bytes),
		quota_bytes: as_finite_number(src?.quota_bytes),
		file_bytes: as_finite_number(src?.file_bytes),
		needed_bytes: as_finite_number(src?.needed_bytes),
		max_file_bytes: as_finite_number(src?.max_file_bytes),
		file_mime:
			as_mime_string(src?.file_mime)
			?? as_mime_string(src?.mime)
			?? as_mime_string(fields?.file_mime)
			?? as_mime_string(fields?.mime),
	}
}

function kind_from_text(text: string): PlanLimitKind | null {
	for (const { needle, kind } of MESSAGE_KIND) {
		if (text.includes(needle)) return kind
	}
	return null
}

function collect_text(value: unknown): string {
	if (value instanceof PlanLimitError) return value.message
	if (value instanceof Error) return value.message
	if (typeof value === "string") return value
	const record = as_record(value)
	if (!record) return String(value)
	const parts = [record.error, record.message, record.details]
	return parts.map((part) => (typeof part === "string" ? part : "")).join(" ")
}

/** Reads quota / file / Hub ceiling errors from Postgres, PostgREST, or the backend JSON body. */
export function parse_plan_limit_error(error: unknown): PlanLimitInfo | null {
	if (error instanceof PlanLimitError) return error.to_info()

	const record = as_record(error)
	const text = collect_text(error)
	const kind = kind_from_text(text)
		?? (record && kind_from_text(String(record.error ?? "")))
	if (!kind) return null

	if (record) {
		const inner = as_record(record.error) ?? record
		return info_from_fields(kind, inner)
	}
	return info_from_fields(kind, null)
}

export function throw_if_plan_limit(error: unknown): void {
	const info = parse_plan_limit_error(error)
	if (info) throw new PlanLimitError(info, collect_text(error))
}
