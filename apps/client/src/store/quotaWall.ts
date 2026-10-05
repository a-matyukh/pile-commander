import { reactive } from 'vue'
import type { PlanLimitInfo } from '@pile-commander/file-manager'
import { parse_plan_limit_error } from '@pile-commander/file-manager'

export type QuotaWallState = {
	open: boolean
	payload: PlanLimitInfo | null
	file_mime: string | null
}

const quota_wall: QuotaWallState = reactive({
	open: false,
	payload: null,
	file_mime: null,
})

export function open_quota_wall(info: PlanLimitInfo, extra?: { file_mime?: string | null }) {
	quota_wall.payload = info
	quota_wall.file_mime = extra?.file_mime ?? info.file_mime ?? null
	quota_wall.open = true
}

/** Opens the wall when `error` is a plan limit. Returns true if handled. */
export function open_quota_wall_from_error(
	error: unknown,
	extra?: { file_mime?: string | null },
): boolean {
	const info = parse_plan_limit_error(error)
	if (!info) return false
	open_quota_wall(info, extra)
	return true
}

export function close_quota_wall() {
	quota_wall.open = false
}

export default quota_wall
