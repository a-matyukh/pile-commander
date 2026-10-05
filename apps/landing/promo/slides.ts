/**
 * ProductHunt gallery: 1270×760 slides rendered at 2× from real app stills.
 *
 *   bun apps/landing/promo/slides.ts   → apps/landing/promo/out/slides/*.png
 */
import { chromium } from "playwright"
import { mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { PROMO, WORK, REPO } from "./lib"

const STILLS = join(WORK, "stills")
const OUT = join(PROMO, "out/slides")
mkdirSync(OUT, { recursive: true })

const W = 1270, H = 760
const img = (file: string) => `data:image/png;base64,${readFileSync(file).toString("base64")}`
const ICON = img(join(REPO, "apps/landing/public/app-icon.png"))
const still = (name: string) => img(join(STILLS, `${name}.png`))

const CSS = `
	* { box-sizing: border-box; margin: 0 }
	html, body { width: ${W}px; height: ${H}px; overflow: hidden }
	body { font-family: -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif; color: #0f172a;
		-webkit-font-smoothing: antialiased; position: relative }
	.light { background:
		radial-gradient(800px 500px at 10% -10%, #c5e0fd 0%, transparent 60%),
		radial-gradient(700px 500px at 110% 110%, #e8f3fe 0%, transparent 60%),
		linear-gradient(180deg, #f5f9ff 0%, #eef4fc 100%) }
	.dark { color: #fff; background:
		radial-gradient(800px 600px at 85% 0%, #1553aa 0%, transparent 65%),
		radial-gradient(700px 500px at 0% 100%, #103d80 0%, transparent 60%), #071a38 }
	h1 { font-size: 46px; font-weight: 800; letter-spacing: -0.025em; line-height: 1.08 }
	.lede { font-size: 20px; line-height: 1.45; color: #475569; margin-top: 14px }
	.dark .lede { color: #c5e0fd }
	/* an app window: crop = how much of the left sidebar to hide (fraction of width) */
	.win { position: absolute; border-radius: 12px; overflow: hidden; background: #fff;
		box-shadow: 0 24px 60px -18px rgba(7,26,56,.45), 0 0 0 1px rgba(7,26,56,.10) }
	.win img { position: absolute; top: 0; height: 100%; }
	.label { position: absolute; font-size: 15px; font-weight: 700; padding: 5px 12px; border-radius: 99px;
		background: #2182f8; color: #fff; box-shadow: 0 6px 16px rgba(33,130,248,.35) }
	.pills { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 26px }
	.pill { font-size: 15px; font-weight: 600; padding: 7px 14px; border-radius: 99px; background: rgba(33,130,248,.12); color: #1553aa }
	.dark .pill { background: rgba(62,153,248,.22); color: #e8f3fe }
	.brand { position: absolute; display: flex; gap: 10px; align-items: center; font-size: 17px; font-weight: 700 }
	.brand img { width: 30px; height: 30px; border-radius: 7px }
`

/** App window at (x, y, w) showing a 1600×1000 still; `crop` hides that many CSS px of the left sidebar. */
function win(src: string, x: number, y: number, w: number, crop = 0, extra = "") {
	const scale = w / (1600 - crop)
	const h = Math.round(1000 * scale)
	return `<div class="win" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;${extra}">
		<img src="${src}" style="left:${-crop * scale}px;width:${1600 * scale}px"></div>`
}

/** Window of size w×h showing the still's region starting at (rx, ry) with width rw (1600×1000 CSS px). */
function region(src: string, x: number, y: number, w: number, h: number, rx: number, ry: number, rw: number, extra = "") {
	const scale = w / rw
	return `<div class="win" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;${extra}">
		<img src="${src}" style="left:${-rx * scale}px;top:${-ry * scale}px;width:${1600 * scale}px;height:auto"></div>`
}

const brand = (x: number, y: number, dark = false) =>
	`<div class="brand" style="left:${x}px;top:${y}px;color:${dark ? "#fff" : "#0f172a"}"><img src="${ICON}">Pile Commander</div>`

const slides: Record<string, string> = {
	"01-hero": `<body class="dark">
		<div style="position:absolute;left:64px;top:150px;width:470px">
			<img src="${ICON}" style="width:84px;height:84px;border-radius:19px;box-shadow:0 14px 40px rgba(0,0,0,.35)">
			<h1 style="font-size:56px;margin-top:30px">Pile Commander</h1>
			<div class="lede" style="font-size:25px;color:#9dccfb;margin-top:12px">File manager with unusual possibilities</div>
			<div class="lede" style="margin-top:22px">Folders that open as a board, a canvas, a stack, a masonry wall or slides — and stay ordinary folders on your disk.</div>
			<div class="pills"><span class="pill">Desktop &amp; web</span><span class="pill">Free, no account</span><span class="pill">Local or cloud</span></div>
		</div>
		${win(still("moodboard"), 580, 110, 800, 0)}
	</body>`,

	"02-views": `<body class="light">
		<div style="position:absolute;left:0;right:0;top:44px;text-align:center">
			<h1>One folder. Seven ways to look at it.</h1>
			<div class="lede">Every folder remembers its own view. Same files, just arranged differently.</div>
		</div>
		${region(still("moodboard"), 60, 175, 560, 262, 288, 44, 1100)}<span class="label" style="left:76px;top:395px">Board</span>
		${region(still("view-masonry"), 650, 175, 560, 262, 288, 44, 1100)}<span class="label" style="left:666px;top:395px">Masonry</span>
		${region(still("view-slides"), 60, 462, 560, 262, 288, 44, 1100)}<span class="label" style="left:76px;top:682px">Slides</span>
		${region(still("view-canvas"), 650, 462, 560, 262, 288, 44, 1100)}<span class="label" style="left:666px;top:682px">Canvas</span>
	</body>`,

	"03-canvas": `<body class="light">
		<div style="position:absolute;left:56px;top:130px;width:340px">
			<h1>When a pile needs a map.</h1>
			<div class="lede">Switch any folder to Canvas: an infinite surface where you connect things, draw over them and zoom from 20% to 400%.</div>
			<div class="pills"><span class="pill">Connectors &amp; labels</span><span class="pill">Pen in any colour</span><span class="pill">Lasso</span><span class="pill">Pinch &amp; zoom</span></div>
		</div>
		${region(still("system"), 700, 50, 540, 300, 288, 44, 1100)}
		${region(still("brainstorm-ink"), 430, 230, 790, 500, 288, 30, 1312)}
	</body>`,

	"04-media": `<body class="light">
		<div style="position:absolute;left:0;right:0;top:44px;text-align:center">
			<h1>Notes, media, 3D models — and live folders.</h1>
			<div class="lede">Drop things in and they show up as themselves. Sub-folders render their own view, right inside the parent.</div>
		</div>
		${region(still("media"), 60, 190, 570, 500, 292, 60, 830)}<span class="label" style="left:76px;top:648px">Images · video · audio · 3D</span>
		${region(still("kanban"), 650, 190, 570, 500, 310, 56, 960)}<span class="label" style="left:666px;top:648px">Columns are folders, cards are files</span>
	</body>`,

	"05-use-cases": `<body class="dark">
		<div style="position:absolute;left:0;right:0;top:44px;text-align:center">
			<h1>Moodboards, plans, research — set up your way.</h1>
			<div class="lede">20 ready-made workspaces to open and pull apart.</div>
		</div>
		${win(still("trip"), 50, 230, 520, 288, "transform:rotate(-3deg)")}
		${win(still("study"), 700, 230, 520, 288, "transform:rotate(3deg)")}
		${win(still("wedding"), 330, 190, 610, 288)}
	</body>`,

	"06-files": `<body class="light">
		<div style="position:absolute;left:0;right:0;top:56px;text-align:center">
			<h1>Your board is a folder. Your folder is a board.</h1>
			<div class="lede">Notes are .md and .txt, shapes are .svg. Layout rides along in extended attributes — Finder and Explorer changes show up live.</div>
		</div>
		<div style="position:absolute;left:70px;right:70px;top:250px;display:flex;gap:26px">
			${[
				["On your disk", "Desktop app for macOS, Windows and Linux. Real folders, .pile archives.", "Free · no account"],
				["In the browser", "Nothing to install. Add it to your home screen.", "Free · no account"],
				["In the cloud", "Invite people, edit live, publish a link or list it on the Hub.", "Free plan · 100 MB"],
			].map(([t, d, tag]) => `<div style="flex:1;padding:30px 28px;border-radius:20px;background:#fff;box-shadow:0 18px 40px -20px rgba(7,26,56,.35),0 0 0 1px rgba(7,26,56,.06)">
				<div style="font-size:27px;font-weight:800;letter-spacing:-0.01em">${t}</div>
				<div style="font-size:18px;color:#475569;margin-top:10px;line-height:1.45;min-height:78px">${d}</div>
				<span class="pill" style="display:inline-block;margin-top:16px">${tag}</span></div>`).join("")}
		</div>
		<div style="position:absolute;left:0;right:0;bottom:56px;display:flex;justify-content:center">
			<div style="font-size:24px;font-weight:700;padding:14px 32px;border-radius:14px;background:#2182f8;color:#fff;box-shadow:0 14px 34px rgba(33,130,248,.4)">Start with a folder — ${process.env.PROMO_URL ?? "pile-commander.com"}</div>
		</div>
	</body>`,
}

const browser = await chromium.launch({ channel: "chrome" })
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })
for (const [name, body] of Object.entries(slides)) {
	await page.setContent(`<html><head><style>${CSS}</style></head>${body}</html>`, { waitUntil: "load" })
	await page.screenshot({ path: join(OUT, `${name}.png`) })
}
await browser.close()
console.log(`${Object.keys(slides).length} slides → ${OUT}`)
