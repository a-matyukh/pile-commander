import { hold_external_media } from '@/services/workspace/externalAddress'
import { media_rules, show_external_media, type MediaScope } from '@/store/externalMedia'
import { useWorkspace } from './useWorkspace'

/**
 * The rule about loading from other sites, for the workspace this component
 * shows (store/externalMedia.ts). `hold` takes a note's HTML and returns it
 * with what may not load taken out; `gate` changes when the person answers,
 * so whatever was rendered with `hold` renders again.
 */
export function useMediaRules() {
	const workspace = useWorkspace()
	const scope = (): MediaScope | null => {
		const ws = workspace.value
		return ws ? { type: ws.type, uid: ws.uid } : null
	}
	const rules = media_rules(scope)
	return {
		...rules,
		hold: (html: string) => hold_external_media(html, rules.may_load).html,
		/** The person put a picture here by its link themself: that is their answer for this folder. */
		chosen_by_person: () => show_external_media(scope()),
	}
}
