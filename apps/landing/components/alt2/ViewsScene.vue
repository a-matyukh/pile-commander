<!-- ① One folder in the app's nine views. A copy of components/home/
     ViewSwitcher.vue for this page, which the home page keeps as it is:
     here Dashboard is added, Masonry is drawn as the app draws it (columns,
     each card going to the shortest one), the captions follow the app, and
     the window is drawn in the app's palette.
     Six things never change; only the way of looking does. The tabs are in
     the app's view-menu order (Widget.ts FOLDER_VIEWS), in three groups.
     Play runs the tour even with reduced motion: it is the visitor's own ask. -->
<script setup lang="ts">
type ViewId = "list" | "grid" | "board" | "canvas" | "3d" | "stack" | "masonry" | "dashboard" | "slides";
type Kind = "note" | "image" | "folder" | "markdown" | "video" | "model";
/** x, y, w, h in % of the stage; r is rotation in degrees */
type Box = { x: number; y: number; w: number; h: number; r?: number; hidden?: boolean };

const items: { id: string; name: string; kind: Kind; meta: string }[] = [
  { id: "welcome", name: "Welcome.txt", kind: "note", meta: "Text · 1 KB" },
  { id: "harbor", name: "Harbor morning.jpg", kind: "image", meta: "Image · 480 KB" },
  { id: "refs", name: "References", kind: "folder", meta: "Folder · 12 items" },
  { id: "mood", name: "Mood.md", kind: "markdown", meta: "Markdown · 2 KB" },
  { id: "clip", name: "clip.mp4", kind: "video", meta: "Video · 18 MB" },
  { id: "chair", name: "chair.glb", kind: "model", meta: "3D model · 3 MB" },
];

// The app's names, icons and colours (FOLDER_VIEW_META in apps/client);
// List is the standard view and stays monochrome there too
const views: { id: ViewId; label: string; icon: string; color: string | null; caption: string; group: number }[] = [
  { id: "list", label: "List", icon: "i-tabler-list", color: null, group: 0, caption: "Rows, like any file manager. For when you just need to find the thing." },
  { id: "grid", label: "Gallery", icon: "i-tabler-layout-grid", color: "#D4537E", group: 0, caption: "Tiles, like any file manager, in the size you like. Folders keep their tab." },
  { id: "board", label: "Board", icon: "i-tabler-template", color: "#534AB7", group: 1, caption: "Place anything anywhere. Resize, leave space, snap to a grid if you like." },
  { id: "canvas", label: "Canvas", icon: "i-tabler-artboard", color: "#1D9E75", group: 1, caption: "An infinite canvas. Connect things, draw over them, zoom from 20% to 400%." },
  { id: "3d", label: "3D", icon: "i-tabler-3d-cube-sphere", color: "#0F96A8", group: 1, caption: "The board in space: the same places, plus height. Models stand on it as real objects." },
  { id: "stack", label: "Stack", icon: "i-tabler-layout-rows", color: "#BA7517", group: 2, caption: "One column you reorder by dragging. Notes and media open inline." },
  { id: "masonry", label: "Masonry", icon: "i-tabler-layout-cards", color: "#D85A30", group: 2, caption: "Columns of cards: each next one goes to the shortest column. Pick the width or the number of columns." },
  { id: "dashboard", label: "Dashboard", icon: "i-tabler-layout-dashboard", color: "#3B6FB6", group: 2, caption: "A grid of twelve columns. Cards snap to it and resize; Compact pulls them up." },
  { id: "slides", label: "Slides", icon: "i-tabler-presentation", color: "#639922", group: 2, caption: "One piece at a time. The folder remembers which slide is open." },
];

const SLIDE: Box = { x: 14, y: 7, w: 72, h: 78 };

const board: Box[] = [
  { x: 5, y: 8, w: 25, h: 32, r: -2 },
  { x: 61, y: 6, w: 32, h: 42 },
  { x: 35, y: 44, w: 19, h: 32 },
  { x: 7, y: 54, w: 25, h: 38, r: 1.5 },
  { x: 60, y: 56, w: 27, h: 36 },
  { x: 36, y: 7, w: 20, h: 30, r: 2 },
];

/** How high each card floats in 3D, em; the model stands on the table */
const LIFT = [1.6, 2.4, 1.2, 2, 1.4, 0];

/** Dashboard: twelve columns over 90% of the stage, rows of 12.6% */
function cell(col: number, span: number, row: number, rows: number): Box {
  const colW = 6.4;
  const gapX = 1.2;
  const rowH = 12.6;
  const gapY = 2.5;
  return {
    x: 5 + col * (colW + gapX),
    y: 6 + row * (rowH + gapY),
    w: span * colW + (span - 1) * gapX,
    h: rows * rowH + (rows - 1) * gapY,
  };
}

const layouts: Record<Exclude<ViewId, "slides">, Box[]> = {
  list: items.map((_, i) => ({ x: 4, y: 12 + i * 13.5, w: 92, h: 10.5 })),
  grid: items.map((_, i) => ({ x: 7.5 + (i % 3) * 30.5, y: 7 + Math.floor(i / 3) * 46, w: 24.5, h: 40 })),
  board,
  // 3D is the board in space: the very same places
  "3d": board,
  canvas: [
    { x: 4, y: 38, w: 17, h: 24 },
    { x: 30, y: 8, w: 18, h: 26 },
    { x: 30, y: 66, w: 16, h: 24 },
    { x: 56, y: 38, w: 17, h: 24 },
    { x: 81, y: 10, w: 15, h: 24 },
    { x: 81, y: 66, w: 15, h: 24 },
  ],
  stack: [
    { x: 24, y: 5, w: 52, h: 22 },
    { x: 24, y: 30, w: 52, h: 36 },
    { x: 24, y: 69, w: 52, h: 14 },
    { x: 24, y: 86, w: 52, h: 26 },
    { x: 24, y: 115, w: 52, h: 30 },
    { x: 24, y: 148, w: 52, h: 26 },
  ],
  // Three columns; each card in turn goes to the shortest one
  masonry: [
    { x: 5, y: 6, w: 29, h: 26 },
    { x: 36, y: 6, w: 29, h: 40 },
    { x: 67, y: 6, w: 29, h: 30 },
    { x: 5, y: 35, w: 29, h: 36 },
    { x: 67, y: 39, w: 29, h: 24 },
    { x: 36, y: 49, w: 29, h: 30 },
  ],
  dashboard: [
    cell(6, 3, 0, 2),
    cell(0, 6, 0, 2),
    cell(0, 4, 2, 2),
    cell(9, 3, 0, 2),
    cell(4, 8, 2, 3),
    cell(0, 4, 4, 2),
  ],
};

// Canvas connectors, in a 160×100 space (the stage is 16:10).
const connectors = [
  "M 33.6 50 C 42 50, 42 21, 48 21",
  "M 33.6 50 C 42 50, 42 78, 48 78",
  "M 76.8 21 C 84 21, 84 50, 89.6 50",
  "M 73.6 78 C 82 78, 82 50, 89.6 50",
  "M 116.8 50 C 122 50, 124 22, 129.6 22",
  "M 116.8 50 C 122 50, 124 78, 129.6 78",
];

const active = ref<ViewId>("board");
const slide = ref(1);
/** The visitor chose a view: the tour stops for good */
const touched = ref(false);
/** Play was pressed: the tour runs, with motion, until Pause or a tab */
const playing = ref(false);

const activeView = computed(() => views.find((v) => v.id === active.value)!);
const mode = computed(() =>
  active.value === "list" ? "row" : active.value === "grid" ? "tile" : "card",
);

function boxFor(i: number): Box {
  if (active.value === "slides") {
    return i === slide.value
      ? SLIDE
      : { x: SLIDE.x + 8, y: SLIDE.y + 8, w: SLIDE.w - 16, h: SLIDE.h - 16, hidden: true };
  }
  return layouts[active.value][i]!;
}

function styleFor(i: number) {
  const b = boxFor(i);
  const lift = active.value === "3d" ? LIFT[i]! : 0;
  return {
    left: `${b.x}%`,
    top: `${b.y}%`,
    width: `${b.w}%`,
    height: `${b.h}%`,
    transform: `translateZ(${lift}em) rotate(${b.r ?? 0}deg)`,
    opacity: b.hidden ? 0 : 1,
    transitionDelay: `${i * 35}ms`,
  };
}

/** In 3D a card's shadow stays on the table, under it */
function shadowFor(i: number) {
  return { transform: `translateZ(${-(active.value === "3d" ? LIFT[i]! : 0)}em)` };
}

function pick(id: ViewId) {
  touched.value = true;
  playing.value = false;
  active.value = id;
}

function step(delta: number) {
  touched.value = true;
  playing.value = false;
  slide.value = (slide.value + delta + items.length) % items.length;
}

function advance() {
  const order = views.map((v) => v.id);
  active.value = order[(order.indexOf(active.value) + 1) % order.length]!;
}

function togglePlay() {
  playing.value = !playing.value;
  if (playing.value) advance();
}

/** Arrow keys move between tabs, as a tab list should */
const tabs = useTemplateRef<HTMLButtonElement[]>("tabs");

function onKey(event: KeyboardEvent) {
  const index = views.findIndex((v) => v.id === active.value);
  const last = views.length - 1;
  const to
    = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
        : event.key === "Home" ? 0
          : event.key === "End" ? last
            : -1;
  if (to < 0) return;
  event.preventDefault();
  pick(views[to]!.id);
  nextTick(() => tabs.value?.[to]?.focus());
}

const kindIcon: Record<Kind, string> = {
  note: "i-lucide-file-text",
  markdown: "i-lucide-file-type",
  image: "i-lucide-image",
  folder: "i-lucide-folder",
  video: "i-lucide-film",
  model: "i-lucide-box",
};

const kindTint: Record<Kind, string> = {
  note: "text-amber-600 bg-amber-50",
  markdown: "text-slate-600 bg-slate-100",
  image: "text-emerald-600 bg-emerald-50",
  folder: "text-sky-700 bg-sky-50",
  video: "text-orange-600 bg-orange-50",
  model: "text-sky-600 bg-sky-50",
};

const root = useTemplateRef<HTMLElement>("root");

onMounted(() => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let visible = false;
  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = !!entry?.isIntersecting;
    },
    { threshold: 0.4 },
  );
  if (root.value) observer.observe(root.value);
  const timer = window.setInterval(() => {
    if (!visible) return;
    // On its own only when motion is welcome; Play always
    if (playing.value || (!reduced && !touched.value)) advance();
  }, 3200);
  onUnmounted(() => {
    observer.disconnect();
    window.clearInterval(timer);
  });
});
</script>

<template>
  <div ref="root">
    <div class="tabs-scroll">
      <div role="tablist" aria-label="Folder views" class="tabs" @keydown="onKey">
        <template v-for="(view, i) in views" :key="view.id">
          <span v-if="i > 0 && view.group !== views[i - 1]!.group" class="divider" aria-hidden="true" />
          <button
            :id="`a2-view-tab-${view.id}`"
            ref="tabs"
            type="button"
            role="tab"
            :aria-selected="active === view.id"
            :tabindex="active === view.id ? 0 : -1"
            aria-controls="a2-view-stage"
            class="tab"
            :class="{ 'is-on': active === view.id }"
            @click="pick(view.id)"
          >
            <UIcon :name="view.icon" class="size-4" />
            {{ view.label }}
          </button>
        </template>
      </div>
    </div>

    <div class="caption-row">
      <p class="caption" aria-live="polite">
        <span class="caption-name">{{ activeView.label }}.</span>
        {{ activeView.caption }}
      </p>

      <div class="controls">
        <!-- The slide arrows live outside the hidden stage so they stay usable -->
        <div v-if="active === 'slides'" class="slide-nav">
          <button type="button" class="ctl" aria-label="Previous slide" @click="step(-1)">
            <UIcon name="i-lucide-chevron-left" class="size-4" />
          </button>
          <span class="count">{{ slide + 1 }} / {{ items.length }}</span>
          <button type="button" class="ctl" aria-label="Next slide" @click="step(1)">
            <UIcon name="i-lucide-chevron-right" class="size-4" />
          </button>
        </div>
        <button type="button" class="play" :aria-pressed="playing" @click="togglePlay">
          <UIcon :name="playing ? 'i-lucide-pause' : 'i-lucide-play'" class="size-4" />
          {{ playing ? "Pause" : "Play" }}
        </button>
      </div>
    </div>

    <div
      id="a2-view-stage"
      role="tabpanel"
      :aria-labelledby="`a2-view-tab-${active}`"
      class="a2-frame frame"
    >
      <!-- The folder's header, as in the app: its name and its view button -->
      <div class="hdr" aria-hidden="true">
        <div class="where">
          <span class="crumbs">
            <UIcon name="i-tabler-home" class="size-[1.15em]" />
            <UIcon name="i-tabler-chevron-right" class="size-[0.9em]" />
            Projects
          </span>
          <span class="title">Research</span>
        </div>
        <span class="viewbtn">
          <UIcon :name="activeView.icon" class="size-[1.35em]" :style="{ color: activeView.color ?? 'currentColor' }" />
        </span>
      </div>

      <div
        class="stage relative aspect-[16/10] overflow-hidden"
        :class="{ playing, dots: active === 'canvas', floor: active === '3d' }"
        aria-hidden="true"
      >
        <div class="zoomer absolute inset-0" :class="{ tilt: active === '3d' }">
          <!-- 3D: the board lies as a table -->
          <div
            class="tbl absolute inset-[3%] rounded-[1.2em] transition-opacity duration-500"
            :class="active === '3d' ? 'opacity-100' : 'opacity-0'"
          />

          <!-- Dashboard: its twelve columns, faintly -->
          <div
            class="cols absolute inset-y-0 right-[5%] left-[5%] transition-opacity duration-500"
            :class="active === 'dashboard' ? 'opacity-100' : 'opacity-0'"
          />

          <!-- List header -->
          <div
            class="list-head absolute top-[3.5%] right-[4%] left-[4%] flex pb-[0.6em] text-[0.85em] font-medium transition-opacity duration-300"
            :class="active === 'list' ? 'opacity-100' : 'opacity-0'"
          >
            <span class="pl-[3.2em]">Name</span>
            <span class="ml-auto">Kind</span>
          </div>

          <!-- Canvas connectors -->
          <svg
            class="pointer-events-none absolute inset-0 size-full text-sky-500 transition-opacity duration-500"
            :class="active === 'canvas' ? 'opacity-100' : 'opacity-0'"
            viewBox="0 0 160 100"
            fill="none"
          >
            <defs>
              <marker id="a2-view-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M0 0 L6 3 L0 6 z" fill="currentColor" />
              </marker>
            </defs>
            <path
              v-for="(d, i) in connectors"
              :key="i"
              :d="d"
              stroke="currentColor"
              stroke-width="0.45"
              stroke-dasharray="1.6 1.2"
              marker-end="url(#a2-view-arrow)"
              class="flow"
            />
          </svg>

          <div
            v-for="(item, i) in items"
            :key="item.id"
            class="item absolute transition-all duration-700 ease-[cubic-bezier(.2,.8,.2,1)]"
            :style="styleFor(i)"
          >
            <!-- 3D: its shadow on the table -->
            <span
              class="lift-shadow absolute inset-[6%] rounded-[1em] transition-all duration-700"
              :class="active === '3d' ? 'opacity-100' : 'opacity-0'"
              :style="shadowFor(i)"
            />

            <!-- Row -->
            <div
              class="row absolute inset-0 flex items-center gap-[0.8em] rounded-[0.6em] px-[0.8em] transition-opacity duration-300"
              :class="[mode === 'row' ? 'opacity-100' : 'opacity-0', { picked: i === 1 }]"
            >
              <span class="flex size-[2em] shrink-0 items-center justify-center rounded-[0.5em]" :class="kindTint[item.kind]">
                <UIcon :name="kindIcon[item.kind]" class="size-[1.1em]" />
              </span>
              <span class="truncate font-medium text-[#1f1f1e]">{{ item.name }}</span>
              <span class="ml-auto shrink-0 text-[0.85em] text-[#9a9893]">{{ item.meta }}</span>
            </div>

            <!-- Tile -->
            <div
              class="tile absolute inset-0 flex flex-col items-center justify-center gap-[0.6em] rounded-[0.8em] p-[0.6em] text-center transition-opacity duration-300"
              :class="[mode === 'tile' ? 'opacity-100' : 'opacity-0', { picked: i === 1 }]"
            >
              <div v-if="item.kind === 'folder'" class="relative h-[4.2em] w-[5.6em]">
                <span class="absolute top-0 left-0 h-[1.2em] w-[2.4em] rounded-t-[0.4em] bg-[#bcd3f5]" />
                <span class="absolute inset-x-0 top-[0.8em] bottom-0 rounded-[0.5em] rounded-tl-none bg-[#cfe0fb]" />
              </div>
              <div
                v-else
                class="relative flex h-[5em] w-[4em] items-end justify-center rounded-[0.4em] bg-white pb-[0.5em] shadow-sm ring-1 ring-black/10"
              >
                <span class="absolute top-0 right-0 size-[1.2em] rounded-bl-[0.4em] bg-[#f0f0ee]" />
                <UIcon :name="kindIcon[item.kind]" class="absolute top-[1.4em] size-[1.5em]" :class="kindTint[item.kind].split(' ')[0]" />
                <span class="text-[0.7em] font-semibold tracking-wide text-[#9a9893] uppercase">
                  {{ item.name.split('.').pop() }}
                </span>
              </div>
              <span class="max-w-full truncate text-[0.9em] text-[#1f1f1e]">{{ item.name }}</span>
            </div>

            <!-- Card -->
            <div
              class="absolute inset-0 overflow-hidden rounded-[0.8em] shadow-sm transition-opacity duration-300"
              :class="mode === 'card' ? 'opacity-100' : 'opacity-0'"
            >
              <div v-if="item.kind === 'note'" class="size-full border border-amber-200/80 bg-[#fff7d6] p-[0.9em]">
                <p class="text-[0.95em] leading-snug text-amber-950/80">
                  Welcome. Everything here is a file in the Research folder.
                </p>
              </div>

              <div v-else-if="item.kind === 'image'" class="flex size-full flex-col border border-black/10 bg-white">
                <img src="/landing-alt2/sea-horizon.jpg" alt="" class="min-h-0 w-full flex-1 object-cover" width="520" height="346">
                <p class="truncate px-[0.8em] py-[0.5em] text-[0.9em] font-medium text-[#1f1f1e]">Harbor morning</p>
              </div>

              <div v-else-if="item.kind === 'folder'" class="flex size-full flex-col border border-black/10 bg-white p-[0.7em]">
                <div class="flex items-center gap-[0.5em]">
                  <UIcon name="i-tabler-layout-grid" class="size-[1.1em] text-[#d4537e]" />
                  <span class="truncate text-[0.9em] font-medium text-[#1f1f1e]">References</span>
                </div>
                <div class="mt-[0.6em] grid flex-1 grid-cols-3 gap-[0.35em]">
                  <span class="rounded-[0.3em] bg-rose-100" />
                  <span class="rounded-[0.3em] bg-sky-100" />
                  <span class="rounded-[0.3em] bg-amber-100" />
                  <span class="rounded-[0.3em] bg-emerald-100" />
                  <span class="rounded-[0.3em] bg-violet-100" />
                  <span class="rounded-[0.3em] bg-slate-100" />
                </div>
              </div>

              <div v-else-if="item.kind === 'markdown'" class="size-full border border-black/10 bg-white p-[0.9em]">
                <p class="text-[1.05em] font-semibold text-[#1f1f1e]">Mood</p>
                <ul class="mt-[0.4em] space-y-[0.25em] text-[0.85em] text-[#5f5e5a]">
                  <li>• warm light</li>
                  <li>• a <b class="text-[#1f1f1e]">quiet</b> room</li>
                  <li>• one object on the table</li>
                </ul>
              </div>

              <div v-else-if="item.kind === 'video'" class="relative flex size-full items-center justify-center bg-slate-900">
                <div class="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,#f59e0b33,transparent_60%)]" />
                <span class="relative flex size-[2.6em] items-center justify-center rounded-full bg-white/90">
                  <UIcon name="i-lucide-play" class="ml-[0.1em] size-[1.2em] text-slate-900" />
                </span>
                <span class="absolute right-[0.8em] bottom-[0.7em] left-[0.8em] h-[0.25em] rounded-full bg-white/20">
                  <span class="block h-full w-[38%] rounded-full bg-white/80" />
                </span>
              </div>

              <div v-else class="flex size-full items-center justify-center border border-black/10 bg-[radial-gradient(circle_at_50%_40%,#fff_0%,#eef3f8_100%)]">
                <HomeCube class="text-[1.5em]" />
              </div>
            </div>
          </div>

          <!-- Canvas zoom readout -->
          <span
            class="zoom absolute right-[2%] bottom-[3%] rounded-md bg-white px-[0.6em] py-[0.25em] text-[0.8em] font-medium transition-opacity duration-300"
            :class="active === 'canvas' ? 'opacity-100' : 'opacity-0'"
          >
            80%
          </span>

          <!-- Stack fade -->
          <div
            class="fade pointer-events-none absolute inset-x-0 bottom-0 h-[18%] transition-opacity duration-300"
            :class="active === 'stack' ? 'opacity-100' : 'opacity-0'"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Tabs: one pill group, in three groups ───────────── */

/* On a phone the row scrolls sideways, out to the screen's edges */
.tabs-scroll {
  margin: 0 calc(-1 * var(--a2-gutter));
  overflow-x: auto;
  padding: 0 var(--a2-gutter) 0.25rem;
  scrollbar-width: none;
}

.tabs {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border: 1px solid var(--a2-line);
  border-radius: 999px;
  background: var(--a2-surface);
  padding: 0.3rem;
}

.tab {
  display: inline-flex;
  min-height: 2.5rem;
  flex-shrink: 0;
  cursor: pointer;
  align-items: center;
  gap: 0.45rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  padding: 0 0.95rem;
  color: var(--a2-ink-2);
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 500;
  white-space: nowrap;
}

.tab:hover {
  background: var(--a2-bg);
  color: var(--a2-ink);
}

.tab.is-on {
  background: var(--a2-ink);
  color: #fff;
}

.divider {
  width: 1px;
  height: 1.25rem;
  margin: 0 0.25rem;
  flex: none;
  background: var(--a2-line);
}

/* ── Caption and controls ────────────────────────────── */

.caption-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1.5rem;
  margin: 1.25rem 0 1.5rem;
}

.caption {
  max-width: 44rem;
  margin: 0;
  color: var(--a2-ink-2);
  font-size: 1rem;
}

.caption-name {
  color: var(--a2-ink);
  font-weight: 600;
}

.controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.slide-nav {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.count {
  min-width: 2.5rem;
  color: var(--a2-ink-3);
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.ctl,
.play {
  display: inline-flex;
  height: 2.25rem;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  border: 1px solid var(--a2-line);
  border-radius: 999px;
  background: var(--a2-surface);
  color: var(--a2-ink);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 600;
}

.ctl {
  width: 2.25rem;
}

.play {
  padding: 0 0.9rem 0 0.75rem;
}

.ctl:hover,
.play:hover {
  border-color: var(--a2-ink-3);
}

/* ── The window, in the app's palette ────────────────── */

.frame {
  background: #fff;
}

.hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid rgb(0 0 0 / 0.08);
  padding: 0.65rem 1rem 0.7rem;
  color: #1f1f1e;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 13px;
}

.where {
  display: grid;
  gap: 0.15rem;
}

.crumbs {
  display: inline-flex;
  align-items: center;
  gap: 0.25em;
  color: #9a9893;
  font-size: 0.95em;
}

.title {
  font-size: 1.35em;
  font-weight: 600;
}

.viewbtn {
  display: grid;
  width: 2.2em;
  height: 2.2em;
  place-items: center;
  border-radius: 0.45em;
  background: #f0f0ee;
  color: #5f5e5a;
}

.stage {
  container-type: inline-size;
  background: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  transition: background-color 0.5s ease;
}

/* 3D: the white table stands on the app's grey floor */
.floor {
  background-color: #eceae6;
}

.dots {
  background-color: #f8f8f7;
  background-image: radial-gradient(#cfcdc8 1px, transparent 1px);
  background-size: 2.2em 2.2em;
}

/* Twelve columns of 6.4% with gaps of 1.2% of the stage, over its middle 90% */
.cols {
  background: repeating-linear-gradient(
    to right,
    rgb(59 111 182 / 0.045) 0 7.111%,
    transparent 7.111% 8.444%
  );
}

/* cqw resolves against the stage, so the mock scales with its box */
.zoomer {
  font-size: clamp(6px, 1.25cqw, 13px);
  transform-style: preserve-3d;
  transition: transform 0.7s cubic-bezier(0.2, 0.8, 0.2, 1);
}

/* 3D: the plane tilts back, as the app's camera sees its table */
.tilt {
  transform: perspective(70em) translate(-1.5%, -8%) rotateX(44deg) rotateZ(-8deg) scale(0.82);
}

.item {
  transform-style: preserve-3d;
}

.tbl {
  border: 1px solid #e7e5df;
  background-color: #fff;
  background-image:
    linear-gradient(to right, rgb(15 23 42 / 0.07) 1px, transparent 1px),
    linear-gradient(to bottom, rgb(15 23 42 / 0.07) 1px, transparent 1px);
  background-size: 4% 6.4%;
  box-shadow: 0 0.5em 0 #e7e5df, 0 2em 3em rgb(15 23 42 / 0.12);
}

.lift-shadow {
  background: radial-gradient(closest-side, rgb(15 23 42 / 0.22), transparent);
}

.list-head {
  border-bottom: 1px solid rgb(0 0 0 / 0.08);
  color: #9a9893;
}

.row {
  background: #fff;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.08);
}

.row.picked,
.tile.picked {
  background: #e6f1fb;
  box-shadow: 0 0 0 1px #85b7eb;
}

.zoom {
  color: #5f5e5a;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.08);
}

.fade {
  background: linear-gradient(to top, #fff, transparent);
}

@media (prefers-reduced-motion: no-preference) {
  .flow {
    animation: flow 1.4s linear infinite;
  }
}

@keyframes flow {
  to {
    stroke-dashoffset: -5.6;
  }
}

/* With reduced motion the views switch at once, unless Play was pressed */
@media (prefers-reduced-motion: reduce) {
  .stage:not(.playing) * {
    transition-duration: 0ms !important;
  }
}
</style>
