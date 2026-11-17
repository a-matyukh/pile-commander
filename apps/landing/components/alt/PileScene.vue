<!-- The page's story in one frame: a folder as a list of names that say
     nothing, the same folder as a board, the files named by what is in them,
     then sorted into folders. The frame is a picture; the steps under it are
     real buttons and stop the loop. The server renders the first step, so the
     loop picks up from the first paint. Reduced motion lands on the last one. -->
<script setup lang="ts">
type Kind = "photo" | "note" | "pdf";

type PileFile = {
  key: string;
  kind: Kind;
  /** The name it came with, and the name the model gives it */
  raw: string;
  name: string;
  meta: string;
  /** Its line in the list */
  row: number;
  /** On the board, % of the stage; r in degrees */
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  /** The folder it is sorted into; without one it stays where it is */
  fx?: number;
  fy?: number;
  lines?: string[];
};

// Later ones lie on top: it is a pile
const files: PileFile[] = [
  { key: "beach", kind: "photo", raw: "IMG_4821.jpg", name: "beach.jpg", meta: "JPEG image", row: 0, x: 5, y: 9, w: 19, h: 31, r: -4, fx: 5, fy: 9 },
  { key: "pier", kind: "photo", raw: "IMG_4822.jpg", name: "pier.jpg", meta: "JPEG image", row: 1, x: 20, y: 27, w: 19, h: 31, r: 3, fx: 5, fy: 9 },
  { key: "packing", kind: "note", raw: "Untitled.md", name: "Packing.md", meta: "Markdown", row: 5, x: 53, y: 8, w: 19, h: 30, r: 2, fx: 53, fy: 8, lines: ["passport", "charger", "sunscreen"] },
  { key: "budget", kind: "note", raw: "Untitled 2.md", name: "Budget.md", meta: "Markdown", row: 4, x: 67, y: 31, w: 19, h: 30, r: -3, fx: 53, fy: 8, lines: ["flights 420", "hotel 610", "food 300"] },
  { key: "sunset", kind: "photo", raw: "IMG_4830.jpg", name: "sunset.jpg", meta: "JPEG image", row: 2, x: 8, y: 55, w: 19, h: 31, r: 5, fx: 5, fy: 9 },
  { key: "tickets", kind: "pdf", raw: "scan_0007.pdf", name: "Tickets.pdf", meta: "PDF document", row: 3, x: 40, y: 58, w: 15, h: 27, r: 0 },
];

// As in the app: a new folder stands where its first file stood
const folders = [
  { key: "photos", name: "Photos", x: 5, y: 9, thumbs: ["beach", "pier", "sunset"] },
  { key: "plans", name: "Plans", x: 53, y: 8, thumbs: [] as string[] },
];

const kindIcon: Record<Kind, string> = {
  photo: "i-lucide-image",
  note: "i-lucide-file-type",
  pdf: "i-lucide-file-text",
};

// The AI steps carry the app's own action names
const steps = ["A pile of files", "See it as a board", "Rename files by content", "Sort into folders"];
const LAST = steps.length - 1;
/** How long each step stays before the next, ms */
const HOLD = [2200, 3000, 3800, 4800];

const root = useTemplateRef<HTMLElement>("root");
const phase = ref(0);
const auto = ref(true);
// The visitor pressed Play: move even when the system asks for less motion
const motion = ref(false);
// Going back to the pile: fade out, jump with no motion, fade in
const rewinding = ref(false);
const snap = ref(false);

let timers: ReturnType<typeof setTimeout>[] = [];
let visible = false;
let observer: IntersectionObserver | undefined;

function at(ms: number, fn: () => void) {
  timers.push(setTimeout(fn, ms));
}

function stop() {
  for (const t of timers) clearTimeout(t);
  timers = [];
  rewinding.value = false;
  snap.value = false;
}

function play() {
  stop();
  if (!auto.value || !visible) return;
  at(HOLD[phase.value]!, () => {
    if (phase.value < LAST) {
      phase.value++;
      play();
      return;
    }
    rewinding.value = true;
    at(350, () => {
      snap.value = true;
      phase.value = 0;
      at(80, play);
    });
  });
}

function go(step: number) {
  auto.value = false;
  stop();
  phase.value = step;
}

/** Play: from the pile again. Pressing it is a request to see it move,
    so it plays under reduced motion too. */
function resume() {
  stop();
  motion.value = true;
  auto.value = true;
  snap.value = true;
  phase.value = 0;
  at(80, play);
}

onMounted(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    auto.value = false;
    phase.value = LAST;
  }
  observer = new IntersectionObserver(
    ([entry]) => {
      visible = !!entry?.isIntersecting;
      if (visible) play();
      else stop();
    },
    { threshold: 0.3 },
  );
  if (root.value) observer.observe(root.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  stop();
});
</script>

<template>
  <div ref="root" class="pile" :class="{ 'is-motion': motion }">
    <div class="alt-frame window">
      <div class="chrome">
        <span class="dot" />
        <span class="dot" />
        <span class="dot" />
        <span class="chrome-name">Trip pile</span>
        <span class="chrome-view">
          <UIcon :name="phase === 0 ? 'i-tabler-list' : 'i-tabler-template'" class="size-3.5" />
          {{ phase === 0 ? "List" : "Board" }}
        </span>
      </div>

      <div
        class="stage"
        :class="{
          'is-board': phase >= 1,
          'is-named': phase >= 2,
          'is-sorted': phase >= 3,
          'is-rewinding': rewinding,
          'is-snap': snap,
        }"
        aria-hidden="true"
      >
        <div class="scale">
          <div class="list-head">
            <span>Name</span>
            <span>Kind</span>
          </div>

          <!-- The folders the sort makes, each showing what is in it -->
          <article
            v-for="(folder, i) in folders"
            :key="folder.key"
            class="folder"
            :style="{ left: `${folder.x}%`, top: `${folder.y}%`, '--i': i }"
          >
            <p class="folder-name">
              <UIcon name="i-lucide-folder" class="size-[1.2em] text-pc-500" />
              {{ folder.name }}
            </p>
            <div v-if="folder.thumbs.length" class="folder-grid">
              <span v-for="thumb in folder.thumbs" :key="thumb" class="thumb" :class="`thumb-${thumb}`" />
            </div>
            <div v-else class="folder-grid">
              <span class="mini-note" />
              <span class="mini-note" />
            </div>
          </article>

          <article
            v-for="(file, i) in files"
            :key="file.key"
            class="file"
            :class="{ goes: file.fx !== undefined }"
            :style="{
              '--row': file.row,
              '--x': `${file.x}%`,
              '--y': `${file.y}%`,
              '--w': `${file.w}%`,
              '--h': `${file.h}%`,
              '--r': `${file.r}deg`,
              '--fx': `${file.fx ?? file.x}%`,
              '--fy': `${file.fy ?? file.y}%`,
              '--i': i,
            }"
          >
            <!-- In the list: a name and a kind, nothing else -->
            <div class="face row">
              <span class="row-icon" :class="`icon-${file.kind}`">
                <UIcon :name="kindIcon[file.kind]" class="size-[1.1em]" />
              </span>
              <span class="row-name">{{ file.raw }}</span>
              <span class="row-meta">{{ file.meta }}</span>
            </div>

            <!-- On the board: the thing itself -->
            <div class="face card" :class="`card-${file.kind}`">
              <div v-if="file.kind === 'photo'" class="thumb" :class="`thumb-${file.key}`" />
              <div v-else-if="file.kind === 'note'" class="note-lines">
                <p v-for="line in file.lines" :key="line">{{ line }}</p>
              </div>
              <div v-else class="page">
                <UIcon name="i-lucide-file-text" class="size-[1.7em] text-rose-500" />
                <span class="page-line" />
                <span class="page-line page-line-short" />
              </div>
              <p class="cap">
                <span class="cap-raw">{{ file.raw }}</span>
                <span class="cap-new">{{ file.name }}</span>
              </p>
            </div>
          </article>

          <p class="chip">
            <UIcon name="i-lucide-sparkles" class="size-[1.15em] text-pc-600" />
            {{ phase >= 3 ? steps[3] : steps[2] }}
          </p>
        </div>
      </div>

      <!-- Shown whenever the loop is not running: after a step was picked,
           or from the start under reduced motion -->
      <button v-if="!auto" type="button" class="play" @click="resume">
        <UIcon name="i-lucide-play" class="size-3.5" />
        Play
      </button>
    </div>

    <ol class="steps">
      <li v-for="(label, n) in steps" :key="label">
        <button
          type="button"
          class="step"
          :class="{ 'is-on': phase === n, 'is-done': phase > n }"
          :aria-current="phase === n ? 'step' : undefined"
          @click="go(n)"
        >
          <span class="step-n">{{ n + 1 }}</span>
          {{ label }}
        </button>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.pile {
  min-width: 0;
}

p {
  margin: 0;
}

/* ── The window ──────────────────────────────────────── */

.window {
  position: relative;
}

.play {
  position: absolute;
  right: 0.75rem;
  bottom: 0.75rem;
  display: inline-flex;
  height: 2rem;
  cursor: pointer;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid var(--alt-line);
  border-radius: 999px;
  background: var(--alt-paper);
  padding: 0 0.8rem 0 0.65rem;
  color: var(--alt-ink);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1;
}

.play:hover {
  background: var(--alt-wash);
}

.chrome {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border-bottom: 1px solid var(--pc-gray-border);
  background: var(--pc-gray-header);
  padding: 0.625rem 0.75rem;
  color: #64748b;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1;
}

.dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: #cbd5e1;
}

.chrome-name {
  margin-left: 0.5rem;
}

.chrome-view {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: auto;
}

.stage {
  position: relative;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  container-type: inline-size;
  background: hsl(213 40% 98%);
  color: #334155;
  line-height: 1.35;
}

/* cqw resolves against the stage, so the picture scales with its box */
.scale {
  position: absolute;
  inset: 0;
  font-size: clamp(7px, 1.6cqw, 15px);
  transition: opacity 0.3s ease;
}

/* The board's dotted surface */
.scale::before {
  position: absolute;
  inset: 0;
  background-color: hsl(213 40% 96.5%);
  background-image: radial-gradient(hsl(215 25% 80%) 1px, transparent 1px);
  background-size: 1.6em 1.6em;
  content: "";
  opacity: 0;
  transition: opacity 0.5s ease;
}

.is-board .scale::before {
  opacity: 1;
}

.is-rewinding .scale {
  opacity: 0;
}

.is-snap * {
  transition: none !important;
}

.list-head {
  position: absolute;
  top: 4%;
  right: 4%;
  left: 4%;
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid var(--pc-gray-border);
  padding: 0 0.8em 0.6em 3.6em;
  color: #94a3b8;
  font-size: 0.85em;
  font-weight: 500;
  transition: opacity 0.3s ease;
}

.is-board .list-head {
  opacity: 0;
}

/* ── A file: a row in the list, a card on the board ──── */

.file {
  position: absolute;
  top: calc(14% + var(--row) * 13.2%);
  left: 4%;
  width: 92%;
  height: 11%;
  transition:
    left 0.8s cubic-bezier(0.2, 0.8, 0.2, 1),
    top 0.8s cubic-bezier(0.2, 0.8, 0.2, 1),
    width 0.8s cubic-bezier(0.2, 0.8, 0.2, 1),
    height 0.8s cubic-bezier(0.2, 0.8, 0.2, 1),
    rotate 0.8s cubic-bezier(0.2, 0.8, 0.2, 1),
    scale 0.7s cubic-bezier(0.5, 0, 0.2, 1),
    opacity 0.45s ease;
  transition-delay: calc(var(--i) * 45ms);
}

.is-board .file {
  top: var(--y);
  left: var(--x);
  width: var(--w);
  height: var(--h);
  rotate: var(--r);
}

/* Sorted: into its folder; what fits nowhere stays. The wait lets the
   action's name show first. */
.is-sorted .file.goes {
  top: var(--fy);
  left: var(--fx);
  scale: 0.4;
  opacity: 0;
  transition-delay:
    calc(0.7s + var(--i) * 70ms),
    calc(0.7s + var(--i) * 70ms),
    0s,
    0s,
    0s,
    calc(0.7s + var(--i) * 70ms),
    calc(1s + var(--i) * 70ms);
}

.face {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  transition: opacity 0.3s ease;
}

.row {
  display: flex;
  align-items: center;
  gap: 0.8em;
  border-radius: 0.6em;
  background: white;
  padding: 0 0.8em;
  box-shadow: inset 0 0 0 1px var(--pc-gray-border);
}

.is-board .row {
  opacity: 0;
}

.row-icon {
  display: grid;
  width: 2em;
  height: 2em;
  flex-shrink: 0;
  place-items: center;
  border-radius: 0.5em;
}

.icon-photo {
  background: #ecfdf5;
  color: #059669;
}

.icon-note {
  background: #f1f5f9;
  color: #475569;
}

.icon-pdf {
  background: #fff1f2;
  color: #e11d48;
}

.row-name {
  overflow: hidden;
  color: #1e293b;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-meta {
  flex-shrink: 0;
  margin-left: auto;
  color: #94a3b8;
  font-size: 0.85em;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 0.4em;
  border: 1px solid var(--pc-gray-border);
  border-radius: 0.8em;
  background: white;
  padding: 0.5em;
  box-shadow: 0 0.7em 1.4em -0.8em rgb(15 23 42 / 0.4);
  opacity: 0;
}

.is-board .card {
  opacity: 1;
}

.card-note {
  border-color: rgb(252 211 77 / 0.9);
  background: #fff7d6;
  color: rgb(120 53 15 / 0.85);
}

.thumb {
  min-height: 0;
  flex: 1;
  border-radius: 0.5em;
}

.thumb-beach {
  background: linear-gradient(180deg, #bae6fd 0%, #7dd3fc 55%, #fde68a 56%, #fcd34d 100%);
}

.thumb-pier {
  background: linear-gradient(160deg, #e0f2fe 0%, #93c5fd 60%, #475569 61%, #334155 100%);
}

.thumb-sunset {
  background:
    radial-gradient(circle at 50% 70%, #fde68a 0 0.9em, transparent 0.95em),
    linear-gradient(180deg, #fb923c 0%, #f472b6 60%, #1e3a5f 61%);
}

.note-lines {
  min-height: 0;
  flex: 1;
  overflow: hidden;
  padding: 0.2em 0.3em 0;
  font-size: 0.95em;
  line-height: 1.5;
}

.page {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  gap: 0.45em;
  padding: 0 0.3em;
}

.page-line {
  height: 0.3em;
  border-radius: 999px;
  background: #e2e8f0;
}

.page-line-short {
  width: 60%;
}

/* The name under a card: the old one leaves, the new one comes */
.cap {
  position: relative;
  height: 1.4em;
  flex-shrink: 0;
  overflow: hidden;
  font-size: 0.85em;
  font-weight: 600;
}

.cap span {
  position: absolute;
  inset: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition:
    opacity 0.3s ease,
    translate 0.3s ease;
}

.cap-new {
  color: var(--color-pc-700);
  opacity: 0;
  translate: 0 70%;
}

.is-named .cap span {
  transition-delay: calc(0.7s + var(--i) * 0.14s);
}

.is-named .cap-raw {
  opacity: 0;
  translate: 0 -70%;
}

.is-named .cap-new {
  opacity: 1;
  translate: 0 0;
}

/* ── The new folders ─────────────────────────────────── */

.folder {
  position: absolute;
  display: flex;
  width: 22%;
  height: 36%;
  flex-direction: column;
  gap: 0.5em;
  box-sizing: border-box;
  border: 1px solid var(--pc-gray-border);
  border-radius: 0.8em;
  background: white;
  padding: 0.6em;
  box-shadow: 0 0.7em 1.4em -0.8em rgb(15 23 42 / 0.4);
  opacity: 0;
  scale: 0.8;
  transition:
    opacity 0.4s ease,
    scale 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.2);
}

.is-sorted .folder {
  opacity: 1;
  scale: 1;
  transition-delay: calc(1.2s + var(--i) * 120ms);
}

.folder-name {
  display: flex;
  align-items: center;
  gap: 0.4em;
  color: #1e293b;
  font-weight: 600;
}

.folder-grid {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 0.35em;
}

.folder-grid .thumb {
  border-radius: 0.35em;
}

.mini-note {
  border: 1px solid rgb(252 211 77 / 0.9);
  border-radius: 0.35em;
  background: #fff7d6;
}

/* ── The AI action at work ───────────────────────────── */

.chip {
  position: absolute;
  bottom: 4.5%;
  left: 50%;
  display: inline-flex;
  align-items: center;
  gap: 0.45em;
  border: 1px solid var(--pc-gray-border);
  border-radius: 999px;
  background: white;
  padding: 0.5em 1em;
  box-shadow: 0 1em 2em -1em rgb(15 23 42 / 0.45);
  color: #1e293b;
  font-weight: 600;
  white-space: nowrap;
  opacity: 0;
  translate: -50% 0.8em;
  transition:
    opacity 0.3s ease,
    translate 0.3s ease;
}

.is-named .chip {
  opacity: 1;
  translate: -50% 0;
}

/* A narrow frame: a taller stage, bigger cards and words */
@media (max-width: 640px) {
  .stage {
    aspect-ratio: 5 / 4;
  }
}

@container (max-width: 520px) {
  .scale {
    font-size: clamp(7.5px, 2.4cqw, 12px);
  }

  .is-board .file {
    width: calc(var(--w) * 1.3);
  }

  .folder {
    width: 28%;
  }
}

/* ── The steps ───────────────────────────────────────── */

.steps {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem 1rem;
  margin: 1.25rem 0 0;
  padding: 0;
  list-style: none;
}

@media (min-width: 640px) {
  .steps {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.step {
  display: flex;
  width: 100%;
  cursor: pointer;
  align-items: baseline;
  gap: 0.5rem;
  border: 0;
  border-top: 2px solid var(--alt-line);
  background: none;
  padding: 0.625rem 0 0;
  color: var(--alt-ink-3);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.35;
  text-align: left;
  transition:
    border-color 0.3s ease,
    color 0.3s ease;
}

.step:hover {
  color: var(--alt-ink);
}

.step.is-done {
  border-top-color: var(--alt-ink);
}

/* Colour only: a heavier weight would rewrap the long labels */
.step.is-on {
  border-top-color: var(--alt-ink);
  color: var(--alt-ink);
}

.step-n {
  font-variant-numeric: tabular-nums;
}

/* Less motion: nothing moves until Play is pressed */
@media (prefers-reduced-motion: reduce) {
  .pile:not(.is-motion) .stage *,
  .pile:not(.is-motion) .scale,
  .pile:not(.is-motion) .scale::before,
  .pile:not(.is-motion) .step {
    transition: none !important;
  }
}
</style>
