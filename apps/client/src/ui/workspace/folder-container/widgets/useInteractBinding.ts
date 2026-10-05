import {
	onBeforeUnmount,
	ref,
	watch,
	type Ref,
	type WatchSource,
} from 'vue'
import interact from 'interactjs'

export type UseInteractBindingOptions = {
	datasetKey: string
	shouldBind: boolean
	bindInteractable: (el: HTMLElement) => void
	/** Extra teardown beyond interactjs unset (e.g. pointer-drag controllers). */
	unbindInteractable?: (el: HTMLElement) => void
	setInteractableEnabled?: (enabled: boolean) => void
	/** When this changes, fully unset + rebind. Prefer updating options in place when possible. */
	rebindTrigger?: WatchSource
	interactionsEnabled?: Ref<boolean>
	widgetIdGetter: () => string
}

export function useInteractBinding(options: UseInteractBindingOptions) {
	const rootRef = ref<HTMLElement | null>(null)

	function bindInteractions(el: HTMLElement) {
		if (!options.shouldBind || el.dataset[options.datasetKey] === 'true') return
		options.bindInteractable(el)
		el.dataset[options.datasetKey] = 'true'
	}

	function unbindInteractions(el: HTMLElement | null) {
		if (!el) return
		options.unbindInteractable?.(el)
		interact(el).unset()
		delete el.dataset[options.datasetKey]
	}

	function setInteractionsEnabled(enabled: boolean) {
		const el = rootRef.value
		if (!el || el.dataset[options.datasetKey] !== 'true') return
		options.setInteractableEnabled?.(enabled)
	}

	function rebindInteractions() {
		const el = rootRef.value
		if (!el || el.dataset[options.datasetKey] !== 'true') return
		unbindInteractions(el)
		bindInteractions(el)
	}

	/**
	 * Function refs may receive `null` during Vue patch cycles. Unbinding on that
	 * transient null tears down drag listeners while the node is still mounted —
	 * and a later rebind can race or be skipped. Only unbind when the element
	 * actually changes or the component unmounts.
	 */
	function setRootRef(el: unknown) {
		const node = el instanceof HTMLElement ? el : null
		if (node === rootRef.value) return

		if (node === null) {
			// Transient null from function-ref updates — keep listeners alive.
			// Real teardown is onBeforeUnmount / replacement by a different node.
			return
		}

		if (rootRef.value && rootRef.value !== node) {
			unbindInteractions(rootRef.value)
		}
		rootRef.value = node
		if (options.shouldBind) {
			bindInteractions(node)
		}
	}

	if (options.shouldBind && options.interactionsEnabled) {
		watch(options.interactionsEnabled, setInteractionsEnabled)
	}

	if (options.shouldBind && options.rebindTrigger) {
		watch(options.rebindTrigger, rebindInteractions)
	}

	if (options.shouldBind) {
		watch(options.widgetIdGetter, () => {
			const el = rootRef.value
			if (!el || el.dataset[options.datasetKey] === 'true') return
			bindInteractions(el)
		})
	}

	onBeforeUnmount(() => {
		unbindInteractions(rootRef.value)
		rootRef.value = null
	})

	return { rootRef, setRootRef }
}
