<!-- Block 2, files come alive. Your own files and folders, on your disk or in
     the cloud, shown as what they hold. The same window, the folder as a
     canvas; a tour of eight things, like block 1's views: each lights its
     place in the window and opens what the app opens for it — the + menu
     with its shapes, the canvas's pen. The layers panel is pinned open (an
     option in the app): it shows that every thing on the canvas, shapes
     included, is an ordinary file or folder. The tour runs on its
     own while the block is on screen; a click on a step takes over. -->
<script setup lang="ts">
import { homeBookmarks, homeTree } from "~/utils/finalFolder";
import type { AliveStep } from "./AliveCanvas.vue";
import type { Crumb } from "./AppWindow.vue";

const crumbs: Crumb[] = [{ glyph: "home" }, { name: "Pictures" }];

const steps: { id: AliveStep; label: string; icon: string; caption: string }[] = [
  { id: "notes", label: "Notes", icon: "i-tabler-note", caption: "A note or a text block is just the preview of a .md or .txt file: write right in it on the canvas." },
  { id: "previews", label: "Previews", icon: "i-tabler-photo", caption: "Photos, videos, sound and 3D models show what they are, and play right in the folder." },
  { id: "covers", label: "Covers", icon: "i-tabler-palette", caption: "Give a folder or a file a colour or a picture, and it becomes its card." },
  { id: "folder", label: "Folder preview", icon: "i-tabler-layout-grid", caption: "A folder can open in place: its things in a frame, right among yours." },
  { id: "shapes", label: "Shapes", icon: "i-tabler-shape", caption: "Add a shape from +: it is an SVG file, and any editor opens it." },
  { id: "layers", label: "Layers", icon: "i-tabler-stack-2", caption: "Every thing here is a plain file or folder, shapes too. Drag one above another to change the order." },
  { id: "connections", label: "Connections", icon: "i-tabler-vector-spline", caption: "Connect two things with a line and a label, as on a mind map." },
  { id: "pen", label: "Pen", icon: "i-tabler-pencil", caption: "Draw over anything on a canvas: circle a detail, point at it, write a word." },
];

const step = ref<AliveStep>("notes");
const meta = computed(() => steps.find(s => s.id === step.value)!);
const playing = ref(true);

/** Which header menu the step opens; the layers are pinned open anyway */
const open = computed(() => (step.value === "shapes" ? "add" : null));

function pick(id: AliveStep) {
  playing.value = false;
  step.value = id;
}

function next() {
  const i = steps.findIndex(s => s.id === step.value);
  step.value = steps[(i + 1) % steps.length]!.id;
}

function toggle() {
  playing.value = !playing.value;
  if (playing.value) next();
}

const root = useTemplateRef<HTMLElement>("root");

onMounted(() => {
  let visible = false;
  const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; }, { threshold: 0.35 });
  if (root.value) io.observe(root.value);
  const timer = window.setInterval(() => {
    if (visible && playing.value) next();
  }, 3600);
  onBeforeUnmount(() => {
    io.disconnect();
    window.clearInterval(timer);
  });
});

/* The + menu (AddMenu.vue) on a canvas, and its shapes (add_menu.ts) */
const addItems = [
  { icon: "i-tabler-folder-plus", label: "Folder" },
  { icon: "i-tabler-file-text", label: "Text file" },
  { icon: "i-tabler-markdown", label: "Markdown file" },
  { icon: "i-tabler-note", label: "Note" },
  { icon: "i-tabler-text-size", label: "Text" },
];
const shapes = [
  { icon: "i-tabler-square", label: "Rectangle" },
  { icon: "i-tabler-circle", label: "Circle" },
  { icon: "i-tabler-triangle", label: "Triangle" },
  { icon: "i-tabler-diamond", label: "Diamond" },
  { icon: "i-tabler-line", label: "Line" },
  { icon: "i-tabler-arrow-narrow-right", label: "Arrow" },
];

/* The layers panel (LayersPanel.vue, LayersList.vue, LayerGlyph.vue): the
   folder's things, top first; a picture shows its thumbnail, anything else
   the icon List uses. Each row lights up on the steps it belongs to */
const layers: { name: string; icon?: string; color?: string; thumb?: string; steps: AliveStep[] }[] = [
  { name: "Title.md", icon: "i-tabler-file-text", steps: ["notes"] },
  { name: "sea-horizon.jpg", thumb: "/landing-alt2/sea-horizon.jpg", steps: ["previews"] },
  { name: "waves.mp4", icon: "i-tabler-movie", steps: ["previews"] },
  { name: "gulls.mp3", icon: "i-tabler-music", steps: ["previews"] },
  { name: "sailboat.glb", icon: "i-tabler-box", steps: ["previews"] },
  { name: "Mood.md", icon: "i-tabler-file-text", steps: ["notes", "covers"] },
  { name: "References", icon: "i-tabler-folder", steps: ["covers"] },
  { name: "Palette", icon: "i-tabler-palette", color: "#1d9e75", steps: ["covers"] },
  { name: "Inspiration", icon: "i-tabler-layout-grid", color: "#d4537e", steps: ["folder"] },
  { name: "Circle.svg", icon: "i-tabler-file", steps: ["shapes"] },
  { name: "Triangle.svg", icon: "i-tabler-file", steps: ["shapes"] },
  { name: "Diamond.svg", icon: "i-tabler-file", steps: ["shapes"] },
  { name: "Arrow.svg", icon: "i-tabler-file", steps: ["shapes"] },
];
</script>

<template>
  <section id="files" ref="root" class="sec" aria-labelledby="files-title">
    <div class="lf-wrap">
      <header class="head">
        <span class="lf-marker" aria-hidden="true">2</span>
        <div class="trow">
          <h2 id="files-title" class="title">Files and folders come alive</h2>
          <button type="button" class="play" :aria-pressed="playing" @click="toggle">
            <UIcon :name="playing ? 'i-tabler-player-pause' : 'i-tabler-player-play'" class="pi" />
            {{ playing ? "Pause" : "Play" }}
          </button>
          <p class="hint"><UIcon name="i-tabler-pointer" class="pi" />Pick one to see it</p>
        </div>
        <p class="lede">Your own files and folders, on your disk or in the cloud, shown as what they are and not as icons.</p>

        <!-- The six steps; the one on screen is pressed -->
        <div class="steps" role="group" aria-label="What files can do">
          <button
            v-for="s in steps"
            :key="s.id"
            type="button"
            class="chip"
            :aria-pressed="step === s.id"
            @click="pick(s.id)"
          >
            <UIcon :name="s.icon" class="ci" />{{ s.label }}
          </button>
        </div>
        <p class="caption" aria-live="polite">{{ meta.caption }}</p>
      </header>

      <FinalAppWindow
        class="shot"
        :crumbs="crumbs"
        title="Harbor moodboard"
        :bookmarks="homeBookmarks('canvas')"
        :tree="homeTree('canvas')"
        view-icon="i-tabler-artboard"
        view-color="#1D9E75"
        :markers="[2]"
        :open="open"
      >
        <FinalAliveCanvas :step="step" :drawing="step === 'pen'" />
        <template #over>
          <!-- + : the menu, its Shape row open to the left -->
          <div v-if="open === 'add'" class="pop add">
            <div class="am addm">
              <div v-for="i in addItems" :key="i.label" class="am-i"><UIcon :name="i.icon" class="am-ic" />{{ i.label }}</div>
              <div class="am-i hl"><UIcon name="i-tabler-shape" class="am-ic" />Shape<UIcon name="i-tabler-chevron-right" class="am-ic am-end" /></div>
              <div class="am-sep" />
              <div class="am-i"><UIcon name="i-tabler-upload" class="am-ic" />Import files…</div>
            </div>
            <div class="am subm">
              <div v-for="(sh, i) in shapes" :key="sh.label" class="am-i" :class="{ hl: i === 1 }"><UIcon :name="sh.icon" class="am-ic" />{{ sh.label }}</div>
            </div>
          </div>

        </template>

        <!-- The layers panel, pinned right (LayersPanel.vue): every thing on
             the canvas is a file or a folder in it, shapes included -->
        <template #aside>
          <aside class="lp" :class="{ ring: step === 'layers' }">
            <div class="lh"><span>Layers</span><span class="lu"><UIcon name="i-tabler-layout-sidebar-right-collapse" class="am-ic" />Show as a menu</span></div>
            <div class="lb">
              <div v-for="l in layers" :key="l.name" class="ly" :class="{ on: l.steps.includes(step) }">
                <UIcon name="i-tabler-grip-vertical" class="gp" />
                <img v-if="l.thumb" :src="l.thumb" alt="" class="th">
                <UIcon v-else :name="l.icon!" class="gi" :style="{ color: l.color }" />
                <span class="ln">{{ l.name }}</span>
              </div>
            </div>
          </aside>
        </template>
      </FinalAppWindow>
    </div>
  </section>
</template>

<style scoped>
.sec {
  padding: var(--lf-section) 0 0;
  scroll-margin-top: 1rem;
}

.head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.25rem 0.75rem;
  margin-bottom: 1.75rem;
}

.trow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
}

.title {
  margin: 0;
  font-size: clamp(1.75rem, 2.6vw, 2.25rem);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.15;
}

.lede {
  grid-column: 2;
  margin: 0.625rem 0 0;
  color: var(--lf-ink-2);
  font-size: 1.0625rem;
  line-height: 1.5;
}

/* One row on a computer while it fits; a longer sentence splits into two
   even rows rather than running past the column and scrolling the page */
@media (min-width: 1100px) {
  .lede {
    text-wrap: balance;
  }
}

/* The steps: chips like block 1's view chip; the one on screen is filled */
.steps {
  display: flex;
  grid-column: 2;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  border: 1px solid var(--lf-line-strong);
  border-radius: 6px;
  background: transparent;
  padding: 0.25rem 0.625rem 0.25rem 0.5rem;
  color: var(--lf-ink-2);
  font: inherit;
  font-size: 0.9375rem;
  cursor: pointer;
}

.chip:hover {
  border-color: rgb(0 0 0 / 0.3);
  color: var(--lf-ink);
}

.chip[aria-pressed="true"] {
  background: var(--lf-surface);
  color: var(--lf-ink);
  font-weight: 600;
}

.ci {
  width: 1.125rem;
  height: 1.125rem;
  flex: none;
}

.caption {
  grid-column: 2;
  margin: 0.625rem 0 0;
  color: var(--lf-ink-2);
  font-size: 1.0625rem;
  line-height: 1.5;
}

.play {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.375rem;
  border: 1px solid var(--lf-line-strong);
  border-radius: 999px;
  background: var(--lf-surface);
  padding: 0.375rem 0.875rem;
  color: var(--lf-ink);
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
}

.play:hover {
  border-color: rgb(0 0 0 / 0.3);
}

.hint {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  margin: 0;
  border: 1px solid var(--lf-line-strong);
  border-radius: 999px;
  padding: 0.375rem 0.875rem;
  color: var(--lf-ink-3);
  font-size: 0.875rem;
  line-height: 1.5;
}

.pi {
  width: 1rem;
  height: 1rem;
}

/* The menus under their buttons, right edges on the buttons' */
.pop {
  position: absolute;
  top: 3.25em;
  z-index: 3;
}

/* + is followed by layers, AI, sync, share and more */
.add {
  right: 14.25em;
}

.addm {
  width: 16.9em;
}

/* The shapes open to the left of the Shape row */
.subm {
  position: absolute;
  top: calc(0.31em + 5 * 2.15em - 0.31em);
  right: calc(100% - 0.3em);
  width: 11em;
}

/* The pinned layers panel: 240px, the window's gray, a thin left border */
.lp {
  display: flex;
  width: 18.5em;
  flex: none;
  flex-direction: column;
  border-left: 1px solid rgb(0 0 0 / 0.08);
  background: #f8f8f7;
  color: #1f1f1e;
  outline: 2px solid transparent;
  outline-offset: -3px;
  transition: outline-color 0.2s ease;
}

/* In a phone-sized window the panel would squeeze the canvas: it shows
   on its own step only */
@container (max-width: 760px) {
  .lp:not(.ring) {
    display: none;
  }

  .lp {
    width: 13em;
  }
}

.lp.ring {
  outline-color: #2453ff;
}

.lh {
  display: flex;
  min-height: 2.77em;
  align-items: center;
  justify-content: space-between;
  padding: 0 0.62em 0 0.92em;
  color: #9a9893;
  font-size: 0.846em;
}

.lu {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  color: #5f5e5a;
}

.lb {
  overflow: hidden;
  padding: 0 0.46em 0.62em;
}

/* A row as a menu item, 28px */
.ly {
  display: flex;
  height: 2.15em;
  align-items: center;
  gap: 0.62em;
  border-radius: 0.46em;
  padding: 0 0.62em 0 0.3em;
  white-space: nowrap;
  transition: background-color 0.2s ease;
}

/* The rows of the step on screen */
.ly.on {
  background: #e6f1fb;
  color: #185fa5;
}

.gp {
  width: 1.08em;
  height: 1.08em;
  flex: none;
  color: #9a9893;
}

.gi {
  width: 1.23em;
  height: 1.23em;
  flex: none;
  color: #5f5e5a;
}

.ly.on .gi {
  color: inherit;
}

.th {
  width: 1.23em;
  height: 1.23em;
  flex: none;
  border-radius: 0.2em;
  object-fit: cover;
}

.ln {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
