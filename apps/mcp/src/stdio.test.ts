import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const PHRASE = 'Pile Commander is not running or agent access is off'
const script = join(import.meta.dir, 'stdio.ts')

async function home_with_dir(): Promise<{ home: string; dir: string }> {
	const home = await mkdtemp(join(tmpdir(), 'pile-mcp-'))
	const dir = join(home, 'Library', 'Application Support', 'com.pile.commander')
	await mkdir(dir, { recursive: true })
	return { home, dir }
}

function run(home: string) {
	const child = spawn(process.execPath, [script], {
		env: { ...process.env, HOME: home },
		stdio: ['pipe', 'pipe', 'pipe'],
	})
	const stdout: Buffer[] = []
	const stderr: Buffer[] = []
	child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
	child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
	return {
		child,
		text: () => ({
			stdout: Buffer.concat(stdout).toString('utf8'),
			stderr: Buffer.concat(stderr).toString('utf8'),
		}),
	}
}

describe('mcp pipe', () => {
	test('a missing socket writes one stderr line and nothing to stdout', async () => {
		const { home } = await home_with_dir()
		try {
			const { child, text } = run(home)
			const code = await new Promise<number>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error('timed out')), 3000)
				child.on('exit', (status) => {
					clearTimeout(timer)
					resolve(status ?? -1)
				})
			})
			const out = text()
			expect(code).toBe(1)
			expect(out.stdout).toBe('')
			expect(out.stderr).toBe(`${PHRASE}\n`)
		} finally {
			await rm(home, { recursive: true, force: true })
		}
	})

	test('stdout is only the bytes that arrived from the socket', async () => {
		const { home, dir } = await home_with_dir()
		const socket_path = join(dir, 'mcp.sock')
		await writeFile(join(dir, 'mcp.token'), 'secret-token')
		const server = createServer()
		await new Promise<void>((resolve) => server.listen(socket_path, resolve))
		const token_line = new Promise<string>((resolve) => {
			server.on('connection', (connection: Socket) => {
				let received = ''
				connection.on('data', (chunk: Buffer) => {
					received += chunk.toString('utf8')
					if (received.includes('\n')) {
						resolve(received)
						connection.write('from-socket')
					}
				})
			})
		})
		try {
			const { child, text } = run(home)
			expect(await token_line).toBe('secret-token\n')
			const stdout = await new Promise<string>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error('timed out')), 3000)
				child.stdout.on('data', () => {
					const out = text().stdout
					if (out.includes('from-socket')) {
						clearTimeout(timer)
						resolve(out)
					}
				})
			})
			expect(stdout).toBe('from-socket')
			expect(text().stderr).toBe('')
			child.kill()
		} finally {
			server.close()
			await rm(home, { recursive: true, force: true })
		}
	})

	test('a closed socket exits 1 and adds nothing to stdout', async () => {
		const { home, dir } = await home_with_dir()
		const socket_path = join(dir, 'mcp.sock')
		await writeFile(join(dir, 'mcp.token'), 'secret-token')
		const server = createServer()
		await new Promise<void>((resolve) => server.listen(socket_path, resolve))
		server.on('connection', (connection: Socket) => {
			let received = ''
			connection.on('data', (chunk: Buffer) => {
				received += chunk.toString('utf8')
				if (received.includes('\n')) connection.end()
			})
		})
		try {
			const { child, text } = run(home)
			const code = await new Promise<number>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error('timed out')), 3000)
				child.on('exit', (status) => {
					clearTimeout(timer)
					resolve(status ?? -1)
				})
			})
			const out = text()
			expect(code).toBe(1)
			expect(out.stdout).toBe('')
			expect(out.stderr).toBe(`${PHRASE}\n`)
		} finally {
			server.close()
			await rm(home, { recursive: true, force: true })
		}
	})
})
