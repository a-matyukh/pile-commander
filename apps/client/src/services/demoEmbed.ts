export const DEMO_EMBED_SOURCE = 'pile-commander'
export const DEMO_EMBED_READY = 'demo-embed-ready'

export type DemoEmbedReadyMessage = {
	source: typeof DEMO_EMBED_SOURCE
	type: typeof DEMO_EMBED_READY
}

export function is_demo_embed_ready(data: unknown): data is DemoEmbedReadyMessage {
	if (data === null || typeof data !== 'object') return false
	const message = data as { source?: unknown; type?: unknown }
	return message.source === DEMO_EMBED_SOURCE && message.type === DEMO_EMBED_READY
}

/** Parent origin for postMessage: ancestorOrigins (Safari) then document.referrer. Never `*`. */
export function demo_embed_parent_origin(
	referrer: string,
	ancestorOrigins?: ArrayLike<string> | null,
): string | null {
	const ancestor = ancestorOrigins && ancestorOrigins.length > 0 ? String(ancestorOrigins[0] ?? '') : ''
	if (ancestor) {
		try {
			const parsed = new URL(ancestor.includes('://') ? ancestor : `https://${ancestor}`)
			if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
			return parsed.origin
		} catch {
			return null
		}
	}
	if (!referrer) return null
	try {
		const parsed = new URL(referrer)
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
		return parsed.origin
	} catch {
		return null
	}
}

type EmbedWindow = {
	parent: unknown
	location: { pathname: string; ancestorOrigins?: ArrayLike<string> }
	document: { referrer: string }
}

/**
 * Tell a framing landing page that `/demo` mounted. No-op unless this document
 * is `/demo` inside an iframe and the parent origin is known.
 */
export function notify_demo_embed_ready(win: EmbedWindow = window): void {
	if (win.parent === win) return
	const path = win.location.pathname.replace(/\/+$/, '') || '/'
	if (path !== '/demo') return
	const target = demo_embed_parent_origin(win.document.referrer, win.location.ancestorOrigins)
	if (!target) return
	const parent = win.parent as {
		postMessage: (message: DemoEmbedReadyMessage, targetOrigin: string) => void
	}
	parent.postMessage(
		{ source: DEMO_EMBED_SOURCE, type: DEMO_EMBED_READY },
		target,
	)
}
