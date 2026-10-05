// The three.js scene behind the "A 3D view of a folder" card on /vision.
// Plain TS on purpose: this directory is not auto-imported by Nuxt, so three
// ships only in the lazy chunk that VisionSpace loads on the client.
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Shape,
  ShapeGeometry,
  Spherical,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export interface SpaceSceneOptions {
  reducedMotion: boolean;
  /** The camera left the home view (true) or came back to it (false). */
  onAwayChange?: (away: boolean) => void;
  /** A short usage hint to show over the scene; "" hides it. */
  onHint?: (hint: string) => void;
  /** The first frame is on screen. */
  onReady?: () => void;
}

export interface SpaceScene {
  start(): void;
  stop(): void;
  resetView(): void;
  dispose(): void;
}

const DEG = Math.PI / 180;
const ACCENT = "#2182f8";
const FONT = "Arial, Helvetica, sans-serif";
// Canvas pixels per world unit for card faces.
const PPU = 256;

// Matches the CSS poster: rotateX(52deg) rotateZ(-14deg).
const HOME_TARGET = new Vector3(0, 0.35, 0.15);
const HOME_PHI = 54 * DEG;
const HOME_THETA = 0;
const HOME_RADIUS = 11;

const BOB_PERIOD = 5.6;
const IDLE_MS = 4000;
const FLY_MS = 800;

interface Item {
  group: Group;
  baseY: number;
  bob: number;
  phase: number;
  lift: number;
  shadow?: Mesh;
  ring?: Mesh;
  /** Camera placement when focused on this item. */
  view: { phi: number; radius: number };
  spin?: number;
}

function roundedRect(w: number, h: number, r: number): Shape {
  const s = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** A thin rounded slab lying flat on XZ, top face at y = depth, with 0..1 UVs on the caps. */
function slabGeometry(w: number, h: number, r: number, depth: number): ExtrudeGeometry {
  const geo = new ExtrudeGeometry(roundedRect(w, h, r), {
    depth,
    bevelEnabled: false,
    curveSegments: 8,
  });
  const pos = geo.getAttribute("position");
  const uv = geo.getAttribute("uv");
  const caps = geo.groups[0];
  if (caps) {
    for (let i = caps.start; i < caps.start + caps.count; i++) {
      const v = geo.index ? geo.index.getX(i) : i;
      uv.setXY(v, (pos.getX(v) + w / 2) / w, (pos.getY(v) + h / 2) / h);
    }
  }
  uv.needsUpdate = true;
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, W: number, H: number) => void): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * PPU);
  canvas.height = Math.round(h * PPU);
  const ctx = canvas.getContext("2d")!;
  draw(ctx, canvas.width, canvas.height);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function fillRounded(ctx: CanvasRenderingContext2D, W: number, H: number, r: number, fill: string, stroke?: string) {
  const inset = stroke ? 3 : 0;
  ctx.beginPath();
  ctx.roundRect(inset, inset, W - inset * 2, H - inset * 2, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = 5;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function shadowTexture(): CanvasTexture {
  return canvasTexture(1, 1, (ctx, W, H) => {
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
    g.addColorStop(0, "rgba(15,23,42,0.34)");
    g.addColorStop(0.55, "rgba(15,23,42,0.14)");
    g.addColorStop(1, "rgba(15,23,42,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  });
}

export function createSpaceScene(container: HTMLElement, options: SpaceSceneOptions): SpaceScene {
  const { reducedMotion } = options;

  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.setAttribute("aria-hidden", "true");
  container.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(35, 16 / 9, 0.1, 100);

  scene.add(new HemisphereLight(0xffffff, new Color("hsl(214, 42%, 80%)"), 2.2));
  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.position.set(3, 8, 5);
  scene.add(sun);

  // Everything on the desk turns with the board, like the CSS rig.
  const rig = new Group();
  rig.rotation.y = 14 * DEG;
  scene.add(rig);

  const shadowTex = shadowTexture();

  // ── Board ────────────────────────────────────────────────────────────
  const BOARD_W = 8;
  const BOARD_H = 4.6;
  const BOARD_D = 0.1;
  const gridTex = canvasTexture(BOARD_W, BOARD_H, (ctx, W, H) => {
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(33,130,248,0.18)";
    ctx.lineWidth = 3;
    const cols = 8;
    const rows = 4.5;
    for (let i = 1; i < cols; i++) {
      const x = Math.round((W / cols) * i) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let i = 1; i < rows; i++) {
      const y = Math.round((H / rows) * i) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  });
  const board = new Mesh(slabGeometry(BOARD_W, BOARD_H, 0.45, BOARD_D), [
    new MeshBasicMaterial({ map: gridTex, transparent: true }),
    new MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, roughness: 0.9 }),
  ]);
  board.renderOrder = 0;
  rig.add(board);
  const deskY = BOARD_D;

  // ── Items ────────────────────────────────────────────────────────────
  const items: Item[] = [];
  const pickables: Object3D[] = [];

  function addShadow(item: Item, w: number, h: number) {
    const shadow = new Mesh(
      new PlaneGeometry(w, h),
      new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(item.group.position.x, deskY + 0.004, item.group.position.z);
    shadow.renderOrder = 1;
    rig.add(shadow);
    item.shadow = shadow;
  }

  function addRing(item: Item, w: number, h: number, r: number) {
    const pad = 0.07;
    const outer = roundedRect(w + pad * 2, h + pad * 2, r + pad);
    outer.holes.push(roundedRect(w + 0.01, h + 0.01, r));
    const geo = new ShapeGeometry(outer, 8);
    geo.rotateX(-Math.PI / 2);
    const ring = new Mesh(geo, new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0 }));
    ring.position.y = 0.012;
    item.group.add(ring);
    item.ring = ring;
  }

  function addCard(opts: {
    x: number;
    z: number;
    w: number;
    h: number;
    y: number;
    turn: number;
    phase: number;
    side: string;
    draw: (ctx: CanvasRenderingContext2D, W: number, H: number) => void;
  }) {
    const group = new Group();
    group.position.set(opts.x, opts.y, opts.z);
    group.rotation.y = opts.turn;
    const body = new Mesh(slabGeometry(opts.w, opts.h, 0.16, 0.05), [
      new MeshBasicMaterial({ map: canvasTexture(opts.w, opts.h, opts.draw) }),
      new MeshStandardMaterial({ color: opts.side, roughness: 0.8 }),
    ]);
    group.add(body);
    rig.add(group);
    const item: Item = {
      group,
      baseY: opts.y,
      bob: 0.32,
      phase: opts.phase,
      lift: 0,
      view: { phi: 34 * DEG, radius: Math.max(opts.w, opts.h) * 2.6 },
    };
    body.userData.item = item;
    pickables.push(body);
    addShadow(item, opts.w * 1.1, opts.h * 1.1);
    addRing(item, opts.w, opts.h, 0.16);
    items.push(item);
  }

  // Note "Mood" — left, near the back (CSS: left 6%, top 8%, width 30%).
  addCard({
    x: -2.3,
    z: -1.05,
    w: 2.4,
    h: 1.3,
    y: 0.55,
    turn: 2.5 * DEG,
    phase: 0,
    side: "#fcd34d",
    draw(ctx, W, H) {
      fillRounded(ctx, W, H, 40, "#fff7d6", "rgba(252,211,77,0.95)");
      const pad = H * 0.16;
      ctx.fillStyle = "rgba(120,53,15,0.85)";
      ctx.font = `700 ${Math.round(H * 0.17)}px ${FONT}`;
      ctx.textBaseline = "top";
      ctx.fillText("Mood", pad, pad);
      ctx.fillStyle = "rgba(120,53,15,0.72)";
      ctx.font = `400 ${Math.round(H * 0.15)}px ${FONT}`;
      ctx.fillText("warm light", pad, pad + H * 0.27);
      ctx.fillText("quiet room", pad, pad + H * 0.47);
    },
  });

  // Image card "Harbor" — center (CSS: left 38%, top 30%, width 28%).
  addCard({
    x: 0.25,
    z: 0.15,
    w: 2.2,
    h: 2.0,
    y: 0.9,
    turn: -1.5 * DEG,
    phase: (-1.8 / BOB_PERIOD) * Math.PI * 2,
    side: "#e2e8f0",
    draw(ctx, W, H) {
      fillRounded(ctx, W, H, 40, "#ffffff", "hsl(215,35%,88%)");
      const pad = W * 0.07;
      const tw = W - pad * 2;
      const th = H * 0.64;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(pad, pad, tw, th, 26);
      ctx.clip();
      const g = ctx.createLinearGradient(pad, pad, pad + tw * 0.4, pad + th);
      g.addColorStop(0, "#bae6fd");
      g.addColorStop(0.42, "#7dd3fc");
      g.addColorStop(1, ACCENT);
      ctx.fillStyle = g;
      ctx.fillRect(pad, pad, tw, th);
      ctx.fillStyle = "#fde68a";
      ctx.beginPath();
      ctx.arc(pad + tw * 0.78, pad + th * 0.28, th * 0.13, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#334155";
      ctx.font = `700 ${Math.round(H * 0.1)}px ${FONT}`;
      ctx.textBaseline = "top";
      ctx.fillText("Harbor", pad, pad + th + H * 0.07);
    },
  });

  // The cube — a stand-in for a .glb shown in the folder.
  {
    const size = 0.9;
    const group = new Group();
    group.position.set(2.75, 1.35, -1.15);
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z (same shades as HomeCube).
    const mats = ["#0ea5e9", "#0ea5e9", "#bae6fd", "#0369a1", "#7dd3fc", "#7dd3fc"].map(
      (color) => new MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 }),
    );
    const cube = new Mesh(new BoxGeometry(size, size, size), mats);
    cube.rotation.y = 35 * DEG;
    group.add(cube);
    rig.add(group);
    const item: Item = {
      group,
      baseY: 1.35,
      bob: 0.22,
      phase: 0,
      lift: 0,
      view: { phi: 62 * DEG, radius: 4.2 },
      spin: 0,
    };
    cube.userData.item = item;
    pickables.push(cube);
    addShadow(item, 1.3, 1.3);
    items.push(item);
  }

  // ── Camera & controls ────────────────────────────────────────────────
  const homePosition = new Vector3().setFromSpherical(new Spherical(HOME_RADIUS, HOME_PHI, HOME_THETA)).add(HOME_TARGET);
  camera.position.copy(homePosition);
  camera.lookAt(HOME_TARGET);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(HOME_TARGET);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.minDistance = 2.4;
  controls.maxDistance = 16;
  controls.minPolarAngle = 10 * DEG;
  controls.maxPolarAngle = 80 * DEG;
  // Keep the board readable: no looking at it from behind.
  controls.minAzimuthAngle = -70 * DEG;
  controls.maxAzimuthAngle = 70 * DEG;
  controls.rotateSpeed = 0.5;
  controls.update();
  // Until a touch user taps the scene, a vertical swipe scrolls the page.
  canvas.style.touchAction = "pan-y";

  // ── State ────────────────────────────────────────────────────────────
  let running = false;
  let disposed = false;
  let lastInteraction = -Infinity;
  let idleStart = performance.now();
  let focused: Item | null = null;
  let hovered: Item | null = null;
  let away = false;
  let touchActive = false;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;

  interface Fly {
    from: Vector3;
    fromTarget: Vector3;
    to: Vector3;
    toTarget: Vector3;
    start: number;
  }
  let fly: Fly | null = null;

  function setAway(value: boolean) {
    if (away === value) return;
    away = value;
    options.onAwayChange?.(value);
  }

  function hint(text: string, ms = 1600) {
    clearTimeout(hintTimer);
    options.onHint?.(text);
    if (text) hintTimer = setTimeout(() => options.onHint?.(""), ms);
  }

  function flyTo(position: Vector3, target: Vector3) {
    if (reducedMotion) {
      camera.position.copy(position);
      controls.target.copy(target);
      controls.update();
      return;
    }
    fly = {
      from: camera.position.clone(),
      fromTarget: controls.target.clone(),
      to: position,
      toTarget: target,
      start: performance.now(),
    };
    controls.enabled = false;
  }

  function focus(item: Item) {
    focused = item;
    setAway(true);
    const target = new Vector3();
    item.group.getWorldPosition(target);
    target.y = rig.localToWorld(new Vector3(0, item.baseY, 0)).y;
    const theta = rig.rotation.y + item.group.rotation.y;
    const position = new Vector3()
      .setFromSpherical(new Spherical(item.view.radius, item.view.phi, theta))
      .add(target);
    flyTo(position, target);
    if (item.spin !== undefined) item.spin = 1;
  }

  function resetView() {
    focused = null;
    lastInteraction = -Infinity;
    idleStart = performance.now();
    flyTo(homePosition.clone(), HOME_TARGET.clone());
    setAway(false);
  }

  controls.addEventListener("start", () => {
    lastInteraction = performance.now();
    setAway(true);
  });
  controls.addEventListener("end", () => {
    lastInteraction = performance.now();
  });

  // ── Input ────────────────────────────────────────────────────────────
  const raycaster = new Raycaster();
  const ndc = new Vector2();

  function pick(event: PointerEvent): Item | null {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0];
    return (hit?.object.userData.item as Item | undefined) ?? null;
  }

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const down = { x: 0, y: 0, t: 0, touch: false };

  function onWheel(event: WheelEvent) {
    // Zoom only with a modifier (a trackpad pinch arrives as ctrl+wheel),
    // so a plain wheel keeps scrolling the page.
    const zoom = event.ctrlKey || event.metaKey;
    controls.enableZoom = zoom;
    if (zoom) {
      lastInteraction = performance.now();
      setAway(true);
    } else {
      hint(isMac ? "Hold ⌘ and scroll to zoom" : "Hold Ctrl and scroll to zoom");
    }
  }

  function onPointerDown(event: PointerEvent) {
    down.x = event.clientX;
    down.y = event.clientY;
    down.t = performance.now();
    down.touch = event.pointerType === "touch";
    if (fly) return;
    controls.enabled = !down.touch || touchActive;
    if (down.touch && !touchActive) hint("Tap to explore in 3D");
  }

  function onPointerUp(event: PointerEvent) {
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    if (moved > 6 || performance.now() - down.t > 450) return;
    if (down.touch && !touchActive) {
      touchActive = true;
      canvas.style.touchAction = "none";
      controls.enabled = !fly;
      hint("Drag to orbit · pinch to zoom", 2200);
    }
    const item = pick(event);
    if (item) focus(item);
    else if (focused) resetView();
  }

  function onPointerMove(event: PointerEvent) {
    if (event.pointerType === "touch" || event.buttons) return;
    const item = pick(event);
    if (item !== hovered) {
      hovered = item;
      canvas.style.cursor = item ? "pointer" : "";
    }
  }

  function onPointerLeave() {
    hovered = null;
    canvas.style.cursor = "";
  }

  function onDocumentPointerDown(event: PointerEvent) {
    if (!touchActive || container.contains(event.target as Node)) return;
    touchActive = false;
    canvas.style.touchAction = "pan-y";
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && away) resetView();
  }

  // Capture phase on the container runs before OrbitControls' own
  // listeners on the canvas, so these flags are set before it reads them.
  container.addEventListener("wheel", onWheel, { capture: true, passive: true });
  container.addEventListener("pointerdown", onPointerDown, { capture: true });
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerleave", onPointerLeave);
  document.addEventListener("pointerdown", onDocumentPointerDown);
  window.addEventListener("keydown", onKeyDown);

  // ── Size ─────────────────────────────────────────────────────────────
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  // ── Loop ─────────────────────────────────────────────────────────────
  const sph = new Spherical();
  const offset = new Vector3();
  let prev = performance.now();
  let readySent = false;

  const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

  function frame(now: number) {
    const dt = Math.min((now - prev) / 1000, 0.1);
    prev = now;
    const t = now / 1000;

    for (const item of items) {
      const liftTarget = item === hovered || item === focused ? 0.22 : 0;
      item.lift += (liftTarget - item.lift) * Math.min(1, dt * 10);
      const rise = reducedMotion ? 0 : 0.5 - 0.5 * Math.cos((t / BOB_PERIOD) * Math.PI * 2 + item.phase);
      item.group.position.y = item.baseY + item.bob * rise + item.lift;
      if (item.shadow) {
        const k = rise + item.lift * 2;
        item.shadow.scale.setScalar(1 - 0.18 * k);
        (item.shadow.material as MeshBasicMaterial).opacity = 0.95 - 0.5 * Math.min(1, k);
      }
      if (item.ring) {
        const mat = item.ring.material as MeshBasicMaterial;
        mat.opacity += ((item === hovered && item !== focused ? 0.9 : 0) - mat.opacity) * Math.min(1, dt * 12);
      }
      if (item.spin !== undefined) {
        const cube = item.group.children[0]!;
        // A click spins the cube fast; it settles back to the slow orbit.
        item.spin += (0 - item.spin) * Math.min(1, dt * 1.2);
        const base = reducedMotion ? 0 : (Math.PI * 2) / 9;
        cube.rotation.y += dt * (base + item.spin * 9);
      }
    }

    if (fly) {
      const k = Math.min(1, (now - fly.start) / FLY_MS);
      const e = easeInOutCubic(k);
      camera.position.lerpVectors(fly.from, fly.to, e);
      controls.target.lerpVectors(fly.fromTarget, fly.toTarget, e);
      if (k >= 1) {
        fly = null;
        controls.enabled = true;
        lastInteraction = now;
      }
    } else if (!reducedMotion && !focused && now - lastInteraction > IDLE_MS) {
      // Idle: drift back toward the home orbit and sway gently around it.
      const idle = (now - Math.max(idleStart, lastInteraction + IDLE_MS)) / 1000;
      const ease = Math.min(1, dt * 1.5);
      controls.target.lerp(HOME_TARGET, ease);
      offset.copy(camera.position).sub(controls.target);
      sph.setFromVector3(offset);
      sph.theta += (HOME_THETA + 15 * DEG * Math.sin(idle * 0.35) - sph.theta) * ease;
      sph.phi += (HOME_PHI - sph.phi) * ease;
      sph.radius += (HOME_RADIUS - sph.radius) * ease;
      camera.position.setFromSpherical(sph).add(controls.target);
      if (away && Math.abs(sph.radius - HOME_RADIUS) < 0.05 && Math.abs(sph.phi - HOME_PHI) < 0.01) setAway(false);
    }

    controls.update();
    renderer.render(scene, camera);

    if (!readySent) {
      readySent = true;
      options.onReady?.();
    }
  }

  // ── Public API ───────────────────────────────────────────────────────
  return {
    start() {
      if (running || disposed) return;
      running = true;
      prev = performance.now();
      renderer.setAnimationLoop(frame);
    },
    stop() {
      if (!running) return;
      running = false;
      renderer.setAnimationLoop(null);
    },
    resetView,
    dispose() {
      if (disposed) return;
      disposed = true;
      this.stop();
      clearTimeout(hintTimer);
      resizeObserver.disconnect();
      container.removeEventListener("wheel", onWheel, { capture: true });
      container.removeEventListener("pointerdown", onPointerDown, { capture: true });
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("pointerdown", onDocumentPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      controls.dispose();
      const textures = new Set<Texture>();
      scene.traverse((obj) => {
        const mesh = obj as Mesh;
        if (!mesh.isMesh) return;
        (mesh.geometry as BufferGeometry).dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats as Material[]) {
          const map = (mat as MeshBasicMaterial).map;
          if (map) textures.add(map);
          mat.dispose();
        }
      });
      for (const tex of textures) tex.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
