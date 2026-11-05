import { t } from '@/i18n'
import { is_desktop } from '@/isDesktop'
import { has_unsaved_writes } from './xattrs'

/**
 * A picture or a look write still on its way to the cloud: closing the
 * window or signing out now would drop it. True when nothing is pending or
 * the user chose to go anyway. The web tab's own close goes through
 * `beforeunload` (the browser asks); this covers the desktop window and the
 * sign-out button
 */
export async function may_drop_unsaved(kind: 'close' | 'sign_out'): Promise<boolean> {
	if (!has_unsaved_writes()) return true
	const question = t(kind === 'close' ? 'unsaved.close' : 'unsaved.sign_out')
	if (is_desktop) {
		const { ask } = await import('@tauri-apps/plugin-dialog')
		return ask(question, {
			kind: 'warning',
			okLabel: t(kind === 'close' ? 'unsaved.close_anyway' : 'unsaved.sign_out_anyway'),
			cancelLabel: t('unsaved.wait'),
		})
	}
	return window.confirm(question)
}
