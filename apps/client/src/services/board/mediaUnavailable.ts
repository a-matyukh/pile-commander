import type { MediaUnavailableReason } from '@pile-commander/file-manager'

/**
 * Placeholder text of a media widget that has no URL. `reason` is set when
 * the backend refused a public-board visitor (egress fair use); the copy
 * never mentions the owner's plan
 */
export function media_unavailable_label(reason: MediaUnavailableReason | null): string {
	switch (reason) {
		case 'public_file_size':
			return 'Too large to preview on a public board'
		case 'visitor_share':
		case 'egress_budget':
			return 'Media is temporarily unavailable'
		default:
			return 'Preview unavailable'
	}
}
