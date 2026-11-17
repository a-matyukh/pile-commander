/**
 * Ship a desktop release.
 *
 *   bun run ship:desktop 2.8.0
 *
 * Bumps the version, commits "Ship 2.8.0" on main, pushes it, then tags
 * v2.8.0 and pushes the tag. That tag starts the desktop release.
 *
 * Only the version bump is committed. A dirty tree, any branch other than
 * main, a main that is behind origin, or a tag that already exists on
 * origin stops the script before it writes anything. Re-running after a
 * failed push continues from the step that did not finish.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SEMVER =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const REPO = join(import.meta.dir, "../../..")
const VERSION_FILES = [
	"apps/client/package.json",
	"apps/client/src-tauri/Cargo.toml",
	"apps/client/src-tauri/Cargo.lock",
	"bun.lock",
]

const version = process.argv[2]?.trim()
if (!version || !SEMVER.test(version) || process.argv.length > 3) {
	console.error("Usage: bun run ship:desktop <semver>")
	console.error("Example: bun run ship:desktop 2.8.0")
	process.exit(1)
}

const tag = `v${version}`
const message = `Ship ${version}`

function run(cmd: string[], opts: { quiet?: boolean } = {}): string {
	const proc = Bun.spawnSync(cmd, { cwd: REPO, stdout: "pipe", stderr: "pipe" })
	const out = proc.stdout.toString()
	if (proc.exitCode !== 0) {
		throw new Error(`${cmd.join(" ")} failed:\n${proc.stderr.toString() || out}`)
	}
	if (!opts.quiet && out.trim()) console.log(out.trimEnd())
	return out
}

function git(args: string[], opts: { quiet?: boolean } = {}): string {
	return run(["git", ...args], opts)
}

function fail(text: string): never {
	console.error(text)
	process.exit(1)
}

function desktopVersion(): string {
	const pkg = JSON.parse(readFileSync(join(REPO, "apps/client/package.json"), "utf8")) as { version?: string }
	return pkg.version ?? ""
}

function statusPaths(): string[] {
	return git(["status", "--porcelain"], { quiet: true })
		.split("\n")
		.map((line) => line.slice(3).trim())
		.filter(Boolean)
}

function headSubject(): string {
	return git(["log", "-1", "--format=%s"], { quiet: true }).trim()
}

function headCommit(): string {
	return git(["rev-parse", "HEAD"], { quiet: true }).trim()
}

function localTagCommit(): string | null {
	const proc = Bun.spawnSync(["git", "rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{}`], {
		cwd: REPO,
		stdout: "pipe",
		stderr: "pipe",
	})
	if (proc.exitCode !== 0) return null
	return proc.stdout.toString().trim()
}

try {
	const branch = git(["branch", "--show-current"], { quiet: true }).trim()
	if (branch !== "main") {
		fail(branch ? `On branch "${branch}". Ship from main.` : "Detached HEAD. Ship from main.")
	}

	console.log("Fetching origin/main …")
	git(["fetch", "origin", "main"], { quiet: true })

	const remoteTag = git(["ls-remote", "--tags", "origin", `refs/tags/${tag}`], { quiet: true }).trim()
	if (remoteTag) fail(`Tag ${tag} already exists on origin.`)

	const [behind] = git(["rev-list", "--left-right", "--count", "origin/main...HEAD"], { quiet: true })
		.trim()
		.split(/\s+/)
	if (behind !== "0") fail(`main is ${behind} commit(s) behind origin/main. Pull first.`)

	const tagged = localTagCommit()
	const shipCommit = desktopVersion() === version && headSubject() === message
	if (tagged) {
		if (!shipCommit || tagged !== headCommit()) {
			fail(`Tag ${tag} already exists and does not point at "${message}".`)
		}
		console.log(`Tag ${tag} is already on HEAD. Pushing it.`)
		git(["push", "origin", tag])
		console.log(`Pushed ${tag}. The desktop release starts from that tag.`)
		process.exit(0)
	}

	if (!shipCommit) {
		const dirty = statusPaths()
		if (dirty.length) {
			fail(`Working tree is not clean:\n${dirty.map((path) => `  ${path}`).join("\n")}\nCommit or stash it before shipping.`)
		}

		console.log(`Setting desktop version to ${version} …`)
		run(["bun", "run", "version:desktop", version])

		const changed = statusPaths()
		if (!changed.length) {
			fail(`Desktop version is already ${version}, and HEAD is not "${message}".`)
		}
		const outside = changed.filter((path) => !VERSION_FILES.includes(path))
		if (outside.length) {
			fail(`Version bump changed files outside the version set:\n${outside.map((path) => `  ${path}`).join("\n")}`)
		}

		git(["add", "-A", "--", ...VERSION_FILES], { quiet: true })
		console.log("\nChanges:")
		git(["diff", "--cached", "--stat", "--", ...VERSION_FILES])
		git(["commit", "-m", message, "--", ...VERSION_FILES], { quiet: true })
		console.log(`\nCommitted: ${git(["log", "-1", "--format=%h %s"], { quiet: true }).trim()}`)
	} else if (statusPaths().length) {
		fail(`HEAD is already "${message}", but the working tree is not clean.`)
	} else {
		console.log(`Commit "${message}" is already HEAD.`)
	}

	console.log("Pushing main …")
	git(["push", "origin", "main"])

	console.log(`Tagging ${tag} …`)
	git(["tag", tag], { quiet: true })
	git(["push", "origin", tag])
	console.log(`Pushed ${tag}. The desktop release starts from that tag.`)
} catch (error) {
	fail(error instanceof Error ? error.message : String(error))
}
