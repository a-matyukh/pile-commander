import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { assertOfflineIcons, listOfflineIconRefs } from '../offlineIconsPlugin.ts'

const srcDir = fileURLToPath(new URL('.', import.meta.url))

test('every icon used in the client exists in a local Iconify collection', () => {
	expect(assertOfflineIcons(srcDir)).toEqual([])
	expect(listOfflineIconRefs(srcDir)).toEqual(expect.arrayContaining([
		'lucide:hand',
		'lucide:pen',
		'lucide:lasso',
		'lsicon:drag-filled',
		'material-symbols:folder-outline',
		'tabler:chevron-left',
		'tabler:layout-sidebar',
		'tabler:check',
		'tabler:selector',
		'tabler:loader-2',
		'tabler:bookmark-plus',
		'tabler:bookmarks',
		'tabler:folder',
		'tabler:grip-vertical',
	]))
})
