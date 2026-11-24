import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { demo_frame_ancestors } from '../../../middleware.ts'
import { DEFAULT_STORAGE_ORIGIN, desktop_connect_src, http_origin } from './csp'

function read_json(path: string): unknown {
	return JSON.parse(readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8'))
}

/** `name: sources` of one policy string. */
function directives(policy: string): Map<string, string[]> {
	return new Map(policy.split(';').map(part => part.trim()).filter(Boolean).map((part) => {
		const [name, ...sources] = part.split(/\s+/)
		return [name!, sources] as const
	}))
}

describe('desktop_connect_src', () => {
	const env = {
		VITE_SUPABASE_URL: 'https://abcd.supabase.co',
		VITE_BACKEND_URL: 'https://api.example.com/',
	}

	test('lists the hosts of this build and the way to Rust, nothing wider', () => {
		expect(desktop_connect_src(env)).toBe(
			"connect-src 'self' ipc: http://ipc.localhost blob: data: https://abcd.supabase.co wss://abcd.supabase.co "
			+ `https://api.example.com ${DEFAULT_STORAGE_ORIGIN} https://www.pile-commander.app https://www.gstatic.com`,
		)
	})

	test('has no wildcard and no bare scheme that would allow any host', () => {
		const sources = directives(desktop_connect_src(env)).get('connect-src')!
		expect(sources.some(source => source.includes('*'))).toBe(false)
		expect(sources).not.toContain('https:')
		expect(sources).not.toContain('wss:')
	})

	test('the storage follows the list uploads are pinned to', () => {
		const policy = desktop_connect_src({
			...env,
			PILE_STORAGE_URLS: 'https://s3.us-east-005.backblazeb2.com/pile-files/, https://abc123.r2.cloudflarestorage.com/pile-files/',
		})
		expect(policy).toContain(' https://s3.us-east-005.backblazeb2.com ')
		expect(policy).toContain(' https://abc123.r2.cloudflarestorage.com ')
		expect(policy).not.toContain('pile-files')
	})

	test('a build without the cloud still reaches Rust and its own files', () => {
		const sources = directives(desktop_connect_src({})).get('connect-src')!
		expect(sources.slice(0, 5)).toEqual(["'self'", 'ipc:', 'http://ipc.localhost', 'blob:', 'data:'])
		expect(sources.some(source => source.includes('supabase'))).toBe(false)
	})

	test('only http(s) addresses become origins', () => {
		expect(http_origin('https://abcd.supabase.co/rest/v1')).toBe('https://abcd.supabase.co')
		expect(http_origin(' http://127.0.0.1:8787 ')).toBe('http://127.0.0.1:8787')
		expect(http_origin('javascript:alert(1)')).toBeNull()
		expect(http_origin('not a url')).toBeNull()
		expect(http_origin(undefined)).toBeNull()
	})
})

describe('the committed policies', () => {
	const tauri = read_json('src-tauri/tauri.conf.json') as {
		app: { security: { csp: Record<string, string>; dangerousDisableAssetCspModification: string[] } }
	}
	const vercel = read_json('vercel.json') as {
		headers: { source: string; headers: { key: string; value: string }[] }[]
	}
	const enforced_web = vercel.headers
		.flatMap(rule => rule.headers)
		.filter(header => header.key === 'Content-Security-Policy')
		.map(header => header.value)

	test('the desktop window runs only the app\'s own scripts', () => {
		const script = tauri.app.security.csp['script-src']!.split(' ')
		expect(script).toContain("'self'")
		expect(script).not.toContain("'unsafe-inline'")
		expect(script).not.toContain("'unsafe-eval'")
		expect(script.some(source => /^https?:/.test(source))).toBe(false)
		expect(tauri.app.security.csp['object-src']).toBe("'none'")
		expect(tauri.app.security.csp['base-uri']).toBe("'self'")
		// the window calls Rust through these two
		expect(tauri.app.security.csp['connect-src']).toContain('ipc: http://ipc.localhost')
	})

	test('Tauri leaves style-src alone, or its nonce would switch off unsafe-inline', () => {
		expect(tauri.app.security.dangerousDisableAssetCspModification).toEqual(['style-src'])
		expect(tauri.app.security.csp['style-src']).toContain("'unsafe-inline'")
	})

	test('every web page enforces a script rule without inline or eval', () => {
		expect(enforced_web).toHaveLength(3)
		for (const policy of enforced_web) {
			const script = directives(policy).get('script-src')!
			expect(script).toContain("'self'")
			expect(script).not.toContain("'unsafe-inline'")
			expect(script).not.toContain("'unsafe-eval'")
			expect(script.some(source => source.includes('*'))).toBe(false)
		}
	})

	test('/demo, which the middleware answers itself, enforces the same script rule', () => {
		const from_vercel = directives(enforced_web[0]!).get('script-src')
		expect(directives(demo_frame_ancestors('https://www.pile-commander.com')).get('script-src')).toEqual(from_vercel)
	})
})
