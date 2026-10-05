/** Shared Playwright helpers for the promo recorder and slide renderer. */
import { chromium, type Page } from "playwright"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"

export const REPO = join(import.meta.dir, "../../..")
export const PROMO = import.meta.dir
export const WORK = join(PROMO, ".work")
export const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173"
export const VIEWPORT = { width: 1600, height: 1000 }

/** Headless has no pointer: draw one, plus a ripple on press. Also hides the Vue devtools pill. */
const OVERLAY = `
addEventListener("DOMContentLoaded", () => {
	const style = document.createElement("style")
	style.textContent = \`
		#__vue-devtools-container__, #vue-inspector-container { display: none !important }
		#promo-cursor { position: fixed; left: 0; top: 0; width: 26px; height: 26px; z-index: 2147483647;
			pointer-events: none; transform: translate(-100px, -100px); transition: none;
			filter: drop-shadow(0 1px 1.5px rgba(0,0,0,.35)) }
		.promo-ripple { position: fixed; z-index: 2147483646; pointer-events: none; width: 36px; height: 36px;
			margin: -18px 0 0 -18px; border-radius: 50%; background: rgba(33,130,248,.35);
			animation: promo-ripple .45s ease-out forwards }
		@keyframes promo-ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }
	\`
	document.head.appendChild(style)
	const cursor = document.createElement("div")
	cursor.id = "promo-cursor"
	cursor.innerHTML = '<svg viewBox="0 0 26 26" width="26" height="26"><path d="M5 2.5v19.2l4.9-4.6 3 6.9 3.4-1.5-3-6.8 6.8-.2z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
	document.body.appendChild(cursor)
	const place = e => { cursor.style.transform = \`translate(\${e.clientX - 5}px, \${e.clientY - 2}px)\` }
	addEventListener("pointermove", place, true)
	addEventListener("pointerdown", e => {
		place(e)
		const r = document.createElement("div")
		r.className = "promo-ripple"
		r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px"
		document.body.appendChild(r); setTimeout(() => r.remove(), 500)
	}, true)
})
`

export async function launch(scale = 2) {
	// Chrome, not the bundled Chromium: the demo videos are H.264
	const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--hide-scrollbars"] })
	const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: scale, colorScheme: "light" })
	await context.addInitScript(OVERLAY)
	return { browser, context }
}

export async function open_demo(page: Page) {
	// the demo pack from piles/ (bun run demo:pack)
	await page.goto(`${CLIENT_URL}/demo`)
	await page.waitForLoadState("networkidle")
	await page.waitForTimeout(1500)
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Center of the first on-board element whose text is exactly `name` (skips the sidebar tree). */
export async function tile(page: Page, name: string, min_x = 300) {
	const items = page.getByText(name, { exact: true })
	const n = await items.count()
	for (let i = 0; i < n; i++) {
		const b = await items.nth(i).boundingBox()
		if (b && b.x > min_x && b.width > 0) return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
	}
	throw new Error(`no tile "${name}"`)
}

/** Navigate by double-clicking tiles, e.g. go(page, "Use cases", "Kanban"). No cursor animation. */
export async function go(page: Page, ...path: string[]) {
	for (const name of path) {
		const p = await tile(page, name)
		await page.mouse.dblclick(p.x, p.y)
		await page.waitForTimeout(1400)
	}
}

/** Human-ish pointer: eased path from the last position. */
export class Pointer {
	x = VIEWPORT.width * 0.62
	y = VIEWPORT.height * 0.72
	constructor(readonly page: Page) {}
	async park() { await this.page.mouse.move(this.x, this.y) }
	async move(x: number, y: number, ms = 600) {
		const steps = Math.max(8, Math.round(ms / 16))
		const [x0, y0] = [this.x, this.y]
		for (let i = 1; i <= steps; i++) {
			const t = i / steps
			const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
			await this.page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e)
			await sleep(ms / steps)
		}
		this.x = x; this.y = y
	}
	async click(x: number, y: number, ms = 600) {
		await this.move(x, y, ms); await sleep(90)
		await this.page.mouse.down(); await sleep(70); await this.page.mouse.up()
	}
	async dblclick(x: number, y: number, ms = 600) {
		await this.move(x, y, ms); await sleep(90)
		await this.page.mouse.dblclick(x, y, { delay: 60 })
	}
	/** Press, travel along `points`, release. */
	async drag(points: { x: number; y: number }[], ms = 900) {
		await this.move(points[0].x, points[0].y); await sleep(120)
		await this.page.mouse.down(); await sleep(120)
		const per = ms / Math.max(1, points.length - 1)
		for (const p of points.slice(1)) await this.move(p.x, p.y, per)
		await sleep(120); await this.page.mouse.up()
	}
}

/**
 * CDP screencast → timestamped JPEGs → constant-fps H.264 (needs full ffmpeg).
 * Frames only arrive when pixels change, so each frame lasts until the next.
 */
export async function record(page: Page, out_mp4: string, body: () => Promise<void>) {
	const dir = out_mp4.replace(/\.mp4$/, ".frames")
	rmSync(dir, { recursive: true, force: true })
	mkdirSync(dir, { recursive: true })
	const cdp = await page.context().newCDPSession(page)
	const frames: { file: string; ts: number }[] = []
	cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
		const file = join(dir, `${String(frames.length).padStart(5, "0")}.jpg`)
		writeFileSync(file, Buffer.from(data, "base64"))
		frames.push({ file, ts: metadata.timestamp ?? Date.now() / 1000 })
		await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {})
	})
	await cdp.send("Page.startScreencast", {
		format: "jpeg", quality: 92, everyNthFrame: 1,
		maxWidth: VIEWPORT.width * 2, maxHeight: VIEWPORT.height * 2,
	})
	// nudge a first frame
	await page.evaluate(() => document.body.style.setProperty("--promo-tick", "1"))
	const start = Date.now() / 1000
	await body()
	const end = Date.now() / 1000
	await cdp.send("Page.stopScreencast")
	await sleep(200)
	if (!frames.length) throw new Error("no frames captured")

	const list = frames.map((f, i) => {
		const next = frames[i + 1]?.ts ?? end
		const dur = Math.max(0.001, next - Math.max(f.ts, i === 0 ? start : f.ts))
		return `file '${f.file}'\nduration ${dur.toFixed(4)}`
	}).join("\n") + `\nfile '${frames.at(-1)!.file}'\n`
	writeFileSync(join(dir, "list.txt"), list)
	const proc = Bun.spawnSync(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"),
		"-vf", `fps=30,scale=${VIEWPORT.width * 2}:${VIEWPORT.height * 2}:flags=lanczos,format=yuv420p`,
		"-c:v", "libx264", "-preset", "slow", "-crf", "14", out_mp4])
	if (proc.exitCode !== 0) throw new Error(proc.stderr.toString())
	rmSync(dir, { recursive: true, force: true })
	console.log(`recorded ${out_mp4} (${frames.length} frames, ${(end - start).toFixed(1)} s)`)
}
