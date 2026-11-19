<!-- Block 2, files come alive. Your own files and folders, on your disk or in
     the cloud, shown as what they hold. The same window, the folder as a
     canvas; a tour of six things, like block 1's views: each lights its
     place in the window and opens what the app opens for it — the + menu
     with its shapes, the layers menu, the canvas's pen. The tour runs on its
     own while the block is on screen; a click on a step takes over. -->
<script setup lang="ts">
import { homeBookmarks, homeTree } from "~/utils/finalFolder";
import type { AliveStep } from "./AliveCanvas.vue";
import type { Crumb } from "./AppWindow.vue";

const crumbs: Crumb[] = [{ glyph: "home" }, { name: "Pictures" }];

const steps: { id: AliveStep; label: string; icon: string; caption: string }[] = [
  { id: "previews", label: "Previews", icon: "i-tabler-photo", caption: "Photos, videos, sound and 3D models show what they are, and play right in the folder." },
  { id: "covers", label: "Covers", icon: "i-tabler-palette", caption: "Give a folder or a file a colour or a picture, and it becomes its card." },
  { id: "folder", label: "Folder preview", icon: "i-tabler-layout-grid", caption: "A folder can open in place: its things in a frame, right among yours." },
  { id: "shapes", label: "Shapes", icon: "i-tabler-shape", caption: "Add a note, text or a shape from +. A shape is an SVG file any editor opens." },
  { id: "layers", label: "Layers", icon: "i-tabler-stack-2", caption: "Things lie in layers: drag one above another, or pin the list to the right." },
  { id: "pen", label: "Pen", icon: "i-tabler-pencil", caption: "Draw over anything on a canvas: circle a detail, point at it, write a word." },
];

const step = ref<AliveStep>("previews");
const meta = computed(() => steps.find(s => s.id === step.value)!);
const playing = ref(true);

/** Which header menu the step opens */
const open = computed(() => (step.value === "shapes" ? "add" : step.value === "layers" ? "layers" : null));

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

/* The layers menu (LayersMenu.vue, LayersList.vue): the folder's things, top first */
const layers = [
  { icon: "i-tabler-file-text", name: "Title.md" },
  { icon: "i-tabler-photo", name: "sea-horizon.jpg" },
  { icon: "i-tabler-movie", name: "waves.mp4" },
  { icon: "i-tabler-music", name: "gulls.mp3" },
  { icon: "i-tabler-file", name: "sailboat.glb" },
  { icon: "i-tabler-file-text", name: "Mood.md", current: true },
  { icon: "i-tabler-folder", name: "References" },
  { icon: "i-tabler-folder", name: "Palette" },
  { icon: "i-tabler-layout-grid", name: "Inspiration", color: "#d4537e" },
  { icon: "i-tabler-file", name: "Circle.svg" },
];
</script>

<template>
  <section id="files" ref="root" class="sec" aria-labelledby="files-title">
    <div class="lf-wrap">
      <header class="head">
        <span class="lf-marker" aria-hidden="true">2</span>
        <div class="trow">
          <h2 id="files-title" class="title">Files come alive</h2>
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

          <!-- Layers: the folder's things, top first, each with its grip -->
          <div v-if="open === 'layers'" class="pop layers">
            <div class="am laym">
              <div class="am-h"><span>Layers</span><span class="pin"><UIcon name="i-tabler-layout-sidebar-right" class="am-ic" />Pin to the right</span></div>
              <div v-for="l in layers" :key="l.name" class="am-i" :class="{ hl: l.current }">
                <UIcon name="i-tabler-grip-vertical" class="am-ic grip" />
                <UIcon :name="l.icon" class="am-ic" :style="{ color: l.color }" />{{ l.name }}
              </div>
            </div>
          </div>
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

@media (min-width: 1100px) {
  .lede {
    white-space: nowrap;
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

/* Layers is followed by AI, sync, share and more */
.layers {
  right: 11.65em;
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

.laym {
  width: 20em;
}

.pin {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  color: #5f5e5a;
}

.grip {
  width: 1em;
  color: #9a9893;
}
</style>
