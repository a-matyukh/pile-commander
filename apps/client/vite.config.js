import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import ui from '@nuxt/ui/vite'
import { offlineIconsPlugin } from './offlineIconsPlugin.ts'
import { unfurlPlugin } from './unfurlPlugin.ts'

const cursorGoto = fileURLToPath(new URL('./scripts/cursor-goto.sh', import.meta.url))
const srcDir = fileURLToPath(new URL('./src', import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
	server: {
		port: 5173,
		strictPort: true,
	},
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
		// Keep a single Vue copy so Ref types / auto-imports stay consistent
		// across @vueuse, nuxt/ui nested deps, and vue-grid-layout-v3.
		dedupe: ['vue', '@vue/reactivity', '@vue/runtime-core', '@vue/runtime-dom'],
	},
	plugins: [
		offlineIconsPlugin(srcDir),
		unfurlPlugin(),
		vue({
			template: {
				compilerOptions: {
					isCustomElement: (tag) => tag === 'model-viewer',
				},
			},
		}),
		vueDevTools({
			launchEditor: cursorGoto,
		}),
		ui({
		router: false,
		// WARNING: these auto-imports inject a real import into ANY module that
		// uses a bare `store`/`cloud`/`is_desktop` identifier the scanner fails to
		// resolve — notably optional parameters (`cloud?: T`). Such an injection
		// into src/store/desktops.ts once created a module cycle
		// (desktops → cloud → store/index → workspaceRegistry → desktops) that
		// crashed the app at startup with a TDZ error. Never name locals/params
		// exactly `cloud`, `store` or `is_desktop` — use cloud_deps etc.
		autoImport: {
			imports: [
			{
				from: '@/store',
				imports: [['default', 'store']],
			},
			{
				from: '@/store/cloud',
				imports: [['default', 'cloud']],
			},
			{
				from: '@/isDesktop',
				imports: ['is_desktop'],
			},
			],
			dts: './auto-imports.d.ts',
			vueTemplate: true,
		},
		}),
	],
})
