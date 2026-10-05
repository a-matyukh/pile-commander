/**
 * Rebuild the demo pack from piles/ and commit it — the whole update cycle.
 *
 *   bun run demo:publish            # rebuild + commit the pack
 *   bun run demo:publish --push     # … and push: a push to main deploys the web demo
 *
 * Only the pack's output is committed; anything else you have staged or
 * modified stays as it was. Nothing changed in piles/ → nothing is committed.
 */
import { join } from "node:path"

const REPO = join(import.meta.dir, "../../..")
const OUTPUTS = ["apps/client/public/demo-pack", "apps/landing/public/demos"]
const push = process.argv.includes("--push")

function run(cmd: string[], opts: { quiet?: boolean } = {}): string {
	const proc = Bun.spawnSync(cmd, { cwd: REPO, stdout: "pipe", stderr: "pipe" })
	const out = proc.stdout.toString()
	if (proc.exitCode !== 0) {
		throw new Error(`${cmd.join(" ")} failed:\n${proc.stderr.toString() || out}`)
	}
	if (!opts.quiet && out.trim()) console.log(out.trimEnd())
	return out
}

// the pack must be committed where the web deploys from; a surprise branch is worth a stop
const branch = run(["git", "branch", "--show-current"], { quiet: true }).trim()
if (push && branch !== "main") {
	throw new Error(`on branch "${branch}": --push deploys only from main. Switch to main or drop --push.`)
}

console.log("Rebuilding the demo pack from piles/ …")
run(["bun", join(import.meta.dir, "export-demo-pack.ts")])

if (!run(["git", "status", "--porcelain", "--", ...OUTPUTS], { quiet: true }).trim()) {
	console.log("The demo is up to date: nothing to commit.")
	process.exit(0)
}

run(["git", "add", "-A", "--", ...OUTPUTS], { quiet: true })
console.log("\nChanges:")
run(["git", "diff", "--cached", "--stat", "--", ...OUTPUTS])
// pathspec commit: only the pack goes in, other staged work stays staged
run(["git", "commit", "--quiet", "-m", "Update demo pack", "--", ...OUTPUTS], { quiet: true })
console.log(`\nCommitted on ${branch}: ${run(["git", "log", "-1", "--format=%h %s"], { quiet: true }).trim()}`)

if (push) {
	run(["git", "push", "--quiet"], { quiet: true })
	console.log("Pushed. The web demo and the landing downloads update with the next deploy.")
} else {
	console.log("Not pushed. Review it, then `git push` (or re-run with --push next time).")
}
