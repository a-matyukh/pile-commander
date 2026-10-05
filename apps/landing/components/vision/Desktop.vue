<!-- A Linux desktop where the desktop itself is the board: files lie on it,
     workspaces in the panel are piles, and a folder opens as a tiled window
     next to a terminal listing the same files. Then Super+2 moves to the
     next pile. SSR, no-JS and reduced motion get the frame with both tiles open. -->
<script setup lang="ts">
type Desk = "research" | "harbor";
type CursorAt = "rest" | "folder" | "away";

const COMMAND = "ls ~/Research/References";

const root = ref<HTMLElement>();
// The settled frame; the loop rewinds it on the client.
const desk = ref<Desk>("research");
const windowOpen = ref(true);
const terminalOpen = ref(true);
const typed = ref(COMMAND);
const output = ref(true);
const cursorShown = ref(false);
const cursorAt = ref<CursorAt>("rest");
const clicked = ref(false);
const hint = ref(false);
const fading = ref(false);
const snap = ref(false);

const workspaces = [
  { key: "research", label: "Research" },
  { key: "harbor", label: "Harbor" },
  { key: "inbox", label: "Inbox" },
] as const;

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
  // Jump back to the empty Research desk without animating the reset.
  snap.value = true;
  desk.value = "research";
  windowOpen.value = false;
  terminalOpen.value = false;
  typed.value = "";
  output.value = false;
  cursorShown.value = true;
  cursorAt.value = "rest";
  clicked.value = false;
  hint.value = false;
  at(60, () => {
    snap.value = false;
    fading.value = false;
  });

  // Open the folder: double-click, the window grows out of the card.
  at(800, () => (cursorAt.value = "folder"));
  at(1800, () => (clicked.value = true));
  at(2050, () => (clicked.value = false));
  at(2100, () => (windowOpen.value = true));
  at(2400, () => (cursorAt.value = "away"));

  // The terminal lists the same files.
  at(3000, () => (terminalOpen.value = true));
  const typeStart = 3300;
  for (let i = 1; i <= COMMAND.length; i++) {
    at(typeStart + i * 40, () => (typed.value = COMMAND.slice(0, i)));
  }
  at(typeStart + COMMAND.length * 40 + 200, () => (output.value = true));

  // Super+2: the next pile.
  at(5600, () => {
    hint.value = true;
    cursorShown.value = false;
  });
  at(6200, () => (desk.value = "harbor"));
  at(8800, () => (hint.value = false));
  at(9400, () => (fading.value = true));
  at(9900, cycle);
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
    class="desk"
    :class="[`on-${desk}`, { 'is-snap': snap, 'is-fading': fading }]"
    aria-hidden="true"
  >
    <!-- Top panel: the workspaces are piles -->
    <div class="panel">
      <img src="/app-icon.png" alt="" class="logo" />
      <ul class="workspaces">
        <li
          v-for="ws in workspaces"
          :key="ws.key"
          class="ws"
          :class="{ active: ws.key === desk }"
        >
          <span class="ws-dot" />
          <span class="ws-name">{{ ws.label }}</span>
        </li>
      </ul>
      <span class="tray">
        <UIcon name="i-lucide-wifi" class="tray-icon size-[1em]" />
        <UIcon name="i-lucide-battery-medium" class="tray-icon size-[1.15em]" />
        <span class="clock">9:41</span>
      </span>
    </div>

    <div class="stage">
      <!-- Workspace "Research": the desktop is the board -->
      <div class="surface surface-research">
        <div class="item note">
          <p class="item-title">Mood</p>
          <p class="item-copy">warm light<br />quiet room</p>
        </div>

        <div class="item photo">
          <div class="thumb" />
          <p class="item-title">Harbor</p>
        </div>

        <div class="item folder" :class="{ 'is-clicked': clicked }">
          <p class="folder-head">
            <UIcon name="i-lucide-folder" class="size-[1.15em] shrink-0 text-pc-600" />
            <span class="item-title">References</span>
          </p>
          <span class="minis"><i class="mini-photo" /><i class="mini-note" /><i class="mini-pier" /></span>
        </div>

        <div class="item sketch">
          <div class="thumb thumb-sketch" />
          <p class="item-title">Sketch</p>
        </div>

        <!-- Tiled windows -->
        <div class="tile tile-window" :class="{ open: windowOpen }">
          <div class="tile-bar">
            <UIcon name="i-lucide-folder-open" class="size-[1em] shrink-0 text-pc-600" />
            References
          </div>
          <div class="tile-board">
            <i class="mini-photo" />
            <i class="mini-note" />
            <i class="mini-pier" />
            <i class="mini-pdf"><UIcon name="i-lucide-file-text" class="size-[1.1em]" /></i>
            <i class="mini-palette"><b /><b /><b /></i>
          </div>
        </div>

        <div class="tile tile-term" :class="{ open: terminalOpen }">
          <div class="tile-bar tile-bar-dark">
            <UIcon name="i-lucide-terminal" class="size-[1em] shrink-0" />
            terminal
          </div>
          <div class="term">
            <p>
              <span class="prompt">~ $</span> {{ typed }}<span v-if="terminalOpen && !output" class="caret" />
            </p>
            <p class="term-out" :class="{ shown: output }">
              harbor-01.jpg&nbsp; pier.jpg<span class="term-extra">&nbsp; notes.md&nbsp; palette.pdf</span>
            </p>
          </div>
        </div>
      </div>

      <!-- Workspace "Harbor": another pile -->
      <div class="surface surface-harbor">
        <div class="item idea idea-fog">
          <p class="item-title">Fog at dawn</p>
          <p class="item-copy item-copy-muted">Shoot the pier before sunrise.</p>
        </div>
        <div class="item idea idea-lighthouse">
          <div class="thumb thumb-lighthouse"><span class="tower" /></div>
          <p class="item-title">Lighthouse close-up</p>
        </div>
        <div class="item idea idea-palette">
          <span class="swatches">
            <b style="background: #b45309" /><b style="background: #e7d3b0" /><b style="background: #0e7490" /><b
              style="background: #1e3a5f"
            />
          </span>
          <p class="item-title">Rope &amp; rust</p>
        </div>
        <div class="item harbor-photo">
          <div class="thumb" />
          <p class="item-title">Harbor morning</p>
        </div>
        <div class="item note shot-list">
          <p class="item-title">Shot list</p>
          <p class="item-copy">pier · ropes<br />lighthouse at 6am</p>
        </div>
      </div>

      <svg class="cursor" :class="[`cursor-${cursorAt}`, { shown: cursorShown }]" viewBox="0 0 16 20">
        <path d="M1 1 L1 16 L5 12 L8 19 L10.5 18 L7.6 11.2 L13 11.2 Z" />
      </svg>

      <p class="keys" :class="{ shown: hint }">
        <kbd>Super</kbd>
        <span>+</span>
        <kbd>2</kbd>
        <span class="keys-label">next pile</span>
      </p>
    </div>
  </div>
</template>

<style scoped>
.desk {
  position: relative;
  height: 100%;
  container-type: inline-size;
  overflow: hidden;
  font-size: clamp(8px, 1.45cqw, 14px);
  color: #334155;
  background:
    radial-gradient(circle at 18% 0%, rgb(255 255 255 / 0.7), transparent 36%),
    linear-gradient(165deg, #d7e6f6 0%, #b9d0ea 46%, #8eafd0 100%);
}

p {
  margin: 0;
}

/* ── Panel ───────────────────────────────────────────── */

.panel {
  position: absolute;
  z-index: 3;
  top: 0;
  right: 0;
  left: 0;
  display: flex;
  height: 8.5%;
  align-items: center;
  justify-content: space-between;
  gap: 1em;
  border-bottom: 1px solid rgb(255 255 255 / 0.7);
  background: rgb(255 255 255 / 0.72);
  padding: 0 1.5%;
  backdrop-filter: blur(8px);
}

.logo {
  width: 1.5em;
  height: 1.5em;
  border-radius: 0.35em;
}

.workspaces {
  display: flex;
  gap: 0.35em;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ws {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  border-radius: 999px;
  padding: 0.2em 0.7em;
  font-weight: 600;
  color: #64748b;
  transition:
    background-color 0.35s ease,
    color 0.35s ease;
}

.ws-dot {
  width: 0.5em;
  height: 0.5em;
  border: 1.5px solid currentColor;
  border-radius: 50%;
  transition: background-color 0.35s ease;
}

.ws.active {
  background: var(--color-pc-500);
  color: white;
}

.ws.active .ws-dot {
  background: white;
  border-color: white;
}

.tray {
  display: inline-flex;
  align-items: center;
  gap: 0.55em;
  color: #475569;
}

.clock {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #1e293b;
}

/* ── Stage & workspaces ──────────────────────────────── */

.stage {
  position: absolute;
  top: 8.5%;
  right: 0;
  bottom: 0;
  left: 0;
  transition: opacity 0.45s ease;
}

.is-fading .stage {
  opacity: 0;
}

.surface {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(rgb(255 255 255 / 0.55) 1px, transparent 1px);
  background-size: 1.6em 1.6em;
  transition: translate 0.8s cubic-bezier(0.65, 0, 0.35, 1);
}

.surface-harbor {
  translate: 100% 0;
}

.on-harbor .surface-research {
  translate: -100% 0;
}

.on-harbor .surface-harbor {
  translate: 0 0;
}

.is-snap .surface,
.is-snap .tile,
.is-snap .cursor,
.is-snap .ws,
.is-snap .term-out,
.is-snap .stage {
  transition: none;
}

/* ── Items on the desktop ────────────────────────────── */

.item {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 0.35em;
  border: 1px solid rgb(255 255 255 / 0.9);
  border-radius: 0.75em;
  background: white;
  padding: 0.5em;
  box-shadow: 0 0.8em 1.6em -0.9em rgb(15 23 42 / 0.55);
}

.item-title {
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #1e293b;
}

.item-copy {
  line-height: 1.35;
  color: rgb(120 53 15 / 0.7);
}

.item-copy-muted {
  color: #64748b;
}

.note {
  top: 9%;
  left: 5%;
  width: 17%;
  border-color: rgb(252 211 77 / 0.9);
  background: #fff7d6;
  padding: 0.6em 0.75em;
  rotate: -2deg;
}

.note .item-title {
  color: rgb(120 53 15 / 0.9);
}

.photo {
  top: 7%;
  left: 26%;
  width: 19%;
  height: 43%;
  rotate: 1.5deg;
}

.thumb {
  flex: 1;
  min-height: 0;
  border-radius: 0.45em;
  background:
    radial-gradient(circle at 76% 28%, #fde68a 0 0.6em, transparent 0.65em),
    linear-gradient(160deg, #bae6fd 0%, #7dd3fc 40%, #2182f8 100%);
}

.thumb-sketch {
  background:
    repeating-linear-gradient(135deg, transparent 0 0.4em, rgb(100 116 139 / 0.28) 0.4em 0.5em),
    hsl(40 60% 97%);
}

.folder {
  top: 53%;
  left: 6%;
  width: 21%;
  transition: scale 0.2s ease;
}

.folder.is-clicked {
  scale: 0.94;
  box-shadow:
    0 0 0 0.25em rgb(33 130 248 / 0.45),
    0 0.8em 1.6em -0.9em rgb(15 23 42 / 0.55);
}

.folder-head {
  display: flex;
  align-items: center;
  gap: 0.4em;
}

.minis {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.3em;
}

.minis i,
.tile-board i {
  display: grid;
  height: 2.2em;
  place-items: center;
  border-radius: 0.35em;
}

.mini-photo {
  background:
    radial-gradient(circle at 72% 30%, #fde68a 0 0.3em, transparent 0.35em),
    linear-gradient(160deg, #bae6fd, #2182f8);
}

.mini-note {
  border: 1px solid rgb(252 211 77 / 0.9);
  background: #fff7d6;
}

.mini-pier {
  background: linear-gradient(180deg, #fbc4ab 0 50%, #38bdf8 50% 100%);
}

.mini-pdf {
  background: #fee2e2;
  color: #dc2626;
}

.mini-palette {
  display: flex !important;
  justify-content: center;
  gap: 0.2em;
  background: hsl(213 40% 96%);
}

.mini-palette b {
  width: 0.7em;
  height: 0.7em;
  border-radius: 50%;
  background: #b45309;
}

.mini-palette b + b {
  background: #0e7490;
}

.mini-palette b + b + b {
  background: #1e3a5f;
}

.sketch {
  top: 59%;
  left: 31%;
  width: 16%;
  height: 34%;
  rotate: -1deg;
}

/* ── Tiled windows ───────────────────────────────────── */

.tile {
  position: absolute;
  right: 2.5%;
  left: 52%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 0.8);
  border-radius: 0.7em;
  background: white;
  box-shadow: 0 1.2em 2.4em -1.2em rgb(15 23 42 / 0.55);
  opacity: 0;
  transition:
    opacity 0.35s ease,
    translate 0.6s cubic-bezier(0.2, 0.9, 0.3, 1),
    scale 0.6s cubic-bezier(0.2, 0.9, 0.3, 1);
}

.tile.open {
  opacity: 1;
  translate: 0 0;
  scale: 1;
}

/* Grows out of the folder card on the left. */
.tile-window {
  top: 4%;
  height: 52%;
  translate: -95% 45%;
  scale: 0.3;
  transform-origin: left bottom;
}

.tile-term {
  top: 60%;
  bottom: 5%;
  border-color: rgb(15 23 42 / 0.6);
  background: #0f172a;
  translate: 0 30%;
  scale: 0.96;
}

.tile-bar {
  display: flex;
  align-items: center;
  gap: 0.4em;
  border-bottom: 1px solid var(--pc-gray-border);
  background: var(--pc-gray-header);
  padding: 0.4em 0.7em;
  font-weight: 600;
  color: #475569;
}

.tile-bar-dark {
  border-bottom-color: rgb(255 255 255 / 0.08);
  background: #1e293b;
  color: #94a3b8;
}

.tile-board {
  display: grid;
  flex: 1;
  grid-template-columns: repeat(3, 1fr);
  grid-auto-rows: 1fr;
  align-content: start;
  gap: 0.45em;
  background-color: hsl(213 40% 97%);
  background-image: radial-gradient(hsl(215 25% 82%) 1px, transparent 1px);
  background-size: 1.2em 1.2em;
  padding: 0.7em;
}

.tile-board i {
  height: auto;
  box-shadow: 0 0.4em 0.8em -0.6em rgb(15 23 42 / 0.5);
}

.term {
  display: flex;
  flex-direction: column;
  gap: 0.35em;
  padding: 0.6em 0.8em;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.95em;
  color: #e2e8f0;
  white-space: nowrap;
}

.prompt {
  color: #4ade80;
}

.caret {
  display: inline-block;
  width: 0.55em;
  height: 1.05em;
  margin-left: 0.1em;
  vertical-align: text-bottom;
  background: #e2e8f0;
}

.term-out {
  color: #7dd3fc;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.term-out.shown {
  opacity: 1;
}

/* ── Workspace "Harbor" ──────────────────────────────── */

.idea {
  border-color: var(--color-pc-200);
}

.idea-fog {
  top: 12%;
  left: 7%;
  width: 24%;
  rotate: -1.5deg;
}

.idea-lighthouse {
  top: 8%;
  left: 38%;
  width: 22%;
  rotate: 1deg;
}

.thumb-lighthouse {
  position: relative;
  height: 7em;
  flex: none;
  overflow: hidden;
  background: linear-gradient(180deg, #fde4cf 0%, #fbc4ab 52%, #7dd3fc 53%, #2182f8 100%);
}

.tower {
  position: absolute;
  bottom: 38%;
  left: 40%;
  width: 1.1em;
  height: 3.3em;
  border-radius: 0.2em 0.2em 0 0;
  background: repeating-linear-gradient(180deg, #ef4444 0 0.55em, #fff 0.55em 1.1em);
}

.idea-palette {
  top: 26%;
  left: 67%;
  width: 20%;
  rotate: 2deg;
}

.harbor-photo {
  top: 50%;
  left: 12%;
  width: 20%;
  height: 44%;
  rotate: 1.5deg;
}

.shot-list {
  top: 58%;
  left: 58%;
  width: 18%;
  rotate: -2.5deg;
}

.swatches {
  display: flex;
  gap: 0.35em;
}

.swatches b {
  width: 1.8em;
  height: 1.8em;
  border-radius: 50%;
}

/* ── Cursor & key hint ───────────────────────────────── */

.cursor {
  position: absolute;
  z-index: 2;
  width: 1.3em;
  height: 1.6em;
  opacity: 0;
  filter: drop-shadow(0 0.1em 0.15em rgb(15 23 42 / 0.4));
  transition:
    left 0.9s cubic-bezier(0.4, 0, 0.2, 1),
    top 0.9s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.3s ease;
}

.cursor path {
  fill: #0f172a;
  stroke: white;
  stroke-width: 1.2;
  stroke-linejoin: round;
}

.cursor.shown {
  opacity: 1;
}

.cursor-rest {
  top: 82%;
  left: 46%;
}

.cursor-folder {
  top: 64%;
  left: 17%;
}

.cursor-away {
  top: 42%;
  left: 47%;
}

.keys {
  position: absolute;
  z-index: 2;
  bottom: 5%;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 0.4em;
  border-radius: 0.7em;
  background: rgb(15 23 42 / 0.82);
  padding: 0.45em 0.7em;
  color: #cbd5e1;
  font-weight: 600;
  opacity: 0;
  translate: -50% 0.5em;
  transition:
    opacity 0.3s ease,
    translate 0.3s ease;
}

.keys.shown {
  opacity: 1;
  translate: -50% 0;
}

.keys kbd {
  border: 1px solid rgb(255 255 255 / 0.25);
  border-bottom-width: 2px;
  border-radius: 0.35em;
  background: rgb(255 255 255 / 0.12);
  padding: 0.1em 0.45em;
  font-family: inherit;
  color: white;
}

.keys-label {
  margin-left: 0.2em;
  font-weight: 500;
  color: #94a3b8;
}

/* Narrow cards: the story stays, the details go. */
@container (max-width: 520px) {
  .ws:not(.active) .ws-name,
  .tray-icon,
  .sketch,
  .term-extra,
  .item-copy,
  .keys-label {
    display: none;
  }

  .tile {
    left: 48%;
  }

  .note {
    width: 19%;
  }

  .photo {
    left: 27%;
    width: 18%;
  }

  .folder {
    width: 24%;
  }

  .tile-board {
    grid-template-columns: repeat(3, 1fr);
  }

  .mini-palette,
  .mini-pdf {
    display: none !important;
  }

  .idea-fog,
  .idea-lighthouse,
  .idea-palette {
    width: 27%;
  }

  .idea-lighthouse {
    left: 37%;
  }

  .idea-palette {
    left: 69%;
  }

  .thumb-lighthouse {
    height: 4.5em;
  }

  .shot-list {
    display: none;
  }

  .harbor-photo {
    left: 8%;
    width: 24%;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .caret {
    animation: desk-caret 1s steps(1) infinite;
  }
}

@keyframes desk-caret {
  50% {
    opacity: 0;
  }
}
</style>
