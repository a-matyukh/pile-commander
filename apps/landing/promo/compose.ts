/**
 * Shots + stills (record.ts) → apps/landing/public/demo.mp4 (1920×1080, ≤ 60 s)
 * plus a poster. Captions and cards are HTML rendered by Playwright, so text
 * is crisp and uses the same stack as the slides.
 *
 *   bun apps/landing/promo/compose.ts
 */
import { chromium } from "playwright"
import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from "node:fs"
import { join } from "node:path"
import { PROMO, WORK, REPO } from "./lib"

export const URL_TEXT = process.env.PROMO_URL ?? "pile-commander.com"
const SHOTS = join(WORK, "shots")
const STILLS = join(WORK, "stills")
const FRAMES = join(WORK, "frames")
const SEG = join(WORK, "segments")
const OUT = join(PROMO, "out")
for (const dir of [FRAMES, SEG, OUT]) mkdirSync(dir, { recursive: true })

const W = 1920, H = 1080, FPS = 30, FADE = 0.4
// the app window inside the frame
const WIN = { x: 250, y: 162, w: 1420, h: 888 }

const ICON = `data:image/png;base64,${readFileSync(join(REPO, "apps/landing/public/app-icon.png")).toString("base64")}`

export const BASE_CSS = `
	* { box-sizing: border-box; margin: 0 }
	html, body { width: ${W}px; height: ${H}px; overflow: hidden }
	body { font-family: -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif; color: #0f172a;
		-webkit-font-smoothing: antialiased }
	.light { background:
		radial-gradient(1200px 700px at 15% -10%, #c5e0fd 0%, transparent 60%),
		radial-gradient(1000px 700px at 110% 110%, #e8f3fe 0%, transparent 60%),
		linear-gradient(180deg, #f5f9ff 0%, #eef4fc 100%) }
	.dark { color: #fff; background:
		radial-gradient(1100px 800px at 80% 0%, #1553aa 0%, transparent 65%),
		radial-gradient(900px 700px at 0% 100%, #103d80 0%, transparent 60%),
		#071a38 }
`

/** Light background, caption on top, a shadowed slot where the app window goes. */
function frame_html(caption: string, sub = "") {
	return `<html><head><style>${BASE_CSS}
		.cap { position: absolute; left: 0; right: 0; top: ${sub ? 34 : 50}px; text-align: center;
			font-size: 50px; font-weight: 700; letter-spacing: -0.02em }
		.sub { position: absolute; left: 0; right: 0; top: 102px; text-align: center; font-size: 25px; color: #475569 }
		.win { position: absolute; left: ${WIN.x}px; top: ${WIN.y}px; width: ${WIN.w}px; height: ${WIN.h}px;
			border-radius: 16px; background: #fff;
			box-shadow: 0 30px 80px -20px rgba(7,26,56,.35), 0 0 0 1px rgba(7,26,56,.08) }
		.brand { position: absolute; left: 40px; bottom: 30px; display: flex; gap: 10px; align-items: center;
			font-size: 18px; font-weight: 600; color: #334155; opacity: .0 }
	</style></head><body class="light">
		<div class="cap">${caption}</div>${sub ? `<div class="sub">${sub}</div>` : ""}
		<div class="win"></div>
	</body></html>`
}

function card_html(kind: "title" | "files" | "outro") {
	const icon = (size: number) => `<img src="${ICON}" style="width:${size}px;height:${size}px;border-radius:${size * 0.22}px;box-shadow:0 20px 60px rgba(0,0,0,.35)">`
	const center = "display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center"
	if (kind === "title") return `<html><head><style>${BASE_CSS}</style></head><body class="dark"><div style="${center}">
		${icon(168)}
		<div style="font-size:92px;font-weight:800;letter-spacing:-0.03em;margin-top:44px">Pile Commander</div>
		<div style="font-size:40px;color:#9dccfb;margin-top:18px;font-weight:500">File manager with unusual possibilities</div>
	</div></body></html>`
	if (kind === "files") {
		const col = (t: string, d: string, tag: string, svg: string) => `
			<div style="width:430px;padding:40px 36px;border-radius:24px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14)">
				<div style="width:64px;height:64px;border-radius:16px;background:#2182f8;display:flex;align-items:center;justify-content:center">${svg}</div>
				<div style="font-size:38px;font-weight:700;margin-top:26px">${t}</div>
				<div style="font-size:23px;color:#c5e0fd;margin-top:12px;line-height:1.4">${d}</div>
				<div style="display:inline-block;margin-top:22px;font-size:18px;font-weight:600;padding:7px 14px;border-radius:99px;background:rgba(62,153,248,.25);color:#e8f3fe">${tag}</div>
			</div>`
		const s = (d: string) => `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
		return `<html><head><style>${BASE_CSS}</style></head><body class="dark"><div style="${center}">
			<div style="font-size:64px;font-weight:800;letter-spacing:-0.025em">Files stay files.</div>
			<div style="font-size:30px;color:#9dccfb;margin-top:16px">Your board is a folder — layout rides along in its attributes.</div>
			<div style="display:flex;gap:36px;margin-top:64px;text-align:left">
				${col("On your disk", "Real folders. Finder and Explorer changes show up live.", "Free · no account", s('<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8M12 18v3"/>'))}
				${col("In the browser", "Nothing to install. Add it to your home screen.", "Free · no account", s('<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>'))}
				${col("In the cloud", "Invite people, edit live, publish a link.", "Free plan · 100 MB", s('<path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 0 0 4 12.5 3.5 3.5 0 0 0 6.5 19z"/>'))}
			</div>
		</div></body></html>`
	}
	return `<html><head><style>${BASE_CSS}</style></head><body class="dark"><div style="${center}">
		${icon(140)}
		<div style="font-size:84px;font-weight:800;letter-spacing:-0.03em;margin-top:40px">Start with a folder.</div>
		<div style="font-size:34px;color:#c5e0fd;margin-top:18px">Free · macOS, Windows, Linux &amp; web</div>
		<div style="margin-top:52px;font-size:38px;font-weight:700;padding:20px 44px;border-radius:18px;background:#2182f8;box-shadow:0 18px 50px rgba(33,130,248,.45)">${URL_TEXT}</div>
	</div></body></html>`
}

function mask_html() {
	return `<html><head><style>html,body{margin:0;background:#000;width:${WIN.w}px;height:${WIN.h}px}
		div{width:100%;height:100%;border-radius:16px;background:#fff}</style></head><body><div></div></body></html>`
}

type Segment =
	| { name: string; kind: "card"; card: "title" | "files" | "outro"; dur: number }
	| { name: string; kind: "shot"; src: string; caption: string; sub?: string; start?: number; speed?: number; dur: number }

const segments: Segment[] = [
	{ name: "01-title", kind: "card", card: "title", dur: 3.4 },
	{ name: "02-views", kind: "shot", src: "views.mp4", caption: "One folder. Seven ways to look at it.", sub: "List · Grid · Board · Canvas · Stack · Masonry · Slides", start: 0.3, speed: 1.6, dur: 11.2 },
	{ name: "03-media", kind: "shot", src: "media.mp4", caption: "Notes, media, 3D models — shown as themselves.", start: 0.2, speed: 1.2, dur: 7.4 },
	{ name: "04-canvas", kind: "shot", src: "canvas.mp4", caption: "When a pile needs a map.", sub: "An infinite canvas with a pen, connectors and pan & zoom", start: 0.3, speed: 1.9, dur: 10.4 },
	{ name: "05-kanban", kind: "shot", src: "kanban.mp4", caption: "Folders inside folders — live.", sub: "Each column is a folder. Each card is a file.", start: 0.2, speed: 1.15, dur: 5.6 },
	{ name: "06-montage", kind: "shot", src: "montage.mp4", caption: "Moodboards, plans, research — set up your way.", dur: 7.4 },
	{ name: "07-files", kind: "card", card: "files", dur: 5.6 },
	{ name: "08-outro", kind: "card", card: "outro", dur: 4.6 },
]

const MONTAGE = ["moodboard", "trip", "wedding", "system", "study", "renovation"]
const STILL_DUR = 1.25

function ff(args: string[]) {
	const p = Bun.spawnSync(["ffmpeg", "-loglevel", "error", "-y", ...args])
	if (p.exitCode !== 0) throw new Error(p.stderr.toString())
}

// 1. HTML → PNG
const browser = await chromium.launch({ channel: "chrome" })
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
async function png(html: string, file: string, size = { width: W, height: H }) {
	await page.setViewportSize(size)
	await page.setContent(html, { waitUntil: "load" })
	await page.screenshot({ path: file })
}
await png(mask_html(), join(FRAMES, "mask.png"), { width: WIN.w, height: WIN.h })
for (const s of segments) {
	await png(s.kind === "card" ? card_html(s.card) : frame_html(s.caption, s.sub), join(FRAMES, `${s.name}.png`))
}
await browser.close()

// 2. montage of stills: slow push-in on each, hard cuts
const frames_per = Math.round(STILL_DUR * FPS)
for (const [i, still] of MONTAGE.entries()) {
	ff(["-loop", "1", "-i", join(STILLS, `${still}.png`), "-vf",
		`scale=3200:2000,zoompan=z='1+0.035*on/${frames_per}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames_per}:s=${WIN.w * 2}x${WIN.h * 2}:fps=${FPS},format=yuv420p`,
		"-frames:v", String(frames_per), "-c:v", "libx264", "-crf", "14", join(SEG, `m${i}.mp4`)])
}
writeFileSync(join(SEG, "montage.txt"), MONTAGE.map((_, i) => `file 'm${i}.mp4'`).join("\n"))
ff(["-f", "concat", "-safe", "0", "-i", join(SEG, "montage.txt"), "-c", "copy", join(SHOTS, "montage.mp4")])

// 3. one mp4 per segment
for (const s of segments) {
	const out = join(SEG, `${s.name}.mp4`)
	if (s.kind === "card") {
		// gentle scale-in so cards are not dead stills
		const n = Math.round(s.dur * FPS)
		ff(["-loop", "1", "-i", join(FRAMES, `${s.name}.png`), "-vf",
			`scale=${W * 2}:${H * 2},zoompan=z='1.04-0.04*on/${n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${n}:s=${W}x${H}:fps=${FPS},format=yuv420p`,
			"-frames:v", String(n), "-c:v", "libx264", "-crf", "16", out])
		continue
	}
	const speed = s.speed ?? 1
	ff(["-loop", "1", "-i", join(FRAMES, `${s.name}.png`),
		"-i", join(SHOTS, s.src),
		"-loop", "1", "-i", join(FRAMES, "mask.png"),
		"-filter_complex",
		`[1:v]trim=start=${s.start ?? 0},setpts=(PTS-STARTPTS)/${speed},fps=${FPS},scale=${WIN.w}:${WIN.h}:flags=lanczos,format=rgba,tpad=stop_mode=clone:stop_duration=10[v];` +
		`[2:v]format=gray,scale=${WIN.w}:${WIN.h}[m];[v][m]alphamerge[vm];` +
		`[0:v][vm]overlay=${WIN.x}:${WIN.y},format=yuv420p[o]`,
		"-map", "[o]", "-t", String(s.dur), "-r", String(FPS), "-c:v", "libx264", "-crf", "16", out])
}

// 4. crossfade chain
const inputs = segments.flatMap(s => ["-i", join(SEG, `${s.name}.mp4`)])
let chain = ""
let prev = "[0:v]"
let offset = 0
for (let i = 1; i < segments.length; i++) {
	offset += segments[i - 1].dur - FADE
	const label = i === segments.length - 1 ? "[out]" : `[x${i}]`
	chain += `${prev}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}${label};`
	prev = label
}
const final = join(OUT, "demo.mp4")
ff([...inputs, "-filter_complex", chain.replace(/;$/, ""), "-map", "[out]",
	"-c:v", "libx264", "-preset", "slow", "-crf", "21", "-pix_fmt", "yuv420p", "-profile:v", "high",
	"-movflags", "+faststart", "-an", final])
ff(["-ss", "1.2", "-i", final, "-frames:v", "1", "-q:v", "3", join(OUT, "demo-poster.jpg")])
copyFileSync(final, join(REPO, "apps/landing/public/demo.mp4"))
copyFileSync(join(OUT, "demo-poster.jpg"), join(REPO, "apps/landing/public/demo-poster.jpg"))

const total = segments.reduce((a, s) => a + s.dur, 0) - FADE * (segments.length - 1)
console.log(`demo.mp4 ≈ ${total.toFixed(1)} s → ${final} (copied to apps/landing/public/demo.mp4)`)
