import { inject, provide, type ComputedRef, type InjectionKey, type Ref } from 'vue'
import type { WindowContent, WindowState } from '@/domain/Desktop'

export type WindowContext = {
	window_id: string
	state: ComputedRef<WindowState>
	content: ComputedRef<WindowContent>
	/** True while this window's workspace/slug store is being opened. */
	loading: Ref<boolean>
	/** Failed to open this window's workspace/slug; shown in the folder panel. */
	load_error: ComputedRef<string | null>
	retry_load: () => void
}

const windowContextKey: InjectionKey<WindowContext> = Symbol('windowContext')

/** Provided by Window.vue; the embedded WorkspaceWindow reads it for chrome/controls visibility. */
export function provideWindowContext(context: WindowContext) {
	provide(windowContextKey, context)
}

/** null when rendered at the fullscreen app root (no enclosing window). */
export function useWindowContext(): WindowContext | null {
	return inject(windowContextKey, null)
}
