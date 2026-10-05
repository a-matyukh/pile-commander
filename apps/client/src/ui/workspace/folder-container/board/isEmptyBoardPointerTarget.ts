/** Duck-typed so the helper can be unit-tested in node without a DOM. */
export type ClosestHost = {
	closest(selector: string): unknown | null
}

export type ContainsHost = {
	contains(node: unknown): boolean
}

function isClosestHost(value: unknown): value is ClosestHost {
	return typeof value === 'object'
		&& value !== null
		&& typeof (value as ClosestHost).closest === 'function'
}

/**
 * Empty pane iff the event is inside `boardEl` and not inside a child
 * `.board-widget`. Ancestor widgets (folder-preview shells wrapping an
 * embedded board) must not count as occupied.
 */
export function isEmptyBoardPointerTarget(
	target: unknown,
	boardEl: ContainsHost | null,
): boolean {
	if (!boardEl || !isClosestHost(target)) return false
	if (!boardEl.contains(target)) return false
	const widget = target.closest('.board-widget')
	return widget == null || !boardEl.contains(widget)
}
