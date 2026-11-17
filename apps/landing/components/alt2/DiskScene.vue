<!-- ⑥ The files outlive the app. Beside the app's window stands an ordinary
     file window on the same folder (generic, no OS's own look): the files
     were plain files all along. Delete the app and they are unchanged;
     install it again and the board is back, every card in its place,
     because views and places live in the files' own attributes and drawings
     in the hidden .pile folder (README.md, local.ts). What lives with the
     app on the device (bookmarks, settings, AI keys) is said under the
     scene, not here.
     The steps play on their own while on screen and motion is welcome;
     Play runs them once, also with reduced motion. -->
<script setup lang="ts">
const steps = [
  { label: "Your board", icon: "i-tabler-template" },
  { label: "Delete the app", icon: "i-tabler-trash" },
  { label: "Install it again", icon: "i-tabler-download" },
] as const;

const files = [
  { name: "Harbor morning.jpg", kind: "JPEG image", size: "480 KB", icon: "i-lucide-image", tint: "#0ea5e9" },
  { name: "Lemon tea.jpg", kind: "JPEG image", size: "210 KB", icon: "i-lucide-image", tint: "#0ea5e9" },
  { name: "Mood.md", kind: "Markdown", size: "2 KB", icon: "i-lucide-file-text", tint: "#d97706" },
  { name: "Pink blossom.jpg", kind: "JPEG image", size: "390 KB", icon: "i-lucide-image", tint: "#0ea5e9" },
  { name: "References", kind: "Folder", size: "—", icon: "i-lucide-folder", tint: "#378add" },
];

const step = ref(0);
const touched = ref(false);
const playing = ref(false);

const tabs = useTemplateRef<HTMLButtonElement[]>("tabs");
const root = useTemplateRef<HTMLElement>("root");

let timers: ReturnType<typeof setTimeout>[] = [];

function clear() {
  for (const t of timers) clearTimeout(t);
  timers = [];
}

function pick(i: number) {
  clear();
  touched.value = true;
  playing.value = false;
  step.value = i;
}

function play() {
  clear();
  touched.value = true;
  playing.value = true;
  step.value = 0;
  timers.push(setTimeout(() => (step.value = 1), 2600));
  timers.push(setTimeout(() => (step.value = 2), 5800));
  timers.push(setTimeout(() => (playing.value = false), 8000));
}

function onKey(event: KeyboardEvent) {
  const last = steps.length - 1;
  const to
    = event.key === "ArrowRight" ? (step.value === last ? 0 : step.value + 1)
      : event.key === "ArrowLeft" ? (step.value === 0 ? last : step.value - 1)
        : event.key === "Home" ? 0
          : event.key === "End" ? last
            : -1;
  if (to < 0) return;
  event.preventDefault();
  pick(to);
  nextTick(() => tabs.value?.[to]?.focus());
}

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
  const timer = window.setInterval(() => {
    if (visible && !touched.value) step.value = (step.value + 1) % steps.length;
  }, 3200);
  onUnmounted(() => {
    observer.disconnect();
    window.clearInterval(timer);
    clear();
  });
});
</script>

<template>
  <div ref="root">
    <div class="controls">
      <div class="tabs-scroll">
        <div role="tablist" aria-label="What happens when the app is deleted" class="tabs" @keydown="onKey">
          <button
            v-for="(s, i) in steps"
            :id="`a2-disk-tab-${i}`"
            :key="s.label"
            ref="tabs"
            type="button"
            role="tab"
            :aria-selected="step === i"
            :tabindex="step === i ? 0 : -1"
            aria-controls="a2-disk-stage"
            class="tab"
            :class="{ 'is-on': step === i }"
            @click="pick(i)"
          >
            <UIcon :name="s.icon" class="size-4" />
            {{ s.label }}
          </button>
        </div>
      </div>
      <button type="button" class="play" :aria-pressed="playing" @click="play">
        <UIcon name="i-lucide-play" class="size-4" />
        Play
      </button>
    </div>

    <div
      id="a2-disk-stage"
      role="tabpanel"
      :aria-labelledby="`a2-disk-tab-${step}`"
      class="a2-frame stage"
      :class="[`at-${step}`, { playing }]"
    >
      <div class="pair" aria-hidden="true">
        <!-- The app, or the place where it was -->
        <div class="slot">
          <p class="slot-label">{{ step === 1 ? "Pile Commander: deleted" : "Pile Commander" }}</p>
          <div class="slot-box">
            <div class="win app">
              <div class="fh">
                <div class="where">
                  <span class="crumbs"><UIcon name="i-tabler-home" class="ic-s" /><UIcon name="i-tabler-chevron-right" class="ic-s" />Pictures</span>
                  <span class="title">Harbor moodboard</span>
                </div>
                <span class="viewbtn"><UIcon name="i-tabler-template" class="ic v-board" /></span>
              </div>
              <div class="board">
                <img src="/landing-alt2/sea-horizon.jpg" alt="" class="card c-sea" width="520" height="346">
                <img src="/landing-alt2/lemon-tea.jpg" alt="" class="card c-tea" width="416" height="520">
                <img src="/landing-alt2/pink-blossom.jpg" alt="" class="card c-blossom" width="416" height="520">
                <div class="card c-note"><p>Warm light, salty air. One object on the table.</p><span>Mood.md</span></div>
              </div>
              <p class="back"><UIcon name="i-tabler-circle-check" class="ic-s" />Every card where you left it</p>
            </div>

            <div class="gone">
              <span class="bin"><UIcon name="i-tabler-trash" class="ic-l" /></span>
              <img src="/app-icon.png" alt="" class="app-icon" width="64" height="64">
            </div>
          </div>
        </div>

        <!-- An ordinary file window on the same folder -->
        <div class="slot">
          <p class="slot-label">Any file manager</p>
          <div class="win os">
            <div class="os-bar">
              <span class="dots"><i /><i /><i /></span>
              <span class="os-title"><UIcon name="i-lucide-folder" class="ic-s" />Harbor moodboard</span>
            </div>
            <p class="os-path">~/Pictures/Harbor moodboard</p>
            <div class="os-head"><span>Name</span><span>Kind</span><span>Size</span></div>
            <ul class="os-list">
              <li v-for="file in files" :key="file.name">
                <span class="nm"><UIcon :name="file.icon" class="ic-s" :style="{ color: file.tint }" />{{ file.name }}</span>
                <span class="k">{{ file.kind }}</span>
                <span class="sz">{{ file.size }}</span>
              </li>
              <li class="hidden">
                <span class="nm"><UIcon name="i-lucide-folder" class="ic-s" />.pile</span>
                <span class="k">Hidden folder</span>
                <span class="sz">8 KB</span>
              </li>
            </ul>
            <p class="os-note">
              <span class="still"><UIcon name="i-tabler-circle-check" class="ic-s" />Nothing changed</span>
              Views and places travel in the files' own attributes; drawings in .pile.
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Steps and Play ──────────────────────────────────── */

.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1.5rem;
  margin-bottom: 1.5rem;
}

.tabs-scroll {
  margin: 0 calc(-1 * var(--a2-gutter));
  overflow-x: auto;
  padding: 0 var(--a2-gutter) 0.25rem;
  scrollbar-width: none;
}

.tabs {
  display: inline-flex;
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
  padding: 0 1rem;
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

.play {
  display: inline-flex;
  height: 2.25rem;
  cursor: pointer;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid var(--a2-line);
  border-radius: 999px;
  background: var(--a2-surface);
  padding: 0 0.9rem 0 0.75rem;
  color: var(--a2-ink);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 600;
}

.play:hover {
  border-color: var(--a2-ink-3);
}

/* ── The stage ───────────────────────────────────────── */

.stage {
  container-type: inline-size;
  background: #f0f0ee;
}

.pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1.25em;
  padding: 1.25em;
  color: #1f1f1e;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 12px;
  line-height: 1.35;
}

@container (min-width: 760px) {
  .pair {
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    gap: 1.6em;
    padding: 1.75em;
    font-size: 13px;
  }
}

.pair p {
  margin: 0;
}

.slot {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.6em;
}

.slot-label {
  color: #9a9893;
  font-size: 0.85em;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.slot-box {
  position: relative;
  flex: 1;
}

.win {
  overflow: hidden;
  border: 1px solid rgb(0 0 0 / 0.08);
  border-radius: 0.8em;
  background: #fff;
  box-shadow: 0 0.8em 1.6em -1.1em rgb(15 23 42 / 0.35);
}

.ic {
  width: 1.3em;
  height: 1.3em;
  flex: none;
}

.ic-s {
  width: 1.1em;
  height: 1.1em;
  flex: none;
}

.ic-l {
  width: 2.2em;
  height: 2.2em;
}

.ic.v-board {
  color: #534ab7;
}

/* ── The app's window ────────────────────────────────── */

.app {
  transition:
    opacity 0.45s ease,
    scale 0.5s cubic-bezier(0.2, 0.8, 0.2, 1),
    filter 0.45s ease;
  transform-origin: 80% 100%;
}

.at-1 .app {
  opacity: 0;
  scale: 0.6;
  filter: blur(2px);
}

.fh {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1em;
  border-bottom: 1px solid rgb(0 0 0 / 0.08);
  padding: 0.7em 0.9em 0.75em;
}

.where {
  display: grid;
  min-width: 0;
  gap: 0.15em;
}

.crumbs {
  display: inline-flex;
  align-items: center;
  gap: 0.25em;
  color: #9a9893;
  font-size: 0.9em;
}

.title {
  font-size: 1.2em;
  font-weight: 600;
}

.viewbtn {
  display: grid;
  width: 2.1em;
  height: 2.1em;
  place-items: center;
  border-radius: 0.45em;
  background: #f0f0ee;
}

.board {
  position: relative;
  aspect-ratio: 16 / 8.5;
  overflow: hidden;
  background: #ebe9e6;
}

.card {
  position: absolute;
  object-fit: cover;
}

.c-sea {
  top: 8%;
  left: 5%;
  width: 38%;
  aspect-ratio: 520 / 346;
}

.c-tea {
  top: 6%;
  left: 47%;
  width: 18%;
  aspect-ratio: 4 / 5;
}

.c-blossom {
  top: 14%;
  left: 69%;
  width: 18%;
  aspect-ratio: 4 / 5;
}

.c-note {
  top: 60%;
  left: 5%;
  width: 30%;
  box-sizing: border-box;
  border: 1px solid rgb(0 0 0 / 0.08);
  background: #fff;
  padding: 0.6em 0.7em;
}

.c-note p {
  font-size: 0.95em;
}

.c-note span {
  display: block;
  margin-top: 0.4em;
  color: #9a9893;
  font-size: 0.8em;
}

.back {
  display: flex;
  align-items: center;
  gap: 0.4em;
  border-top: 1px solid rgb(0 0 0 / 0.06);
  padding: 0.6em 0.9em;
  color: #3b6d11;
  font-weight: 500;
  opacity: 0;
  transition: opacity 0.4s ease 0.2s;
}

.at-2 .back {
  opacity: 1;
}

/* Where the app was: an outline and the bin */
.gone {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 0.8em;
  border: 1.5px dashed #cfcdc8;
  border-radius: 0.8em;
  color: #9a9893;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.4s ease;
}

.at-1 .gone {
  opacity: 1;
}

.bin {
  display: grid;
  width: 4em;
  height: 4em;
  place-items: center;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.08);
}

.app-icon {
  width: 2.6em;
  height: 2.6em;
  border-radius: 0.6em;
  opacity: 0.55;
  filter: grayscale(1);
}

/* ── The ordinary file window ────────────────────────── */

.os-bar {
  display: flex;
  align-items: center;
  gap: 0.8em;
  border-bottom: 1px solid rgb(0 0 0 / 0.08);
  background: #f4f4f2;
  padding: 0.6em 0.8em;
}

.dots {
  display: inline-flex;
  gap: 0.35em;
}

.dots i {
  width: 0.7em;
  height: 0.7em;
  border-radius: 999px;
  background: #d6d4cf;
}

.os-title {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  font-weight: 600;
}

.os-path {
  border-bottom: 1px solid rgb(0 0 0 / 0.06);
  padding: 0.5em 0.9em;
  color: #9a9893;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85em !important;
}

.os-head,
.os-list li {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) 4.5em;
  gap: 0.6em;
  padding: 0.45em 0.9em;
}

.os-head {
  border-bottom: 1px solid rgb(0 0 0 / 0.06);
  color: #9a9893;
  font-size: 0.85em;
}

.os-list {
  margin: 0;
  padding: 0.2em 0;
  list-style: none;
}

.os-list li:nth-child(odd) {
  background: #fafaf9;
}

.nm {
  display: inline-flex;
  min-width: 0;
  overflow: hidden;
  align-items: center;
  gap: 0.45em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.k,
.sz {
  overflow: hidden;
  color: #5f5e5a;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sz {
  text-align: right;
}

.os-list .hidden {
  color: #9a9893;
}

.os-list .hidden .k,
.os-list .hidden .sz {
  color: #b5b3ad;
}

.os-note {
  display: grid;
  gap: 0.3em;
  border-top: 1px solid rgb(0 0 0 / 0.06);
  padding: 0.65em 0.9em 0.75em;
  color: #5f5e5a;
  font-size: 0.92em !important;
}

.still {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  color: #3b6d11;
  font-weight: 600;
  opacity: 0.35;
  transition: opacity 0.4s ease;
}

.at-1 .still {
  opacity: 1;
}

/* With reduced motion the steps switch at once, unless Play was pressed */
@media (prefers-reduced-motion: reduce) {
  .stage:not(.playing) * {
    transition-duration: 0ms !important;
    transition-delay: 0ms !important;
  }
}
</style>
