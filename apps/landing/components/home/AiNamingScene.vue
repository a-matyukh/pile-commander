<!-- AI tools as they ship: files picked on the board get names from a model
     (a was → now list to accept), then the board gets a summary. Generate
     ideas and Sort into folders are chips marked Soon.
     SSR, no-JS and reduced motion get the finished frame. -->
<script setup lang="ts">
const files = [
  { key: "harbor", kind: "photo", was: "IMG_4823.jpg", now: "Harbor at noon.jpg" },
  { key: "mood", kind: "note", was: "Note 3.md", now: "Warm light.md" },
  { key: "lighthouse", kind: "lighthouse", was: "IMG_4824.jpg", now: "Lighthouse close-up.jpg" },
  { key: "rope", kind: "palette", was: "IMG_4831.jpg", now: "Rope and rust.jpg" },
] as const;

const palette = ["#b45309", "#e7d3b0", "#0e7490", "#1e3a5f"];

const summary = [
  "Quiet harbor scenes in warm noon light",
  "A red-and-white lighthouse, up close",
  "Palette: rust, sand, teal and navy",
];

type Panel = "none" | "names" | "summary";

const root = ref<HTMLElement>();
// The finished frame; the loop rewinds it on the client.
const selected = ref(false);
const panel = ref<Panel>("names");
const answered = ref(files.length);
const applying = ref(false);
const renamed = ref(true);
const lines = ref(0);
const adding = ref(false);
const fading = ref(false);

let timers: ReturnType<typeof setTimeout>[] = [];
let observer: IntersectionObserver | undefined;
let running = false;

function at(ms: number, fn: () => void) {
  timers.push(setTimeout(fn, ms));
}

function stop() {
  running = false;
  for (const t of timers) clearTimeout(t);
  timers = [];
}

function cycle() {
  selected.value = false;
  panel.value = "none";
  answered.value = 0;
  applying.value = false;
  renamed.value = false;
  lines.value = 0;
  adding.value = false;
  fading.value = false;

  // Pick the files, ask for names.
  at(700, () => (selected.value = true));
  at(1500, () => (panel.value = "names"));
  const asked = 2100;
  files.forEach((_, i) => at(asked + i * 550, () => (answered.value = i + 1)));

  // Accept: the cards take the new names.
  const accept = asked + files.length * 550 + 900;
  at(accept, () => (applying.value = true));
  at(accept + 450, () => {
    panel.value = "none";
    applying.value = false;
    renamed.value = true;
    selected.value = false;
  });

  // Summarize the board.
  const summarize = accept + 2000;
  at(summarize, () => (panel.value = "summary"));
  summary.forEach((_, i) => at(summarize + 900 + i * 700, () => (lines.value = i + 1)));
  const add = summarize + 900 + summary.length * 700 + 900;
  at(add, () => (adding.value = true));
  at(add + 450, () => {
    panel.value = "none";
    adding.value = false;
  });

  at(add + 2600, () => (fading.value = true));
  at(add + 3400, cycle);
}

function start() {
  if (running) return;
  running = true;
  cycle();
}

onMounted(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  observer = new IntersectionObserver(([entry]) => {
    if (entry?.isIntersecting) start();
    else stop();
  });
  if (root.value) observer.observe(root.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  stop();
});
</script>

<template>
  <div
    ref="root"
    class="ai"
    :class="{ 'is-selected': selected, 'is-renamed': renamed, 'is-fading': fading }"
    aria-hidden="true"
  >
    <p class="folder">
      <UIcon name="i-lucide-folder" class="size-[1.15em] text-pc-600" />
      Harbor moodboard
    </p>

    <ul class="actions">
      <li class="action" :class="{ 'is-on': panel === 'names' }">
        <UIcon name="i-lucide-sparkles" class="size-[1em]" />
        Name files
      </li>
      <li class="action" :class="{ 'is-on': panel === 'summary' }">
        <UIcon name="i-lucide-sparkles" class="size-[1em]" />
        Summarize
      </li>
      <li class="action action-soon">Generate ideas <span class="soon">Soon</span></li>
      <li class="action action-soon">Sort into folders <span class="soon">Soon</span></li>
    </ul>

    <article
      v-for="(file, i) in files"
      :key="file.key"
      class="file"
      :class="`file-${file.key}`"
      :style="{ '--i': i }"
    >
      <div v-if="file.kind === 'photo'" class="thumb thumb-harbor" />
      <template v-else-if="file.kind === 'note'">
        <p class="note-title">Mood</p>
        <p class="note-copy">warm light<br />quiet room</p>
      </template>
      <div v-else-if="file.kind === 'lighthouse'" class="thumb thumb-lighthouse">
        <span class="tower" />
      </div>
      <div v-else class="swatches">
        <span v-for="color in palette" :key="color" class="swatch" :style="{ background: color }" />
      </div>

      <p class="file-name">
        <span class="name-was">{{ file.was }}</span>
        <span class="name-now">{{ file.now }}</span>
      </p>
    </article>

    <!-- The dialog: names to review, then the summary preview -->
    <div class="panel" :class="{ 'is-open': panel !== 'none' }">
      <div class="panel-head">
        <p class="panel-title">{{ panel === "summary" ? "Summarize “Harbor moodboard”" : "Suggest names" }}</p>
        <span class="reach">
          <UIcon name="i-lucide-lock" class="size-[1em]" />
          This computer
        </span>
      </div>

      <ul v-if="panel !== 'summary'" class="rows">
        <li
          v-for="(file, i) in files"
          :key="file.key"
          class="row"
          :class="[`row-${file.key}`, { 'is-answered': i < answered }]"
        >
          <span class="check">
            <UIcon name="i-lucide-check" class="size-[0.8em]" />
          </span>
          <span class="row-was">{{ file.was }}</span>
          <UIcon name="i-lucide-arrow-right" class="size-[1em] shrink-0 text-slate-400" />
          <span class="row-now">
            <span v-if="i < answered">{{ file.now }}</span>
            <span v-else class="skel" />
          </span>
        </li>
      </ul>

      <div v-else class="summary">
        <p class="summary-title">A quiet harbor</p>
        <ul class="summary-list">
          <li v-for="(line, i) in summary" :key="line" :class="{ 'is-shown': i < lines }">{{ line }}</li>
        </ul>
      </div>

      <div class="panel-foot">
        <span class="button" :class="{ 'is-pressed': applying || adding }">
          {{ panel === "summary" ? "Add to board" : "Rename" }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ai {
  position: relative;
  height: 100%;
  container-type: inline-size;
  overflow: hidden;
  font-size: clamp(8px, 1.5cqw, 14px);
  color: #334155;
  background-color: hsl(213 40% 96.5%);
  background-image: radial-gradient(hsl(215 25% 80%) 1px, transparent 1px);
  background-size: 1.6em 1.6em;
  transition: opacity 0.6s ease;
}

.ai.is-fading {
  opacity: 0.35;
}

p {
  margin: 0;
}

.folder {
  position: absolute;
  top: 6%;
  left: 4%;
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  border: 1px solid var(--pc-gray-border);
  border-radius: 0.6em;
  background: white;
  padding: 0.35em 0.7em;
  font-weight: 600;
  color: #475569;
}

/* ── Actions ─────────────────────────────────────────── */

.actions {
  position: absolute;
  top: 6%;
  right: 4%;
  display: flex;
  gap: 0.45em;
  margin: 0;
  padding: 0;
  list-style: none;
  white-space: nowrap;
}

.action {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  border: 1px solid var(--color-pc-200);
  border-radius: 999px;
  background: white;
  padding: 0.3em 0.75em;
  font-weight: 600;
  color: var(--color-pc-700);
  transition:
    background-color 0.25s ease,
    color 0.25s ease,
    border-color 0.25s ease;
}

.action.is-on {
  border-color: var(--color-pc-500);
  background: var(--color-pc-500);
  color: white;
}

.action-soon {
  border-color: var(--pc-gray-border);
  background: rgb(255 255 255 / 0.7);
  color: #94a3b8;
}

.soon {
  border-radius: 999px;
  background: hsl(213 40% 93%);
  padding: 0.05em 0.45em;
  font-size: 0.75em;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #64748b;
}

/* ── Files ───────────────────────────────────────────── */

.file {
  position: absolute;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--pc-gray-border);
  border-radius: 0.85em;
  background: white;
  padding: 0.5em;
  box-shadow: 0 0.7em 1.4em -0.8em rgb(15 23 42 / 0.4);
  transition:
    box-shadow 0.3s ease,
    border-color 0.3s ease;
  transition-delay: calc(var(--i) * 70ms);
}

.is-selected .file {
  border-color: var(--color-pc-500);
  box-shadow:
    0 0 0 0.25em rgb(33 130 248 / 0.18),
    0 0.7em 1.4em -0.8em rgb(15 23 42 / 0.4);
}

.file-harbor {
  top: 20%;
  left: 4%;
  width: 19%;
  height: 40%;
  rotate: -1.5deg;
}

.file-mood {
  top: 21%;
  left: 26%;
  width: 17%;
  border-color: rgb(252 211 77 / 0.9);
  background: #fff7d6;
  padding: 0.6em 0.75em 0.5em;
  rotate: 2deg;
}

.file-lighthouse {
  top: 17%;
  left: 47%;
  width: 21%;
  rotate: 1deg;
}

.file-rope {
  top: 22%;
  left: 72%;
  width: 22%;
  rotate: -1deg;
}

.thumb {
  flex: 1;
  min-height: 0;
  border-radius: 0.5em;
}

.thumb-harbor {
  background:
    radial-gradient(circle at 76% 26%, #fde68a 0 0.7em, transparent 0.75em),
    linear-gradient(160deg, #bae6fd 0%, #7dd3fc 40%, #2182f8 100%);
}

.thumb-lighthouse {
  position: relative;
  flex: none;
  height: 7.5em;
  overflow: hidden;
  background: linear-gradient(180deg, #fde4cf 0%, #fbc4ab 52%, #7dd3fc 53%, #2182f8 100%);
}

.tower {
  position: absolute;
  bottom: 38%;
  left: 38%;
  width: 1.1em;
  height: 3.3em;
  border-radius: 0.2em 0.2em 0 0;
  background: repeating-linear-gradient(180deg, #ef4444 0 0.55em, #fff 0.55em 1.1em);
}

.tower::before {
  content: "";
  position: absolute;
  bottom: 100%;
  left: 50%;
  width: 1.5em;
  height: 0.7em;
  translate: -50% 0;
  border-radius: 0.3em 0.3em 0 0;
  background: #334155;
}

.note-title {
  font-weight: 700;
  color: rgb(120 53 15 / 0.85);
}

.note-copy {
  margin-top: 0.2em;
  color: rgb(120 53 15 / 0.65);
  line-height: 1.35;
}

.swatches {
  display: flex;
  gap: 0.35em;
  padding: 0.4em 0.2em 0.1em;
}

.swatch {
  width: 1.7em;
  height: 1.7em;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px rgb(15 23 42 / 0.08);
}

/* The old and new names share one line; the new one fades in over it. */
.file-name {
  display: grid;
  margin: 0.45em 0.15em 0.05em;
  font-weight: 700;
  color: #1e293b;
}

.file-mood .file-name {
  margin-top: 0.5em;
  color: rgb(120 53 15 / 0.9);
}

.name-was,
.name-now {
  grid-area: 1 / 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: opacity 0.35s ease;
  transition-delay: calc(var(--i) * 90ms);
}

.name-was {
  color: #64748b;
  font-weight: 600;
}

.name-now,
.is-renamed .name-was {
  opacity: 0;
}

.is-renamed .name-now {
  opacity: 1;
}

/* ── Dialog ──────────────────────────────────────────── */

.panel {
  position: absolute;
  bottom: 5%;
  left: 50%;
  width: 60%;
  border: 1px solid var(--pc-gray-border);
  border-radius: 1em;
  background: white;
  padding: 0.8em 1em 0.75em;
  box-shadow: 0 1.2em 2.4em -1em rgb(15 23 42 / 0.4);
  opacity: 0;
  translate: -50% 1.2em;
  transition:
    opacity 0.35s ease,
    translate 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.1);
}

.panel.is-open {
  opacity: 1;
  translate: -50% 0;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6em;
}

.panel-title {
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #1e293b;
}

.reach {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.3em;
  border-radius: 999px;
  background: #ecfdf5;
  padding: 0.15em 0.55em;
  font-size: 0.8em;
  font-weight: 700;
  color: #047857;
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 0.3em;
  margin: 0.6em 0 0;
  padding: 0;
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  gap: 0.55em;
  min-height: 1.6em;
}

.check {
  display: grid;
  width: 1.15em;
  height: 1.15em;
  flex-shrink: 0;
  place-items: center;
  border: 1px solid var(--pc-gray-border);
  border-radius: 0.3em;
  color: white;
  transition:
    background-color 0.25s ease,
    border-color 0.25s ease;
}

.row.is-answered .check {
  border-color: var(--color-pc-500);
  background: var(--color-pc-500);
}

.row-was {
  width: 9em;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #64748b;
}

.row-now {
  display: flex;
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-weight: 600;
  white-space: nowrap;
  color: #1e293b;
}

.skel {
  display: block;
  width: 9em;
  height: 0.85em;
  border-radius: 0.35em;
  background: linear-gradient(90deg, hsl(213 40% 93%) 0%, hsl(213 60% 97%) 50%, hsl(213 40% 93%) 100%);
  background-size: 200% 100%;
}

.summary {
  margin-top: 0.6em;
}

.summary-title {
  font-weight: 700;
  color: #1e293b;
}

.summary-list {
  display: flex;
  flex-direction: column;
  gap: 0.25em;
  margin: 0.35em 0 0;
  padding: 0 0 0 1.2em;
  min-height: 5em;
}

.summary-list li {
  opacity: 0;
  transition: opacity 0.3s ease;
}

.summary-list li.is-shown {
  opacity: 1;
}

.panel-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.6em;
}

.button {
  border-radius: 0.5em;
  background: var(--color-pc-500);
  padding: 0.3em 0.85em;
  font-weight: 600;
  color: white;
  transition:
    scale 0.15s ease,
    background-color 0.15s ease;
}

.button.is-pressed {
  scale: 0.94;
  background: var(--color-pc-700);
}

/* Narrow cards: fewer things, same story. */
@container (max-width: 520px) {
  .action-soon,
  .file-rope,
  .row-rope {
    display: none;
  }

  .actions {
    font-size: 0.9em;
  }

  .file-harbor {
    top: 22%;
    width: 24%;
    height: 34%;
  }

  .file-mood {
    top: 22%;
    left: 33%;
    width: 25%;
  }

  .file-lighthouse {
    top: 19%;
    left: 66%;
    width: 30%;
  }

  .thumb-lighthouse {
    height: 4.5em;
  }

  .panel {
    width: 88%;
  }

  .row-was {
    width: 7.5em;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .skel {
    animation: ai-shimmer 1.2s linear infinite;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ai,
  .file,
  .name-was,
  .name-now,
  .panel,
  .summary-list li {
    transition: none;
  }
}

@keyframes ai-shimmer {
  to {
    background-position: -200% 0;
  }
}
</style>
