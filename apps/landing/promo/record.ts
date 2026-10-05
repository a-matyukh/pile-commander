/**
 * Records the promo shots from the real web client, seeded with piles/.
 *
 *   bun apps/landing/promo/record.ts            # every shot
 *   bun apps/landing/promo/record.ts canvas     # one shot
 *
 * Needs the client dev server (bun run dev:web) and export-piles.ts output.
 */
import type { Page } from "playwright"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { launch, open_demo, go, tile, record, sleep, Pointer, WORK } from "./lib"

const SHOTS = join(WORK, "shots")
const STILLS = join(WORK, "stills")
mkdirSync(SHOTS, { recursive: true })
mkdirSync(STILLS, { recursive: true })

async function center(page: Page, selector: string) {
	const b = await page.locator(`${selector} >> visible=true`).first().boundingBox({ timeout: 3000 })
	if (!b) throw new Error(`not visible: ${selector}`)
	return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

async function switch_view(page: Page, pointer: Pointer, view: string) {
	const trigger = await center(page, ".workspace-tab button[aria-label=Create]")
	await pointer.click(trigger.x, trigger.y, 500)
	await sleep(350)
	const item = await center(page, "[role=menuitem]:has-text('View')")
	await pointer.move(item.x, item.y, 350)
	await page.locator("[role=menuitem]:has-text('View') >> visible=true").first().hover()
	await sleep(400)
	const option = page.getByRole("menuitemcheckbox", { name: view, exact: true }).locator("visible=true")
	const b = await option.boundingBox({ timeout: 3000 })
	if (!b) throw new Error(`no view item ${view}`)
	await pointer.move(b.x + 40, item.y, 200)
	await pointer.click(b.x + 40, b.y + b.height / 2, 300)
}

type Shot = (page: Page, pointer: Pointer) => Promise<void>

const shots: Record<string, { setup: (page: Page) => Promise<void>; body: Shot }> = {
	// One folder, many views
	views: {
		setup: page => go(page, "Use cases", "Moodboard"),
		async body(page, p) {
			await sleep(700)
			for (const view of ["Masonry", "Slides", "Canvas", "Board"]) {
				await switch_view(page, p, view)
				await p.move(1180, 820, 400)
				await sleep(700)
			}
		},
	},

	// Media shown as itself: orbit the 3D model, play the video
	media: {
		setup: page => go(page, "Features", "Media files preview"),
		async body(page, p) {
			await sleep(500)
			const model = await center(page, "model-viewer, canvas")
			await p.drag([
				{ x: model.x - 30, y: model.y },
				{ x: model.x + 60, y: model.y - 10 },
				{ x: model.x + 130, y: model.y + 10 },
			], 1300)
			await sleep(300)
			const video = await center(page, "video")
			await p.move(video.x, video.y - 20, 700)
			await page.evaluate(() => { const v = document.querySelector("video")!; v.muted = true; return v.play() })
			await sleep(400)
			await p.move(video.x + 250, video.y + 180, 900)
			await sleep(2400)
		},
	},

	// Canvas: draw with the pen, then zoom out
	canvas: {
		setup: page => go(page, "Use cases", "Brainstorm"),
		async body(page, p) {
			await sleep(400)
			const pen = await center(page, "button:has-text('Pen')")
			await p.click(pen.x, pen.y, 700)
			await sleep(250)
			const color = await center(page, "button:has-text('Color')")
			await p.click(color.x, color.y, 400)
			await sleep(300)
			// swatches: black, red, orange, yellow, green, blue, purple, pink
			const swatch = { x: color.x + 17, y: color.y + 49 }
			await p.click(swatch.x, swatch.y, 350)
			await sleep(250)
			const c = await tile(page, "Top 3 after voting 🏆").catch(() => ({ x: 1430, y: 265 }))
			const cx = c.x + 5, cy = c.y + 55
			const pts = Array.from({ length: 44 }, (_, i) => {
				const a = (i / 43) * Math.PI * 2.2 - Math.PI * 0.6
				return { x: cx + Math.cos(a) * 128, y: cy + Math.sin(a) * 100 + Math.sin(i / 3) * 3 }
			})
			await p.drag(pts, 1300)
			await sleep(250)
			const hand = await center(page, "button:has-text('Hand')")
			await p.click(hand.x, hand.y, 600)
			await sleep(150)
			await p.drag([{ x: 820, y: 880 }, { x: 700, y: 820 }, { x: 560, y: 760 }], 900)
			await sleep(250)
			await p.drag([{ x: 560, y: 760 }, { x: 700, y: 830 }, { x: 830, y: 880 }], 900)
			await p.move(1100, 900, 500)
			await sleep(700)
		},
	},

	// Drag a card to another column: columns are folders, cards are files
	kanban: {
		setup: page => go(page, "Use cases", "Kanban"),
		async body(page, p) {
			await sleep(400)
			const card = page.locator(".draggable-item", { hasText: "Write About page copy" }).first()
			const box = (await card.boundingBox())!
			await p.move(box.x + box.width / 2, box.y + box.height / 2, 700)
			await sleep(300)
			// the ⠿ grip on the row's right
			const h = { x: box.x + box.width - 50, y: box.y + box.height / 2 }
			// a column is a folder in Stack view: reorder by dragging
			await p.drag([
				h,
				{ x: h.x + 2, y: h.y + 12 },
				{ x: h.x, y: h.y + 90 },
				{ x: h.x, y: h.y + 175 },
				{ x: h.x, y: h.y + 215 },
			], 1300)
			await p.move(box.x + box.width + 420, box.y + 420, 800)
			await sleep(1200)
		},
	},

	// Into a folder and back: a board is just a folder
	navigate: {
		setup: page => go(page, "Use cases"),
		async body(page, p) {
			await sleep(500)
			const t = await tile(page, "Family trip")
			await p.dblclick(t.x, t.y, 900)
			await sleep(2200)
		},
	},
}

/** Still frames for the montage and the slides (2× screenshots, no cursor). */
const stills: Record<string, string[]> = {
	moodboard: ["Use cases", "Moodboard"],
	trip: ["Use cases", "Trip planner"],
	wedding: ["Use cases", "Wedding"],
	system: ["Use cases", "System design"],
	study: ["Use cases", "Study"],
	renovation: ["Use cases", "Renovation"],
	family: ["Use cases", "Family trip"],
	screenplay: ["Use cases", "Screenplay"],
	startup: ["Use cases", "Startup launch"],
	recipes: ["Use cases", "Recipes"],
	kanban: ["Use cases", "Kanban"],
	brainstorm: ["Use cases", "Brainstorm"],
	usecases: ["Use cases"],
	media: ["Features", "Media files preview"],
	canvas: ["Features", "Canvas"],
}

async function shoot_clean(page: Page, path: string) {
	await page.evaluate(() => document.getElementById("promo-cursor")?.style.setProperty("visibility", "hidden"))
	await page.screenshot({ path })
	await page.evaluate(() => document.getElementById("promo-cursor")?.style.removeProperty("visibility"))
}

/** The Moodboard in other views, for the slides. */
const view_stills = ["Masonry", "Slides", "List", "Canvas", "Grid"]

const only = process.argv.slice(2)
const { browser, context } = await launch(2)
try {
	for (const [name, shot] of Object.entries(shots)) {
		if (only.length && !only.includes(name)) continue
		const page = await context.newPage()
		await open_demo(page)
		await shot.setup(page)
		const pointer = new Pointer(page)
		await pointer.park()
		await sleep(600)
		await record(page, join(SHOTS, `${name}.mp4`), () => shot.body(page, pointer))
		await page.close()
	}
	for (const [name, path] of Object.entries(stills)) {
		if (only.length && !only.includes("stills") && !only.includes(`still:${name}`)) continue
		const page = await context.newPage()
		await open_demo(page)
		await go(page, ...path)
		await page.mouse.move(-10, -10)
		await sleep(1200)
		await shoot_clean(page, join(STILLS, `${name}.png`))
		await page.close()
	}
	if (!only.length || only.includes("stills") || only.includes("views-stills")) {
		const page = await context.newPage()
		await open_demo(page)
		await go(page, "Use cases", "Moodboard")
		const pointer = new Pointer(page)
		for (const view of view_stills) {
			await switch_view(page, pointer, view)
			await page.mouse.move(-10, -10)
			await sleep(1500)
			await shoot_clean(page, join(STILLS, `view-${view.toLowerCase()}.png`))
		}
		await page.close()
	}
} finally {
	await browser.close()
}
