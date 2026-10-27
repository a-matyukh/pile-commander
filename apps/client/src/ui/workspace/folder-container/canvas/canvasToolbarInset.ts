import { computed, reactive, toValue, type MaybeRefOrGetter } from 'vue'

/** Toolbar block size for each canvas folder, when that toolbar sits on top. */
const insets = reactive(new Map<string, number>())

export function setCanvasToolbarInset(folderId: string, height: number) {
	if (!folderId) return
	if (height > 0) insets.set(folderId, height)
	else insets.delete(folderId)
}

export function clearCanvasToolbarInset(folderId: string) {
	if (!folderId) return
	insets.delete(folderId)
}

export function canvasToolbarInset(folderId: MaybeRefOrGetter<string>) {
	return computed(() => insets.get(toValue(folderId)) ?? 0)
}
