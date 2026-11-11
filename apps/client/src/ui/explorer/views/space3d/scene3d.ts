import {
	BoxGeometry,
	CircleGeometry,
	DirectionalLight,
	Group,
	HemisphereLight,
	MOUSE,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	NeutralToneMapping,
	PerspectiveCamera,
	PlaneGeometry,
	Plane,
	PMREMGenerator,
	Raycaster,
	Scene,
	Spherical,
	TOUCH,
	Vector2,
	Vector3,
	WebGLRenderer,
	type Material,
	type Object3D,
	type Texture,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import {
	COLORS,
	Face,
	content_image,
	darken,
	icon_image,
	lighten,
	paint_file,
	paint_floor,
	paint_folder,
	paint_image,
	paint_note,
	paint_status,
	shadow_texture,
	type Painter,
} from './paint'
import { folder_shape, ring_geometry, rounded_rect, slab } from './shapes'
import { dispose_tree, fit_model, load_model } from './models'
import type { LabelSpot, Scene3D, SceneFrame, SceneItem, SceneOptions } from './types'

/**
 * The 3D view of a folder: the board lies as a floor, cards float over it
 * and models stand on it. x/y of the board map to x/z of the scene, the
 * item's height to y. A frame is drawn only when something changes.
 */

/** Scene units per board pixel: 100 px of the board are one unit */
const U = 0.01
const DEG = Math.PI / 180

const HOME_PHI = 50 * DEG
const TOP_PHI = 0.0001
const FLY_MS = 650
const INTO_MS = 420
const ZOOM_MS = 220

/** Default height of a card; each earlier card it overlaps lifts it one step more (px) */
const CARD_HEIGHT = 14
const STACK_STEP = 6
const MAX_HEIGHT = 900
/** Lift of a hovered or selected card, units */
const LIFT = 0.08
/** Folder tab: share of the folder's depth */
const TAB = 0.16

const DEPTH = { note: 0.02, card: 0.03, folder: 0.07, status: 0.015, floor: 0.08 }
const FLOOR_MARGIN = 80
const FLOOR_MIN = { w: 520, h: 360 }
const GRID_STEP = 40

const CLICK_MOVE = 5
const CLICK_MS = 500
const DOUBLE_MS = 450
const LONG_PRESS_MS = 550

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

type Live = {
	item: SceneItem
	look: string
	root: Group
	body: Group
	/** What the pointer hits: the card, or an invisible box around a model */
	hit: Object3D | null
	shadow: Mesh
	ring: Mesh
	line: Mesh
	dot: Mesh
	/** Height of the bottom above the floor, units */
	base: number
	lift: number
	ring_k: number
	/** Height of the visual above its bottom, units */
	top: number
	spin: Group | null
	appear: number
	faces: Face[]
	/** Bumped on rebuild and removal, so late loads know they are stale */
	token: number
}

type Pose = { target: Vector3; radius: number; phi: number; theta: number }

type Fly = {
	from: Pose
	to: Pose
	start: number
	ms: number
	done: () => void
}

type Press = { id: number; x: number; y: number; t: number; button: number; ctrl: boolean; key: string | null }

type Drag = {
	key: string
	live: Live
	started: boolean
	mode: 'floor' | 'height'
	plane: Plane
	/** From the item's anchor to where the pointer grabbed it */
	grab: Vector3
	from: { x: number; y: number; z: number | null; base: number }
}

let height_hint_shown = false

export function create_scene3d(container: HTMLElement, options: SceneOptions): Scene3D {
	let motion = options.motion
	let movable = options.movable
	let active = true
	let disposed = false

	// ── Renderer, camera, light ──────────────────────────────────────────
	const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
	renderer.setClearColor(0x000000, 0)
	renderer.toneMapping = NeutralToneMapping
	const canvas = renderer.domElement
	canvas.style.display = 'block'
	canvas.style.width = '100%'
	canvas.style.height = '100%'
	container.appendChild(canvas)
	const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())

	const scene = new Scene()
	const pmrem = new PMREMGenerator(renderer)
	const room = new RoomEnvironment()
	const environment = pmrem.fromScene(room, 0.04).texture
	scene.environment = environment
	scene.environmentIntensity = 0.85
	scene.add(new HemisphereLight(0xffffff, 0xdcdfe6, 0.9))
	const sun = new DirectionalLight(0xffffff, 1.2)
	sun.position.set(3, 8, 5)
	scene.add(sun)

	const camera = new PerspectiveCamera(35, 16 / 9, 0.05, 400)
	const world = new Group()
	scene.add(world)

	const shared_shadow = shadow_texture()
	shared_shadow.userData.shared = true
	const hidden = new MeshBasicMaterial({ visible: false })
	hidden.userData.shared = true

	// ── Controls ─────────────────────────────────────────────────────────
	const controls = new OrbitControls(camera, canvas)
	controls.enableDamping = true
	controls.dampingFactor = 0.09
	controls.screenSpacePanning = false
	controls.zoomToCursor = true
	controls.minDistance = 0.25
	controls.maxDistance = 60
	controls.minPolarAngle = 0
	controls.maxPolarAngle = 86 * DEG
	controls.rotateSpeed = 0.6
	controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN }
	controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }

	// ── State ────────────────────────────────────────────────────────────
	const lives = new Map<string, Live>()
	let token_seq = 0
	/** Selected items get rings; the last one (primary) gets the "⋯" */
	let selected = new Set<string>()
	let primary: string | null = null
	let hovered: string | null = null
	let hover_at: { x: number; y: number } | null = null
	let fly: Fly | null = null
	let away = false
	let homed = false
	let press: Press | null = null
	let drag: Drag | null = null
	let last_click: { key: string; t: number } | null = null
	let long_press: ReturnType<typeof setTimeout> | undefined
	let view_w = 1
	let view_h = 1

	// ── Frames on demand ─────────────────────────────────────────────────
	let raf = 0
	let last = 0

	function invalidate() {
		if (!raf && active && !disposed) raf = requestAnimationFrame(tick)
	}

	function tick(now: number) {
		raf = 0
		const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60
		last = now
		let busy = false
		if (fly) busy = step_fly(now) || busy
		if (hover_at) pick_hover()
		busy = step_items(dt) || busy
		if (!fly) busy = controls.update() || busy
		renderer.render(scene, camera)
		emit_frame()
		if (busy) invalidate()
		else last = 0
	}

	controls.addEventListener('change', invalidate)
	controls.addEventListener('start', () => {
		away = true
	})

	// ── Items ────────────────────────────────────────────────────────────
	const look_of = (it: SceneItem) =>
		JSON.stringify([it.kind, it.w, it.h, it.title, it.text, it.footer, it.paper, it.tint, it.fill, it.icon, it.label, it.url, it.tone, it.failed])

	const overlaps = (a: SceneItem, b: SceneItem) =>
		Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 4 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 4

	/** Height of an item's bottom: its own, or cards just over the floor and over the cards they cover */
	function heights(items: SceneItem[]): Map<string, number> {
		const out = new Map<string, number>()
		items.forEach((it, i) => {
			if (it.z !== null) out.set(it.key, it.z)
			else if (it.kind === 'model') out.set(it.key, 0)
			else {
				let under = 0
				for (let j = 0; j < i; j++) if (items[j].kind !== 'model' && overlaps(items[j], it)) under++
				out.set(it.key, CARD_HEIGHT + STACK_STEP * under)
			}
		})
		return out
	}

	function set_items(items: SceneItem[]) {
		const keys = new Set(items.map(it => it.key))
		for (const [key, live] of lives) if (!keys.has(key)) remove(live)
		const base = heights(items)
		for (const it of items) {
			const height = (base.get(it.key) ?? 0) * U
			const live = lives.get(it.key)
			const look = look_of(it)
			if (!live) create({ ...it }, look, height)
			else if (live.look !== look) {
				remove(live)
				create({ ...it }, look, height)
			} else if (drag?.key !== it.key) {
				live.item = { ...it }
				live.base = height
				place(live)
			}
		}
		for (const key of selected) if (!lives.has(key)) selected.delete(key)
		if (primary && !lives.has(primary)) primary = null
		if (hovered && !lives.has(hovered)) hovered = null
		update_floor()
		if (!homed && view_w > 1) {
			homed = true
			home(true)
		}
		invalidate()
	}

	function place(live: Live) {
		const it = live.item
		live.root.position.set((it.x + it.w / 2) * U, 0, (it.y + it.h / 2) * U)
	}

	function create(item: SceneItem, look: string, base: number) {
		const w = item.w * U
		const h = item.h * U
		const root = new Group()
		const body = new Group()
		root.add(body)

		const shadow = new Mesh(
			new PlaneGeometry(1, 1),
			new MeshBasicMaterial({ map: shared_shadow, transparent: true, depthWrite: false }),
		)
		shadow.rotation.x = -Math.PI / 2
		shadow.position.y = 0.003
		shadow.renderOrder = 1
		root.add(shadow)

		const ring = new Mesh(
			ring_geometry(w, h, 0.08, 0.05, 0.035),
			new MeshBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0, depthWrite: false }),
		)
		ring.position.y = 0.002
		ring.visible = false
		body.add(ring)

		// the height guide: a line down to the floor and a dot where the item stands
		const line = new Mesh(new BoxGeometry(0.016, 1, 0.016), new MeshBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0.75 }))
		line.visible = false
		root.add(line)
		const dot = new Mesh(new CircleGeometry(0.05, 24), new MeshBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0.75, depthWrite: false }))
		dot.rotation.x = -Math.PI / 2
		dot.position.y = 0.004
		dot.visible = false
		root.add(dot)

		const live: Live = {
			item,
			look,
			root,
			body,
			hit: null,
			shadow,
			ring,
			line,
			dot,
			base,
			lift: 0,
			ring_k: 0,
			top: 0,
			spin: null,
			appear: 1,
			faces: [],
			token: ++token_seq,
		}
		place(live)
		world.add(root)
		lives.set(item.key, live)

		if (item.kind === 'note') build_note(live)
		else if (item.kind === 'image') build_image(live)
		else if (item.kind === 'folder') build_folder(live)
		else if (item.kind === 'model') build_model(live)
		else build_file(live)
	}

	function remove(live: Live) {
		live.token = ++token_seq
		world.remove(live.root)
		dispose_live(live.root)
		live.faces.forEach(f => f.dispose())
		lives.delete(live.item.key)
		if (drag?.key === live.item.key) drag = null
	}

	/** Frees what an item made for itself; shared textures and materials stay */
	function dispose_live(root: Object3D) {
		root.traverse(object => {
			const mesh = object as Mesh
			if (!mesh.isMesh) return
			mesh.geometry.dispose()
			const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
			for (const material of materials) {
				if (material.userData.shared) continue
				for (const value of Object.values(material)) {
					const texture = value as Texture | null
					if (texture?.isTexture && !texture.userData.shared) texture.dispose()
				}
				material.dispose()
			}
		})
	}

	/** A flat card: the face drawn by `painter` on top, `side` around */
	function card(live: Live, depth: number, radius_px: number, side: string, painter: Painter, transparent = false): Face {
		const { w, h } = live.item
		const face = new Face(w, h, anisotropy)
		face.paint(painter)
		live.faces.push(face)
		const mesh = new Mesh(slab(rounded_rect(w * U, h * U, radius_px * U), w * U, h * U, depth), [
			new MeshBasicMaterial({ map: face.texture, toneMapped: false, transparent }),
			new MeshStandardMaterial({ color: side, roughness: 0.85, transparent, opacity: transparent ? 0.6 : 1 }),
		])
		mesh.userData.key = live.item.key
		live.body.add(mesh)
		live.hit = mesh
		live.top = depth
		return face
	}

	/** Runs `paint` once the pictures arrive, unless the item was rebuilt meanwhile */
	function later<T>(live: Live, pictures: Promise<T>, paint: (value: T) => void) {
		const token = live.token
		void pictures.then(value => {
			if (disposed || live.token !== token) return
			paint(value)
			invalidate()
		})
	}

	function build_note(live: Live) {
		const it = live.item
		const paper = it.paper ?? '#FFF1B8'
		card(live, DEPTH.note, 6, darken(paper, 0.12), paint_note({ title: it.title ?? '', text: it.text ?? '', footer: it.footer ?? '', paper, font: options.font }))
	}

	function build_image(live: Live) {
		const it = live.item
		const tone = it.tone ?? '#E6F1FB'
		const face = card(live, DEPTH.card, 9, '#E6E4DF', paint_image({ picture: null, tone, icon: null }))
		later(live, Promise.all([it.url ? content_image(it.url) : Promise.resolve(null), icon_image('tabler:photo', COLORS.secondary)]), ([picture, icon]) =>
			face.paint(paint_image({ picture, tone, icon })),
		)
	}

	function build_file(live: Live) {
		const it = live.item
		const name = it.label ?? ''
		const face = card(live, DEPTH.card, 9, '#E6E4DF', paint_file({ icon: null, name, font: options.font }))
		later(live, icon_image(it.icon ?? 'tabler:file', it.tint ?? COLORS.secondary), icon =>
			face.paint(paint_file({ icon, name, font: options.font })),
		)
	}

	function build_folder(live: Live) {
		const it = live.item
		const tint = it.tint ?? null
		// a cover's color fills the folder, as on the board; else its view's color, lightened
		const fill = it.fill ?? null
		const base = fill ? darken(fill, 0.07) : tint ? lighten(tint, 0.5) : COLORS.folder
		const flap = fill ?? (tint ? lighten(tint, 0.78) : COLORS.folder_flap)
		const side = fill ? darken(fill, 0.16) : tint ? lighten(tint, 0.3) : COLORS.folder_side
		const face = new Face(it.w, it.h, anisotropy)
		const name = it.label ?? ''
		face.paint(paint_folder({ base, flap, icon: null, tab_h: TAB, name, font: options.font }))
		live.faces.push(face)
		const w = it.w * U
		const h = it.h * U
		const mesh = new Mesh(slab(folder_shape(w, h, 0.07, TAB), w, h, DEPTH.folder), [
			new MeshBasicMaterial({ map: face.texture, toneMapped: false }),
			new MeshStandardMaterial({ color: side, roughness: 0.85 }),
		])
		mesh.userData.key = it.key
		live.body.add(mesh)
		live.hit = mesh
		live.top = DEPTH.folder
		later(live, icon_image(it.icon ?? 'tabler:folder', tint ?? COLORS.secondary), icon =>
			face.paint(paint_folder({ base, flap, icon, tab_h: TAB, name, font: options.font })),
		)
	}

	function build_model(live: Live) {
		const it = live.item
		let icon: HTMLImageElement | null = null
		let failed = !!it.failed
		let share: number | null = null
		const status = card(live, DEPTH.status, 12, '#E6E4DF', paint_status({ icon, text: options.text.loading, share, failed, font: options.font }), true)
		const status_mesh = live.hit!
		const repaint = () =>
			status.paint(paint_status({ icon, text: failed ? options.text.failed : options.text.loading, share, failed, font: options.font }))
		later(live, icon_image(failed ? 'tabler:alert-triangle' : 'tabler:box', failed ? COLORS.danger : COLORS.muted), image => {
			icon = image
			repaint()
		})
		if (failed) repaint()
		if (failed || !it.url) return
		const token = live.token
		let painted = 0
		load_model(it.url, value => {
			if (disposed || live.token !== token) return
			share = value
			const now = performance.now()
			if (now - painted < 120) return
			painted = now
			repaint()
			invalidate()
		}).then(
			model => {
				if (disposed || live.token !== token) {
					dispose_tree(model)
					return
				}
				const w = it.w * U
				const d = it.h * U
				const { holder, size } = fit_model(model, w, d, Math.max(w, d) * 1.5)
				live.body.remove(status_mesh)
				dispose_live(status_mesh)
				const spin = new Group()
				spin.add(holder)
				live.body.add(spin)
				live.spin = spin
				const proxy = new Mesh(new BoxGeometry(size.x, size.y, size.z), hidden)
				proxy.position.y = size.y / 2
				proxy.userData.key = it.key
				live.body.add(proxy)
				live.hit = proxy
				live.top = size.y
				live.appear = motion ? 0 : 1
				spin.scale.setScalar(motion ? 0.001 : 1)
				invalidate()
			},
			() => {
				if (disposed || live.token !== token) return
				failed = true
				share = null
				later(live, icon_image('tabler:alert-triangle', COLORS.danger), image => {
					icon = image
					repaint()
				})
				repaint()
				invalidate()
			},
		)
	}

	// ── Floor ────────────────────────────────────────────────────────────
	type Bounds = { x0: number; y0: number; x1: number; y1: number }
	let floor: { key: string; group: Group; face: Face } | null = null

	function layout_bounds(): Bounds {
		let x0 = Infinity
		let y0 = Infinity
		let x1 = -Infinity
		let y1 = -Infinity
		for (const { item } of lives.values()) {
			x0 = Math.min(x0, item.x)
			y0 = Math.min(y0, item.y)
			x1 = Math.max(x1, item.x + item.w)
			y1 = Math.max(y1, item.y + item.h)
		}
		if (!Number.isFinite(x0)) {
			x0 = 0
			y0 = 0
			x1 = FLOOR_MIN.w
			y1 = FLOOR_MIN.h
		}
		x0 -= FLOOR_MARGIN
		y0 -= FLOOR_MARGIN
		x1 += FLOOR_MARGIN
		y1 += FLOOR_MARGIN
		if (x1 - x0 < FLOOR_MIN.w) {
			const c = (x0 + x1) / 2
			x0 = c - FLOOR_MIN.w / 2
			x1 = c + FLOOR_MIN.w / 2
		}
		if (y1 - y0 < FLOOR_MIN.h) {
			const c = (y0 + y1) / 2
			y0 = c - FLOOR_MIN.h / 2
			y1 = c + FLOOR_MIN.h / 2
		}
		const snap = (v: number, up: boolean) => (up ? Math.ceil(v / 20) : Math.floor(v / 20)) * 20
		return { x0: snap(x0, false), y0: snap(y0, false), x1: snap(x1, true), y1: snap(y1, true) }
	}

	function update_floor() {
		const b = layout_bounds()
		const key = `${b.x0},${b.y0},${b.x1},${b.y1}`
		if (floor?.key === key) return
		if (floor) {
			world.remove(floor.group)
			dispose_live(floor.group)
			floor.face.dispose()
		}
		const w = b.x1 - b.x0
		const h = b.y1 - b.y0
		const face = new Face(w, h, anisotropy, 1.5, 2048)
		face.paint(paint_floor({ x0: b.x0, y0: b.y0, step: GRID_STEP }))
		const group = new Group()
		group.position.set((b.x0 + w / 2) * U, 0, (b.y0 + h / 2) * U)
		const slab_mesh = new Mesh(slab(rounded_rect(w * U, h * U, 0.18), w * U, h * U, DEPTH.floor), [
			new MeshBasicMaterial({ map: face.texture, toneMapped: false }),
			new MeshStandardMaterial({ color: COLORS.floor_side, roughness: 0.9 }),
		])
		slab_mesh.position.y = -DEPTH.floor
		group.add(slab_mesh)
		// a soft shadow under the floor, seen around its edges
		const under = new Mesh(
			new PlaneGeometry(w * U * 1.18, h * U * 1.3),
			new MeshBasicMaterial({ map: shared_shadow, transparent: true, depthWrite: false, opacity: 0.5 }),
		)
		under.rotation.x = -Math.PI / 2
		under.position.y = -DEPTH.floor - 0.01
		group.add(under)
		world.add(group)
		floor = { key, group, face }
	}

	// ── Animation of items ───────────────────────────────────────────────
	function step_items(dt: number): boolean {
		let busy = false
		const k = motion ? Math.min(1, dt * 12) : 1
		for (const live of lives.values()) {
			const key = live.item.key
			const card = live.item.kind !== 'model'
			const dragging = !!drag?.started && drag.key === key
			const lift_to = card && !dragging && (key === hovered || selected.has(key)) && motion ? LIFT : 0
			live.lift += (lift_to - live.lift) * k
			if (Math.abs(lift_to - live.lift) > 0.0005) busy = true
			else live.lift = lift_to
			live.body.position.y = live.base + live.lift

			const ring_to = selected.has(key) ? 1 : key === hovered ? 0.4 : 0
			live.ring_k += (ring_to - live.ring_k) * k
			if (Math.abs(ring_to - live.ring_k) > 0.01) busy = true
			else live.ring_k = ring_to
			;(live.ring.material as MeshBasicMaterial).opacity = live.ring_k * 0.9
			live.ring.visible = live.ring_k > 0.01

			const height = live.base + live.lift
			const f = Math.min(1, height / 2.5)
			const grow = 1.12 * (1 + f * 0.3)
			live.shadow.scale.set(live.item.w * U * grow, live.item.h * U * grow, 1)
			;(live.shadow.material as MeshBasicMaterial).opacity = (card ? 0.55 : 0.65) * (1 - f * 0.6)

			const guide = dragging || (key === primary && live.base > 0.25)
			live.line.visible = live.dot.visible = guide && live.base > 0.01
			if (live.line.visible) {
				live.line.scale.y = live.base
				live.line.position.y = live.base / 2
			}

			if (live.spin && motion && key === primary && !dragging) {
				live.spin.rotation.y += dt * 0.6
				busy = true
			}
			if (live.spin && live.appear < 1) {
				live.appear = Math.min(1, live.appear + dt * 4)
				const e = 1 - (1 - live.appear) ** 3
				live.spin.scale.setScalar(Math.max(0.001, e))
				busy = true
			}
		}
		return busy
	}

	// ── Camera ───────────────────────────────────────────────────────────
	const spherical = new Spherical()
	const offset = new Vector3()

	function current_pose(): Pose {
		offset.copy(camera.position).sub(controls.target)
		spherical.setFromVector3(offset)
		return { target: controls.target.clone(), radius: spherical.radius, phi: spherical.phi, theta: spherical.theta }
	}

	function apply_pose(p: Pose) {
		controls.target.copy(p.target)
		camera.position.setFromSpherical(new Spherical(p.radius, p.phi, p.theta)).add(p.target)
		camera.lookAt(p.target)
	}

	/** The whole layout in view, seen at `phi` from the front */
	function fit_pose(phi: number): Pose {
		const b = layout_bounds()
		const w = (b.x1 - b.x0) * U
		const d = (b.y1 - b.y0) * U
		const target = new Vector3(((b.x0 + b.x1) / 2) * U, 0, ((b.y0 + b.y1) / 2) * U)
		const tan_v = Math.tan((camera.fov * DEG) / 2)
		const tan_h = tan_v * camera.aspect
		// the depth looks shorter when tilted; tall models add a little
		const seen = d * Math.cos(phi) + 1.2 * Math.sin(phi)
		const radius = Math.max(w / 2 / tan_h, seen / 2 / tan_v) * 1.06 + (d / 2) * Math.sin(phi) * 0.9
		return { target, radius, phi, theta: 0 }
	}

	function fly_to(to: Pose, ms = FLY_MS, instant = false): Promise<void> {
		fly = null
		if (instant || !motion) {
			apply_pose(to)
			controls.update()
			invalidate()
			return Promise.resolve()
		}
		return new Promise(done => {
			fly = { from: current_pose(), to, start: performance.now(), ms, done }
			controls.enabled = false
			invalidate()
		})
	}

	function step_fly(now: number): boolean {
		const f = fly!
		const k = Math.min(1, (now - f.start) / f.ms)
		const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2
		let dtheta = f.to.theta - f.from.theta
		dtheta = Math.atan2(Math.sin(dtheta), Math.cos(dtheta))
		apply_pose({
			target: f.from.target.clone().lerp(f.to.target, e),
			radius: f.from.radius + (f.to.radius - f.from.radius) * e,
			phi: f.from.phi + (f.to.phi - f.from.phi) * e,
			theta: f.from.theta + dtheta * e,
		})
		if (k >= 1) {
			fly = null
			controls.enabled = true
			controls.update()
			f.done()
		}
		return true
	}

	function home(instant = false) {
		const pose = fit_pose(HOME_PHI)
		controls.maxDistance = Math.max(8, pose.radius * 3)
		void fly_to(pose, FLY_MS, instant).then(() => {
			away = false
		})
	}

	function top() {
		away = true
		void fly_to(fit_pose(TOP_PHI))
	}

	function zoom(factor: number) {
		away = true
		const p = current_pose()
		p.radius = Math.min(controls.maxDistance, Math.max(controls.minDistance, p.radius * factor))
		void fly_to(p, ZOOM_MS)
	}

	function item_center(live: Live): Vector3 {
		return new Vector3(live.root.position.x, live.base + live.top / 2, live.root.position.z)
	}

	function focus(key: string) {
		const live = lives.get(key)
		if (!live) return
		away = true
		const size = Math.max(live.item.w, live.item.h) * U
		const model = live.item.kind === 'model'
		void fly_to({
			target: item_center(live),
			radius: size * (model ? 2.3 : 2) + 0.3,
			phi: (model ? 58 : 24) * DEG,
			theta: current_pose().theta,
		})
	}

	function fly_into(key: string): Promise<void> {
		const live = lives.get(key)
		if (!live || !motion) return Promise.resolve()
		const p = current_pose()
		return fly_to({ target: item_center(live), radius: 0.2, phi: Math.min(p.phi, 40 * DEG), theta: p.theta }, INTO_MS)
	}

	// ── Picking ──────────────────────────────────────────────────────────
	const raycaster = new Raycaster()
	const ndc = new Vector2()

	function aim(x: number, y: number) {
		const rect = canvas.getBoundingClientRect()
		ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1)
		raycaster.setFromCamera(ndc, camera)
	}

	function pick_at(x: number, y: number): string | null {
		world.updateMatrixWorld()
		aim(x, y)
		const hits: Object3D[] = []
		for (const live of lives.values()) if (live.hit) hits.push(live.hit)
		const hit = raycaster.intersectObjects(hits, false)[0]
		return (hit?.object.userData.key as string | undefined) ?? null
	}

	function pick_hover() {
		const at = hover_at!
		hover_at = null
		const key = pick_at(at.x, at.y)
		if (key === hovered) return
		hovered = key
		canvas.style.cursor = key ? 'pointer' : ''
	}

	function ray_point(x: number, y: number, plane: Plane): Vector3 | null {
		aim(x, y)
		return raycaster.ray.intersectPlane(plane, new Vector3())
	}

	// ── Pointer ──────────────────────────────────────────────────────────
	function on_pointer_down(e: PointerEvent) {
		if (fly) {
			e.stopPropagation()
			return
		}
		const key = pick_at(e.clientX, e.clientY)
		press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), button: e.button, ctrl: e.ctrlKey, key }
		const touch = e.pointerType === 'touch'
		// a finger held still opens the item's menu, as a right click does
		clearTimeout(long_press)
		if (e.pointerType !== 'mouse') {
			const id = e.pointerId
			long_press = setTimeout(() => {
				if (!press || press.id !== id || drag?.started) return
				press = null
				if (drag) end_drag(null, false)
				options.on_menu(key)
			}, LONG_PRESS_MS)
		}
		const can_drag = movable && !!key && e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && (!touch || selected.has(key))
		if (can_drag) {
			const live = lives.get(key!)!
			controls.enabled = false
			drag = {
				key: key!,
				live,
				started: false,
				mode: 'floor',
				plane: new Plane(),
				grab: new Vector3(),
				from: { x: live.item.x, y: live.item.y, z: live.item.z, base: live.base },
			}
			try {
				canvas.setPointerCapture(e.pointerId)
			} catch {
				// a pointer the browser does not track (a synthetic one): moves still arrive while over the scene
			}
		} else controls.enabled = true
	}

	/**
	 * Pins the drag to a plane: the floor at the item's height, or upright for
	 * height. The grab is measured where the pointer is at (x, y): the press
	 * point at the start, so the item does not jump by the first few pixels.
	 */
	function anchor(x: number, y: number) {
		const d = drag!
		const at = new Vector3(d.live.root.position.x, d.live.base, d.live.root.position.z)
		if (d.mode === 'floor') d.plane.set(new Vector3(0, 1, 0), -d.live.base)
		else {
			const normal = new Vector3().subVectors(camera.position, at)
			normal.y = 0
			if (normal.lengthSq() < 1e-8) normal.set(0, 0, 1)
			d.plane.setFromNormalAndCoplanarPoint(normal.normalize(), at)
		}
		const point = ray_point(x, y, d.plane)
		d.grab.copy(point ? point.sub(at) : new Vector3())
	}

	function on_pointer_move(e: PointerEvent) {
		if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) >= CLICK_MOVE) clearTimeout(long_press)
		if (drag && press && e.pointerId === press.id) {
			const d = drag
			if (!d.started) {
				if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < CLICK_MOVE) return
				d.started = true
				d.mode = e.altKey ? 'height' : 'floor'
				anchor(press.x, press.y)
				canvas.style.cursor = 'grabbing'
				// what you drag is what is selected, as on the board
				if (!selected.has(d.key) || selected.size > 1) options.on_select(d.key)
				if (!e.altKey && e.pointerType === 'mouse' && !height_hint_shown) {
					height_hint_shown = true
					options.on_hint()
				}
			}
			const mode = e.altKey ? 'height' : 'floor'
			if (mode !== d.mode) {
				d.mode = mode
				anchor(e.clientX, e.clientY)
			}
			const point = ray_point(e.clientX, e.clientY, d.plane)
			if (!point) return
			const it = d.live.item
			if (d.mode === 'floor') {
				const cx = point.x - d.grab.x
				const cz = point.z - d.grab.z
				it.x = Math.round(cx / U - it.w / 2)
				it.y = Math.round(cz / U - it.h / 2)
				place(d.live)
			} else {
				d.live.base = Math.min(MAX_HEIGHT * U, Math.max(0, point.y - d.grab.y))
				it.z = Math.round(d.live.base / U)
			}
			invalidate()
			return
		}
		if (e.pointerType === 'mouse' && !e.buttons) {
			hover_at = { x: e.clientX, y: e.clientY }
			invalidate()
		}
	}

	function end_drag(e: PointerEvent | null, commit: boolean): boolean {
		const d = drag
		drag = null
		if (e && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
		controls.enabled = true
		canvas.style.cursor = hovered ? 'pointer' : ''
		if (!d?.started) return false
		const it = d.live.item
		if (commit) {
			// a height is written once someone sets one; a move along the floor keeps the default
			const lifted = d.from.z !== null || Math.abs(d.live.base - d.from.base) > 1e-6
			options.on_move(d.key, { x: it.x, y: it.y, z: lifted ? Math.round(d.live.base / U) : null })
			update_floor()
		} else {
			it.x = d.from.x
			it.y = d.from.y
			it.z = d.from.z
			d.live.base = d.from.base
			place(d.live)
		}
		invalidate()
		return true
	}

	function on_pointer_up(e: PointerEvent) {
		clearTimeout(long_press)
		if (!press || e.pointerId !== press.id) return
		const p = press
		press = null
		if (drag && end_drag(e, true)) return
		controls.enabled = true
		if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_MOVE || performance.now() - p.t > CLICK_MS) return
		if (p.button === 2 || (p.button === 0 && p.ctrl && IS_MAC)) {
			options.on_menu(p.key)
			return
		}
		if (p.button !== 0) return
		const now = performance.now()
		if (p.key && last_click?.key === p.key && now - last_click.t < DOUBLE_MS) {
			last_click = null
			options.on_open(p.key)
			return
		}
		last_click = p.key ? { key: p.key, t: now } : null
		options.on_select(p.key)
	}

	function on_pointer_cancel(e: PointerEvent) {
		clearTimeout(long_press)
		if (!press || e.pointerId !== press.id) return
		press = null
		if (drag) end_drag(e, false)
	}

	function on_pointer_leave() {
		if (hovered) {
			hovered = null
			canvas.style.cursor = ''
			invalidate()
		}
	}

	/**
	 * The item's menu opens on a right click that did not move: a right drag
	 * pans. The system's menu (on a Mac it comes on press) never shows.
	 */
	function on_context_menu(e: MouseEvent) {
		e.preventDefault()
		e.stopPropagation()
	}

	// Capture on the container runs before OrbitControls' own listeners on the canvas
	container.addEventListener('pointerdown', on_pointer_down, { capture: true })
	container.addEventListener('pointermove', on_pointer_move)
	container.addEventListener('pointerup', on_pointer_up)
	container.addEventListener('pointercancel', on_pointer_cancel)
	container.addEventListener('pointerleave', on_pointer_leave)
	container.addEventListener('contextmenu', on_context_menu, { capture: true })

	// ── HTML over the scene ──────────────────────────────────────────────
	const frame: SceneFrame = { labels: new Map(), badge: null }
	const projected = new Vector3()

	function project(x: number, y: number, z: number): { x: number; y: number; ok: boolean } {
		projected.set(x, y, z).project(camera)
		return {
			x: ((projected.x + 1) / 2) * view_w,
			y: ((1 - projected.y) / 2) * view_h,
			ok: projected.z > -1 && projected.z < 1,
		}
	}

	/** Labels are HTML on top of everything: one whose place is hidden behind another item gets dimmed */
	const sight = new Raycaster()
	const eye_to = new Vector3()

	function covered(live: Live, x: number, y: number, z: number, hits: Object3D[]): boolean {
		eye_to.set(x, y, z).sub(camera.position)
		const distance = eye_to.length()
		sight.set(camera.position, eye_to.normalize())
		sight.far = distance - 0.03
		for (const hit of sight.intersectObjects(hits, false)) {
			if (hit.object !== live.hit) return true
		}
		return false
	}

	function emit_frame() {
		for (const key of frame.labels.keys()) if (!lives.has(key)) frame.labels.delete(key)
		// a ray per label against every item: fine for a usual folder, skipped for crowded ones
		const hits: Object3D[] = []
		if (lives.size <= 60) for (const live of lives.values()) if (live.hit) hits.push(live.hit)
		for (const live of lives.values()) {
			const it = live.item
			const cx = live.root.position.x
			const cz = live.root.position.z
			const hw = (it.w * U) / 2
			const hd = (it.h * U) / 2
			const y = it.kind === 'model' ? live.base : live.base + live.lift + live.top
			const left = project(cx - hw, y, cz + hd)
			const right = project(cx + hw, y, cz + hd)
			let spot = frame.labels.get(it.key) as LabelSpot | undefined
			if (!spot) {
				spot = { x: 0, y: 0, width: 0, visible: false, covered: false }
				frame.labels.set(it.key, spot)
			}
			spot.x = (left.x + right.x) / 2
			spot.y = Math.max(left.y, right.y)
			spot.width = Math.abs(right.x - left.x)
			spot.visible = left.ok && right.ok && spot.width > 34 && spot.x > -40 && spot.x < view_w + 40 && spot.y > -20 && spot.y < view_h + 20
			spot.covered = spot.visible && hits.length > 0 && covered(live, cx, y, cz + hd, hits)
		}
		frame.badge = null
		const live = primary ? lives.get(primary) : undefined
		if (live) {
			const it = live.item
			const model = it.kind === 'model'
			const corner = project(
				live.root.position.x + (it.w * U) / 2,
				live.base + live.lift + live.top,
				live.root.position.z - (model ? 0 : (it.h * U) / 2),
			)
			if (corner.ok) frame.badge = { x: corner.x, y: corner.y }
		}
		options.on_frame(frame)
	}

	// ── Size ─────────────────────────────────────────────────────────────
	function resize() {
		const w = container.clientWidth
		const h = container.clientHeight
		if (!w || !h) return
		view_w = w
		view_h = h
		renderer.setSize(w, h, false)
		camera.aspect = w / h
		camera.updateProjectionMatrix()
		if (!homed && lives.size) {
			homed = true
			home(true)
		} else if (homed && !away && !fly) home(true)
		invalidate()
	}
	const resize_observer = new ResizeObserver(resize)
	resize_observer.observe(container)
	resize()
	update_floor()

	return {
		set_items,
		set_selected(keys) {
			selected = new Set(keys)
			primary = keys.length ? keys[keys.length - 1] : null
			invalidate()
		},
		set_motion(on) {
			motion = on
			invalidate()
		},
		set_movable(on) {
			movable = on
		},
		home,
		top,
		zoom,
		focus,
		fly_into,
		set_active(on) {
			active = on
			if (on) invalidate()
			else if (raf) {
				cancelAnimationFrame(raf)
				raf = 0
			}
		},
		sync() {
			if (disposed) return
			if (raf) {
				cancelAnimationFrame(raf)
				raf = 0
			}
			tick(performance.now())
		},
		get away() {
			return away
		},
		dispose() {
			if (disposed) return
			disposed = true
			clearTimeout(long_press)
			if (raf) cancelAnimationFrame(raf)
			resize_observer.disconnect()
			container.removeEventListener('pointerdown', on_pointer_down, { capture: true })
			container.removeEventListener('pointermove', on_pointer_move)
			container.removeEventListener('pointerup', on_pointer_up)
			container.removeEventListener('pointercancel', on_pointer_cancel)
			container.removeEventListener('pointerleave', on_pointer_leave)
			container.removeEventListener('contextmenu', on_context_menu, { capture: true })
			controls.dispose()
			for (const live of [...lives.values()]) remove(live)
			if (floor) {
				dispose_live(floor.group)
				floor.face.dispose()
			}
			shared_shadow.dispose()
			hidden.dispose()
			environment.dispose()
			pmrem.dispose()
			room.dispose()
			renderer.dispose()
			renderer.forceContextLoss()
			canvas.remove()
		},
	}
}
