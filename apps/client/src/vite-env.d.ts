/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_SUPABASE_URL?: string
	readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
	readonly VITE_BACKEND_URL?: string
	/** Public front host for published workspaces; defaults to the app origin */
	readonly VITE_PUBLIC_BASE_URL?: string
	/** Landing host, for the Terms / Privacy links on the sign-up form */
	readonly VITE_LANDING_URL?: string
	/** Abuse / DMCA mailbox for Hub reports and appeals */
	readonly VITE_ABUSE_EMAIL?: string
}

declare module '*.vue' {
	import type { DefineComponent } from 'vue'
	const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
	export default component
}

declare module 'virtual:offline-icons'

declare module '@google/model-viewer'

declare namespace JSX {
	interface IntrinsicElements {
		'model-viewer': Record<string, unknown>
	}
}

