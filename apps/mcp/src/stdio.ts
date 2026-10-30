import { connect } from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OFF = 'Pile Commander is not running or agent access is off\n'

function data_dir(): string {
	return join(homedir(), 'Library', 'Application Support', 'com.pile.commander')
}

function fail(): never {
	process.stderr.write(OFF)
	process.exit(1)
}

const dir = data_dir()
const socket_path = join(dir, 'mcp.sock')
const token_path = join(dir, 'mcp.token')
if (!existsSync(socket_path) || !existsSync(token_path)) fail()

let token: string
try {
	token = readFileSync(token_path, 'utf8').replace(/\r?\n$/, '')
} catch {
	fail()
}
if (token === '') fail()

let connected = false
let stdin_ended = false
let finished = false

function finish(code: number, announce: boolean): void {
	if (finished) return
	finished = true
	if (announce) process.stderr.write(OFF)
	process.exit(code)
}

const socket = connect(socket_path)
socket.on('error', () => {
	if (!connected) fail()
})
socket.on('connect', () => {
	connected = true
	socket.write(`${token}\n`)
	socket.pipe(process.stdout)
	process.stdin.on('end', () => {
		stdin_ended = true
		socket.end()
	})
	process.stdin.pipe(socket, { end: false })
})
socket.on('close', () => {
	if (!connected) return
	finish(stdin_ended ? 0 : 1, !stdin_ended)
})
