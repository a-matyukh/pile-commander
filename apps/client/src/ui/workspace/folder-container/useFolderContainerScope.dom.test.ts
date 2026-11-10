// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, onMounted, onUnmounted, ref, type App } from 'vue'
import { registerPanePositionResolver, resolvePanePosition } from './panePosition'

// The scope falls back to the store on screen; here every test provides its own
vi.mock('@/ui/workspace/useWorkspace', () => ({ useWorkspace: () => ref(null) }))

const {
	pinFolderContainerScope,
	provideFolderContainerScope,
	useFolderContainerScope,
} = await import('./useFolderContainerScope')

let app: App | null = null

afterEach(() => {
	app?.unmount()
	app = null
})

/** The folder pane in small: the scope follows the open folder, every folder gets its own view */
function show(folder: string) {
	const opened = ref(folder)
	const log: string[] = []

	// A view, as Board and Canvas: registers its pane when it appears, takes it down when it goes
	const View = defineComponent({
		setup() {
			const { folderId } = useFolderContainerScope()
			onMounted(() => {
				log.push(`mounted in ${folderId.value}`)
				registerPanePositionResolver(folderId.value, () => ({ x: 1, y: 2 }))
			})
			onUnmounted(() => {
				log.push(`unmounted in ${folderId.value}`)
				registerPanePositionResolver(folderId.value, null)
			})
			return () => null
		},
	})

	// FolderViewScope.vue
	const Scope = defineComponent({
		setup(_, { slots }) {
			pinFolderContainerScope()
			return () => slots.default?.()
		},
	})

	// FolderViewRouter.vue
	const Router = defineComponent({
		setup() {
			const { folderId } = useFolderContainerScope()
			return () => h(Scope, { key: folderId.value }, () => h(View))
		},
	})

	// FolderContent.vue
	const Pane = defineComponent({
		setup() {
			provideFolderContainerScope({
				folderId: computed(() => opened.value),
				isEmbedded: false,
				container: computed(() => null),
			})
			return () => h(Router)
		},
	})

	app = createApp(Pane)
	app.mount(document.createElement('div'))
	return { opened, log }
}

describe('a view under a pinned scope', () => {
	test('goes under its own folder, before the next folder gets a new one', async () => {
		const { opened, log } = show('/a')

		opened.value = '/b'
		await nextTick()

		expect(log).toEqual(['mounted in /a', 'unmounted in /a', 'mounted in /b'])
	})

	test('leaves nothing registered for the folder that was left', async () => {
		const { opened } = show('/a')
		expect(resolvePanePosition('/a', 0, 0)).toEqual({ x: 1, y: 2 })

		opened.value = '/b'
		await nextTick()

		expect(resolvePanePosition('/a', 0, 0)).toBeNull()
		expect(resolvePanePosition('/b', 0, 0)).toEqual({ x: 1, y: 2 })
	})
})
