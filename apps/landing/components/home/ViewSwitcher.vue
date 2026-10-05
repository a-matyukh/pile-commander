<script setup lang="ts">
type ViewId = "list" | "grid" | "board" | "canvas" | "stack" | "masonry" | "slides";
type Kind = "note" | "image" | "folder" | "markdown" | "video" | "model";
/** x, y, w, h in % of the stage; r is rotation in degrees */
type Box = { x: number; y: number; w: number; h: number; r?: number; hidden?: boolean };

// Same six things in every view — only the way of looking changes.
const items: { id: string; name: string; kind: Kind; meta: string }[] = [
  { id: "welcome", name: "Welcome.txt", kind: "note", meta: "Text · 1 KB" },
  { id: "harbor", name: "Harbor morning.svg", kind: "image", meta: "Image · 48 KB" },
  { id: "refs", name: "References", kind: "folder", meta: "Folder · 12 items" },
  { id: "mood", name: "Mood.md", kind: "markdown", meta: "Markdown · 2 KB" },
  { id: "clip", name: "clip.mp4", kind: "video", meta: "Video · 18 MB" },
  { id: "chair", name: "chair.glb", kind: "model", meta: "3D model · 3 MB" },
];

const views: { id: ViewId; label: string; icon: string; caption: string }[] = [
  { id: "list", label: "List", icon: "i-lucide-list", caption: "Rows with a name and an icon. For when you just need to find the thing." },
  { id: "grid", label: "Grid", icon: "i-lucide-layout-grid", caption: "Tiles, like any file manager. Folders keep their tab." },
  { id: "board", label: "Board", icon: "i-lucide-mouse-pointer-2", caption: "Place anything anywhere. Resize, leave space, snap to a grid if you like." },
  { id: "canvas", label: "Canvas", icon: "i-lucide-spline", caption: "An infinite canvas. Connect things, draw over them, zoom from 20% to 400%." },
  { id: "stack", label: "Stack", icon: "i-lucide-rows-3", caption: "One column you reorder by dragging. Notes and media open inline." },
  { id: "masonry", label: "Masonry", icon: "i-lucide-layout-dashboard", caption: "A tiled wall. Tiles snap to a grid and can span it." },
  { id: "slides", label: "Slides", icon: "i-lucide-presentation", caption: "One piece at a time. On a cloud workspace, everyone lands on the same slide." },
];

const SLIDE: Box = { x: 14, y: 7, w: 72, h: 78 };

const layouts: Record<Exclude<ViewId, "slides">, Box[]> = {
  list: items.map((_, i) => ({ x: 4, y: 12 + i * 13.5, w: 92, h: 10.5 })),
  grid: items.map((_, i) => ({ x: 7.5 + (i % 3) * 30.5, y: 7 + Math.floor(i / 3) * 46, w: 24.5, h: 40 })),
  board: [
    { x: 5, y: 8, w: 25, h: 32, r: -2 },
    { x: 61, y: 6, w: 32, h: 42 },
    { x: 35, y: 44, w: 19, h: 32 },
    { x: 7, y: 54, w: 25, h: 38, r: 1.5 },
    { x: 60, y: 56, w: 27, h: 36 },
    { x: 36, y: 7, w: 20, h: 30, r: 2 },
  ],
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
  masonry: [
    { x: 5, y: 6, w: 29, h: 40 },
    { x: 36, y: 6, w: 60, h: 40 },
    { x: 5, y: 49, w: 29, h: 45 },
    { x: 36, y: 49, w: 29, h: 45 },
    { x: 67, y: 49, w: 29, h: 21 },
    { x: 67, y: 73, w: 29, h: 21 },
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
const touched = ref(false);

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
  return {
    left: `${b.x}%`,
    top: `${b.y}%`,
    width: `${b.w}%`,
    height: `${b.h}%`,
    transform: `rotate(${b.r ?? 0}deg)`,
    opacity: b.hidden ? 0 : 1,
    transitionDelay: `${i * 35}ms`,
  };
}

function pick(id: ViewId) {
  touched.value = true;
  active.value = id;
}

function step(delta: number) {
  touched.value = true;
  slide.value = (slide.value + delta + items.length) % items.length;
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
  folder: "text-pc-600 bg-pc-50",
  video: "text-orange-600 bg-orange-50",
  model: "text-sky-600 bg-sky-50",
};

const root = useTemplateRef<HTMLElement>("root");

onMounted(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let visible = false;
  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = !!entry?.isIntersecting;
    },
    { threshold: 0.4 },
  );
  if (root.value) observer.observe(root.value);
  const order = views.map((v) => v.id);
  const timer = window.setInterval(() => {
    if (!visible || touched.value) return;
    active.value = order[(order.indexOf(active.value) + 1) % order.length]!;
  }, 3200);
  onUnmounted(() => {
    observer.disconnect();
    window.clearInterval(timer);
  });
});
</script>

<template>
  <div ref="root">
    <div class="-mx-5 overflow-x-auto px-5 pb-5 sm:mx-0 sm:px-0">
      <div
        role="tablist"
        aria-label="Folder views"
        class="inline-flex gap-1 rounded-xl border border-[var(--pc-gray-border)] bg-white p-1 shadow-sm"
      >
        <button
          v-for="view in views"
          :id="`home-view-tab-${view.id}`"
          :key="view.id"
          type="button"
          role="tab"
          :aria-selected="active === view.id"
          aria-controls="home-view-stage"
          class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors"
          :class="
            active === view.id
              ? 'bg-pc-500 font-semibold text-white'
              : 'text-slate-600 hover:bg-[var(--pc-gray-header)] hover:text-slate-900'
          "
          @click="pick(view.id)"
        >
          <UIcon :name="view.icon" class="size-4" />
          {{ view.label }}
        </button>
      </div>
    </div>

	<p class="min-w-0 flex-1 text-xs leading-relaxed text-slate-600 sm:text-sm" aria-live="polite">
		<span class="font-semibold text-slate-900">{{ activeView.label }}</span>
		— {{ activeView.caption }}
	</p>

    <div
      id="home-view-stage"
      role="tabpanel"
      :aria-labelledby="`home-view-tab-${active}`"
      class="mt-5 overflow-hidden rounded-2xl border border-[var(--pc-gray-border)] bg-white shadow-[0_24px_60px_-28px_rgba(15,23,42,0.28)]"
    >
      <div
        class="flex items-center gap-2 border-b border-[var(--pc-gray-border)] bg-[var(--pc-gray-header)] px-3 py-2.5"
      >
        <span class="size-2 rounded-full bg-slate-300" />
        <span class="size-2 rounded-full bg-slate-300" />
        <span class="size-2 rounded-full bg-slate-300" />
        <span class="ml-2 text-xs font-medium text-slate-500">Research</span>
        <span class="ml-auto inline-flex items-center gap-1 text-xs text-slate-500">
          <UIcon :name="activeView.icon" class="size-3.5" />
          {{ activeView.label }}
        </span>
      </div>

      <div
        class="home-stage relative aspect-[16/10] overflow-hidden transition-colors duration-500"
        :class="active === 'canvas' ? 'home-dots bg-[var(--pc-gray-surface)]' : 'bg-[linear-gradient(160deg,hsl(215_40%_98%)_0%,hsl(210_36%_95%)_100%)]'"
        aria-hidden="true"
      >
        <div class="home-scale absolute inset-0">
        <!-- List header -->
        <div
          class="absolute top-[3.5%] right-[4%] left-[4%] flex border-b border-[var(--pc-gray-border)] pb-[0.6em] text-[0.85em] font-medium text-slate-400 transition-opacity duration-300"
          :class="active === 'list' ? 'opacity-100' : 'opacity-0'"
        >
          <span class="pl-[3.2em]">Name</span>
          <span class="ml-auto">Kind</span>
        </div>

        <!-- Canvas connectors -->
        <svg
          class="pointer-events-none absolute inset-0 size-full text-pc-400 transition-opacity duration-500"
          :class="active === 'canvas' ? 'opacity-100' : 'opacity-0'"
          viewBox="0 0 160 100"
          fill="none"
        >
          <defs>
            <marker id="home-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
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
            marker-end="url(#home-arrow)"
            class="home-flow"
          />
        </svg>

        <div
          v-for="(item, i) in items"
          :key="item.id"
          class="absolute transition-all duration-700 ease-[cubic-bezier(.2,.8,.2,1)]"
          :style="styleFor(i)"
        >
          <!-- Row -->
          <div
            class="absolute inset-0 flex items-center gap-[0.8em] rounded-[0.6em] px-[0.8em] transition-opacity duration-300"
            :class="[
              mode === 'row' ? 'opacity-100' : 'opacity-0',
              i === 1 ? 'bg-pc-50 ring-1 ring-pc-200' : 'bg-white ring-1 ring-[var(--pc-gray-border)]',
            ]"
          >
            <span class="flex size-[2em] shrink-0 items-center justify-center rounded-[0.5em]" :class="kindTint[item.kind]">
              <UIcon :name="kindIcon[item.kind]" class="size-[1.1em]" />
            </span>
            <span class="truncate font-medium text-slate-800">{{ item.name }}</span>
            <span class="ml-auto shrink-0 text-[0.85em] text-slate-400">{{ item.meta }}</span>
          </div>

          <!-- Tile -->
          <div
            class="absolute inset-0 flex flex-col items-center justify-center gap-[0.6em] rounded-[0.8em] p-[0.6em] text-center transition-opacity duration-300"
            :class="[
              mode === 'tile' ? 'opacity-100' : 'opacity-0',
              i === 1 ? 'bg-pc-50 ring-1 ring-pc-200' : '',
            ]"
          >
            <div v-if="item.kind === 'folder'" class="relative h-[4.2em] w-[5.6em]">
              <span class="absolute top-0 left-0 h-[1.2em] w-[2.4em] rounded-t-[0.4em] bg-pc-300" />
              <span class="absolute inset-x-0 top-[0.8em] bottom-0 rounded-[0.5em] rounded-tl-none bg-pc-400 shadow-sm" />
            </div>
            <div
              v-else
              class="relative flex h-[5em] w-[4em] items-end justify-center rounded-[0.4em] bg-white pb-[0.5em] shadow-sm ring-1 ring-[var(--pc-gray-border)]"
            >
              <span class="absolute top-0 right-0 size-[1.2em] rounded-bl-[0.4em] bg-[var(--pc-gray-header)]" />
              <UIcon :name="kindIcon[item.kind]" class="absolute top-[1.4em] size-[1.5em]" :class="kindTint[item.kind].split(' ')[0]" />
              <span class="text-[0.7em] font-semibold tracking-wide text-slate-400 uppercase">
                {{ item.name.split('.').pop() }}
              </span>
            </div>
            <span class="max-w-full truncate text-[0.9em] text-slate-700">{{ item.name }}</span>
          </div>

          <!-- Card -->
          <div
            class="absolute inset-0 overflow-hidden rounded-[0.8em] shadow-sm transition-opacity duration-300"
            :class="mode === 'card' ? 'opacity-100' : 'opacity-0'"
          >
            <div
              v-if="item.kind === 'note'"
              class="size-full border border-amber-200/80 bg-[#fff7d6] p-[0.9em]"
            >
              <p class="text-[0.95em] leading-snug text-amber-950/80">
                Welcome to the demo workspace. Create notes, folders, and rearrange the board.
              </p>
            </div>

            <div v-else-if="item.kind === 'image'" class="flex size-full flex-col border border-[var(--pc-gray-border)] bg-white">
              <div class="relative flex-1 bg-[linear-gradient(180deg,#bae6fd_0%,#7dd3fc_45%,#2182f8_100%)]">
                <span class="absolute top-[18%] right-[20%] size-[2.2em] rounded-full bg-amber-200/90" />
                <svg class="absolute inset-x-0 bottom-0 h-[45%] w-full" viewBox="0 0 100 40" preserveAspectRatio="none">
                  <path d="M0 22 Q 20 14 40 22 T 80 20 T 100 18 V40 H0 Z" fill="#1553aa" opacity=".55" />
                  <path d="M0 30 Q 25 24 50 30 T 100 28 V40 H0 Z" fill="#0c2b5c" opacity=".7" />
                </svg>
              </div>
              <p class="truncate px-[0.8em] py-[0.5em] text-[0.9em] font-medium text-slate-700">Harbor morning</p>
            </div>

            <div v-else-if="item.kind === 'folder'" class="flex size-full flex-col border border-[var(--pc-gray-border)] bg-white p-[0.7em]">
              <div class="flex items-center gap-[0.5em]">
                <UIcon name="i-lucide-folder" class="size-[1.1em] text-pc-500" />
                <span class="truncate text-[0.9em] font-medium text-slate-700">References</span>
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

            <div v-else-if="item.kind === 'markdown'" class="size-full border border-[var(--pc-gray-border)] bg-white p-[0.9em]">
              <p class="text-[1.05em] font-semibold text-slate-900">Mood</p>
              <ul class="mt-[0.4em] space-y-[0.25em] text-[0.85em] text-slate-600">
                <li>• warm light</li>
                <li>• a <b class="text-slate-800">quiet</b> room</li>
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

            <div v-else class="flex size-full items-center justify-center border border-[var(--pc-gray-border)] bg-[radial-gradient(circle_at_50%_40%,#fff_0%,hsl(205_60%_94%)_100%)]">
              <HomeCube class="text-[1.5em]" />
            </div>
          </div>
        </div>

        <!-- Canvas zoom readout -->
        <span
          class="absolute right-[2%] bottom-[3%] rounded-md bg-white px-[0.6em] py-[0.25em] text-[0.8em] font-medium text-slate-500 shadow-sm ring-1 ring-[var(--pc-gray-border)] transition-opacity duration-300"
          :class="active === 'canvas' ? 'opacity-100' : 'opacity-0'"
        >
          80%
        </span>

        <!-- Stack fade -->
        <div
          class="pointer-events-none absolute inset-x-0 bottom-0 h-[18%] bg-gradient-to-t from-[hsl(210_36%_95%)] to-transparent transition-opacity duration-300"
          :class="active === 'stack' ? 'opacity-100' : 'opacity-0'"
        />
        </div>
      </div>

      <!-- Slides controls live outside the aria-hidden stage so they stay usable -->
      <div
        class="flex h-10 items-center justify-end gap-3 border-t border-[var(--pc-gray-border)] bg-[var(--pc-gray-header)] px-3"
      >
        <div v-if="active === 'slides'" class="flex shrink-0 items-center gap-1">
          <UButton
            icon="i-lucide-chevron-left"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Previous slide"
            @click="step(-1)"
          />
          <span class="text-xs tabular-nums text-slate-500">{{ slide + 1 }} / {{ items.length }}</span>
          <UButton
            icon="i-lucide-chevron-right"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Next slide"
            @click="step(1)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home-stage {
  container-type: inline-size;
}

/* cqw resolves against the stage, so the mock scales with its box */
.home-scale {
  font-size: clamp(6px, 1.25cqw, 13px);
}

.home-dots {
  background-image: radial-gradient(hsl(215 25% 80%) 1px, transparent 1px);
  background-size: 2.2em 2.2em;
}

@media (prefers-reduced-motion: no-preference) {
  .home-flow {
    animation: home-flow 1.4s linear infinite;
  }
}

@keyframes home-flow {
  to {
    stroke-dashoffset: -5.6;
  }
}

@media (prefers-reduced-motion: reduce) {
  .home-stage * {
    transition-duration: 0ms !important;
  }
}
</style>
