import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8')
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('explorer tokens', () => {
	test('stay on the shell class', () => {
		expect(rules).not.toMatch(/:root/)
		expect(css).toMatch(/\.explorer\s*\{/)
		expect(css).toContain('--font-sans:')
		expect(css).toContain('--surface-0:')
	})

	test('keeps system smoothing unless the shell asks for thin text', () => {
		expect(rules).toMatch(/\.explorer\s*\{[^}]*-webkit-font-smoothing:\s*auto/)
		expect(rules).toMatch(/\.explorer\.thin\s*\{[^}]*-webkit-font-smoothing:\s*antialiased/)
	})
})
