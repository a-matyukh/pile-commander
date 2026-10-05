#!/usr/bin/env bun
/**
 * Sets the desktop app version in every file that must stay in sync.
 * Source of truth afterwards: apps/client/package.json
 * (tauri.conf.json reads version from that file).
 *
 * Usage: bun run version:desktop 2.0.0-rc.2
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SEMVER =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const version = process.argv[2]?.trim()
if (!version || !SEMVER.test(version)) {
	console.error('Usage: bun run version:desktop <semver>')
	console.error('Example: bun run version:desktop 2.0.0-rc.2')
	process.exit(1)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const pkgPath = join(root, 'apps/client/package.json')
const cargoTomlPath = join(root, 'apps/client/src-tauri/Cargo.toml')
const cargoLockPath = join(root, 'apps/client/src-tauri/Cargo.lock')
const bunLockPath = join(root, 'bun.lock')

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }
pkg.version = version
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

function mustReplace(source: string, pattern: RegExp, replacement: string, label: string): string {
	if (!pattern.test(source)) {
		console.error(`Could not find ${label}`)
		process.exit(1)
	}
	return source.replace(pattern, replacement)
}

const cargoToml = readFileSync(cargoTomlPath, 'utf8')
writeFileSync(
	cargoTomlPath,
	mustReplace(cargoToml, /^version = "[^"]+"/m, `version = "${version}"`, cargoTomlPath),
)

const cargoLock = readFileSync(cargoLockPath, 'utf8')
writeFileSync(
	cargoLockPath,
	mustReplace(
		cargoLock,
		/(\[\[package\]\]\nname = "app"\n)version = "[^"]+"/,
		`$1version = "${version}"`,
		`${cargoLockPath} (package app)`,
	),
)

const bunLock = readFileSync(bunLockPath, 'utf8')
writeFileSync(
	bunLockPath,
	mustReplace(
		bunLock,
		/("apps\/client": \{\n      "name": "@pile-commander\/client",\n      "version": ")[^"]+"/,
		`$1${version}"`,
		`${bunLockPath} (@pile-commander/client)`,
	),
)

console.log(`Desktop version set to ${version}`)
