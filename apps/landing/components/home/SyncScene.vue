<!-- Local folder ⇄ cloud drive: a file added on the computer goes up, an edit
     made in the cloud comes back down. The loop alternates two looks at the
     same folder — a plain file list, then the app's own views (Board on the
     computer, Canvas in the cloud) — to show it is more than a synced list.
     SSR, no-JS and reduced motion get the settled Board/Canvas frame. -->
<script setup lang="ts">
type Packet = "idle" | "up" | "down";
type View = "list" | "board";
type FileKey = "sketch" | "harbor" | "mood" | "welcome";

const files: { key: FileKey; name: string; icon: string; tint: string }[] = [
  { key: "sketch", name: "Sketch.png", icon: "i-lucide-image", tint: "text-sky-500" },
  { key: "harbor", name: "Harbor morning.jpg", icon: "i-lucide-image", tint: "text-sky-500" },
  { key: "mood", name: "Mood.md", icon: "i-lucide-file-text", tint: "text-amber-600" },
  { key: "welcome", name: "Welcome.txt", icon: "i-lucide-file-text", tint: "text-slate-400" },
];

const viewIcons = [
  { key: "list", icon: "i-lucide-list", label: "List" },
  { key: "board", icon: "i-lucide-layout-grid", label: "Board" },
  { key: "canvas", icon: "i-lucide-spline", label: "Canvas" },
] as const;

const root = ref<HTMLElement>();
// The settled frame; the loop rewinds it on the client.
const view = ref<View>("board");
const sketchLocal = ref(true);
const sketchLocalSyncing = ref(false);
const sketchCloud = ref(true);
const moodCloudEdited = ref(false);
const moodLocalSyncing = ref(false);
const moodLocalFlash = ref(false);
const packet = ref<Packet>("idle");

const localView = computed(() => (view.value === "list" ? "list" : "board"));
const cloudView = computed(() => (view.value === "list" ? "list" : "canvas"));

function localShown(key: FileKey) {
  return key !== "sketch" || sketchLocal.value;
}

function localSyncing(key: FileKey) {
  return (key === "sketch" && sketchLocalSyncing.value) || (key === "mood" && moodLocalSyncing.value);
}

function localFlash(key: FileKey) {
  return key === "mood" && moodLocalFlash.value;
}

function cloudShown(key: FileKey) {
  return key !== "sketch" || sketchCloud.value;
}

function cloudEdited(key: FileKey) {
  return key === "mood" && moodCloudEdited.value;
}

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

function cycle(next: View) {
  view.value = next;
  sketchLocal.value = false;
  sketchLocalSyncing.value = false;
  sketchCloud.value = false;
  moodCloudEdited.value = false;
  moodLocalSyncing.value = false;
  moodLocalFlash.value = false;
  packet.value = "idle";

  // Up: a new file on the computer.
  at(900, () => {
    sketchLocal.value = true;
    sketchLocalSyncing.value = true;
  });
  at(1500, () => (packet.value = "up"));
  at(2700, () => {
    packet.value = "idle";
    sketchCloud.value = true;
    sketchLocalSyncing.value = false;
  });

  // Down: an edit made in the cloud.
  at(4100, () => (moodCloudEdited.value = true));
  at(4500, () => {
    packet.value = "down";
    moodLocalSyncing.value = true;
  });
  at(5700, () => {
    packet.value = "idle";
    moodLocalSyncing.value = false;
    moodLocalFlash.value = true;
  });
  at(6700, () => {
    moodLocalFlash.value = false;
    moodCloudEdited.value = false;
  });

  at(7600, () => {
    sketchLocal.value = false;
    sketchCloud.value = false;
  });
  // Same story again, in the other look.
  at(9000, () => cycle(next === "list" ? "board" : "list"));
}

function start() {
  if (running) return;
  running = true;
  cycle("list");
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
  <div ref="root" class="sync" aria-hidden="true">
    <!-- On this computer -->
    <div class="pane">
      <div class="pane-bar">
        <span class="dots"><i /><i /><i /></span>
        <UIcon name="i-lucide-laptop" class="bar-icon size-[1.1em] shrink-0" />
        <span class="pane-title">On this computer</span>
        <span class="views">
          <span v-for="v in viewIcons" :key="v.key" class="view-btn" :class="{ active: v.key === localView }">
            <UIcon :name="v.icon" class="size-[0.95em] shrink-0" />
            <span class="view-name">{{ v.label }}</span>
          </span>
        </span>
      </div>
      <div class="path">
        <span class="path-text path-mono">~/Harbor moodboard</span>
        <span class="toggle">
          <span class="toggle-label">Auto-sync</span>
          <span class="switch"><span class="knob" /></span>
        </span>
      </div>

      <div class="body">
        <ul class="look rows" :class="{ 'look-on': localView === 'list' }">
          <li
            v-for="file in files"
            :key="file.key"
            class="row-wrap"
            :class="{ on: localShown(file.key), 'row-extra': file.key === 'welcome' }"
          >
            <div class="row" :class="{ 'row-new': file.key === 'sketch', flash: localFlash(file.key) }">
              <UIcon :name="file.icon" class="size-[1.05em] shrink-0" :class="file.tint" />
              <span class="name">{{ file.name }}</span>
              <UIcon
                :name="localSyncing(file.key) ? 'i-lucide-refresh-cw' : 'i-lucide-circle-check'"
                class="status"
                :class="localSyncing(file.key) ? 'is-syncing' : 'is-synced'"
              />
            </div>
          </li>
        </ul>

        <div class="look board" :class="{ 'look-on': localView === 'board' }">
          <div
            v-for="file in files"
            :key="file.key"
            class="card"
            :class="[`card-${file.key}`, { on: localShown(file.key), flash: localFlash(file.key) }]"
          >
            <div v-if="file.key === 'harbor'" class="thumb" />
            <div v-else-if="file.key === 'sketch'" class="thumb thumb-sketch" />
            <template v-if="file.key === 'mood'">
              <p class="card-title">Mood</p>
              <p class="card-copy">warm light</p>
            </template>
            <template v-else-if="file.key === 'welcome'">
              <p class="card-title card-doc">
                <UIcon name="i-lucide-file-text" class="size-[1em] shrink-0 text-slate-400" />
                Welcome
              </p>
              <span class="lines"><i /><i /></span>
            </template>
            <p v-else class="card-name">{{ file.key === "sketch" ? "Sketch" : "Harbor" }}</p>
            <span class="card-status">
              <UIcon
                :name="localSyncing(file.key) ? 'i-lucide-refresh-cw' : 'i-lucide-circle-check'"
                class="size-full"
                :class="localSyncing(file.key) ? 'is-syncing' : 'is-synced'"
              />
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- The wire: a packet rides it in the direction of the change -->
    <span class="bridge">
      <span class="packet" :class="`packet-${packet}`">
        <UIcon name="i-lucide-file" class="size-[0.9em]" />
      </span>
    </span>

    <!-- Cloud drive -->
    <div class="pane pane-cloud">
      <div class="pane-bar">
        <UIcon name="i-lucide-cloud" class="size-[1.2em] shrink-0 text-pc-600" />
        <span class="pane-title">Cloud drive</span>
        <span class="views">
          <span v-for="v in viewIcons" :key="v.key" class="view-btn" :class="{ active: v.key === cloudView }">
            <UIcon :name="v.icon" class="size-[0.95em] shrink-0" />
            <span class="view-name">{{ v.label }}</span>
          </span>
        </span>
      </div>
      <div class="path">
        <UIcon name="i-lucide-folder" class="size-[1em] shrink-0" />
        <span class="path-text">Harbor moodboard</span>
      </div>

      <div class="body">
        <ul class="look rows" :class="{ 'look-on': cloudView === 'list' }">
          <li
            v-for="file in files"
            :key="file.key"
            class="row-wrap"
            :class="{ on: cloudShown(file.key), 'row-extra': file.key === 'welcome' }"
          >
            <div class="row" :class="{ 'row-new': file.key === 'sketch', edited: cloudEdited(file.key) }">
              <UIcon :name="file.icon" class="size-[1.05em] shrink-0" :class="file.tint" />
              <span class="name">{{ file.name }}</span>
              <span v-if="file.key === 'mood'" class="badge">
                <UIcon name="i-lucide-pencil" class="size-[0.9em]" />
                <span class="badge-text">edited</span>
              </span>
              <UIcon name="i-lucide-cloud-check" class="status is-cloud" />
            </div>
          </li>
        </ul>

        <div class="look canvas" :class="{ 'look-on': cloudView === 'canvas' }">
          <svg class="wire" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d="M 40 30 C 52 14, 58 14, 62 24" />
          </svg>
          <div
            v-for="file in files"
            :key="file.key"
            class="card"
            :class="[`card-${file.key}`, { on: cloudShown(file.key), edited: cloudEdited(file.key) }]"
          >
            <div v-if="file.key === 'harbor'" class="thumb" />
            <div v-else-if="file.key === 'sketch'" class="thumb thumb-sketch" />
            <template v-if="file.key === 'mood'">
              <p class="card-title">Mood</p>
              <p class="card-copy">warm light</p>
              <span class="badge badge-float">
                <UIcon name="i-lucide-pencil" class="size-[0.9em]" />
              </span>
            </template>
            <template v-else-if="file.key === 'welcome'">
              <p class="card-title card-doc">
                <UIcon name="i-lucide-file-text" class="size-[1em] shrink-0 text-slate-400" />
                Welcome
              </p>
              <span class="lines"><i /><i /></span>
            </template>
            <p v-else class="card-name">{{ file.key === "sketch" ? "Sketch" : "Harbor" }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sync {
  position: relative;
  display: flex;
  height: 100%;
  container-type: inline-size;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: linear-gradient(160deg, hsl(215 40% 97%) 0%, hsl(210 36% 94%) 100%);
  padding: 6% 5%;
  font-size: clamp(9px, 1.8cqw, 17px);
  color: #334155;
}

p {
  margin: 0;
}

.pane {
  position: relative;
  display: flex;
  width: 42%;
  min-width: 0;
  flex: none;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--pc-gray-border);
  border-radius: 0.9em;
  background: white;
  box-shadow: 0 0.9em 1.8em -1.1em rgb(15 23 42 / 0.45);
}

.pane-bar {
  display: flex;
  align-items: center;
  gap: 0.45em;
  border-bottom: 1px solid var(--pc-gray-border);
  background: var(--pc-gray-header);
  padding: 0.5em 0.6em 0.5em 0.7em;
  color: #475569;
  font-weight: 600;
}

.pane-cloud .pane-bar {
  border-bottom-color: var(--color-pc-100);
  background: var(--color-pc-50);
  color: var(--color-pc-800);
}

.pane-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dots {
  display: inline-flex;
  flex: none;
  gap: 0.28em;
  margin-right: 0.2em;
}

.dots i {
  width: 0.45em;
  height: 0.45em;
  border-radius: 50%;
  background: #cbd5e1;
}

/* View switcher: List / Board / Canvas. */
.views {
  display: inline-flex;
  flex: none;
  gap: 0.1em;
  margin-left: auto;
  border: 1px solid var(--pc-gray-border);
  border-radius: 0.5em;
  background: white;
  padding: 0.12em;
}

.view-btn {
  display: inline-flex;
  min-width: 1.55em;
  height: 1.35em;
  align-items: center;
  justify-content: center;
  gap: 0.3em;
  border-radius: 0.35em;
  padding: 0 0.3em;
  font-size: 0.85em;
  color: #94a3b8;
  transition:
    background-color 0.3s ease,
    color 0.3s ease;
}

.view-btn.active {
  background: var(--color-pc-500);
  color: white;
}

/* Only the active view spells out its name. */
.view-name {
  display: none;
}

.active .view-name {
  display: inline;
}

.path {
  display: flex;
  align-items: center;
  gap: 0.35em;
  border-bottom: 1px solid hsl(215 35% 95%);
  padding: 0.4em 0.7em;
  font-size: 0.9em;
  font-weight: 600;
  color: #64748b;
}

.path-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.path-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 400;
  color: #94a3b8;
}

/* The folder's sync mode, switched on. */
.toggle {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.4em;
  margin-left: auto;
  color: var(--color-pc-700);
}

.switch {
  position: relative;
  width: 2em;
  height: 1.15em;
  border-radius: 999px;
  background: var(--color-pc-500);
}

.knob {
  position: absolute;
  top: 0.15em;
  right: 0.15em;
  width: 0.85em;
  height: 0.85em;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 2px rgb(15 23 42 / 0.25);
}

/* ── The two looks share one fixed-height body and cross-fade. ── */

.body {
  position: relative;
  height: 10.4em;
}

.look {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 0.5s ease;
}

.look-on {
  opacity: 1;
}


/* List */

.rows {
  margin: 0;
  padding: 0.2em 0;
  list-style: none;
}

.row-wrap {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows 0.45s ease,
    opacity 0.35s ease;
}

.row-wrap.on {
  grid-template-rows: 1fr;
  opacity: 1;
}

.row {
  display: flex;
  min-height: 0;
  align-items: center;
  gap: 0.5em;
  overflow: hidden;
  margin: 0 0.3em;
  border-radius: 0.5em;
  padding: 0.5em;
  transition:
    background-color 0.4s ease,
    box-shadow 0.4s ease;
}

.name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-new {
  font-weight: 600;
  color: #1e293b;
}

.status {
  width: 1.1em;
  height: 1.1em;
  flex: none;
  margin-left: auto;
}

.is-synced {
  color: #16a34a;
}

.is-syncing,
.is-cloud {
  color: var(--color-pc-500);
}

.flash,
.edited {
  background: var(--color-pc-50);
  box-shadow: inset 0 0 0 1px rgb(33 130 248 / 0.35);
}

.badge {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.25em;
  margin-left: auto;
  border-radius: 999px;
  background: #fef3c7;
  padding: 0.1em 0.5em;
  font-size: 0.8em;
  font-weight: 700;
  color: #b45309;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.badge + .status {
  margin-left: 0.4em;
}

.edited .badge {
  opacity: 1;
}

/* Board (computer) and Canvas (cloud) */

.board {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 0.5em;
  padding: 0.55em;
  background: hsl(213 40% 97%);
}

.canvas {
  background-color: hsl(213 40% 97%);
  background-image: radial-gradient(hsl(215 25% 80%) 1px, transparent 1px);
  background-size: 1.2em 1.2em;
}

.card {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 0.25em;
  border: 1px solid var(--pc-gray-border);
  border-radius: 0.6em;
  background: white;
  padding: 0.35em;
  box-shadow: 0 0.5em 1em -0.7em rgb(15 23 42 / 0.45);
  opacity: 0;
  scale: 0.85;
  transition:
    opacity 0.35s ease,
    scale 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.2),
    background-color 0.4s ease,
    box-shadow 0.4s ease;
}

.card.on {
  opacity: 1;
  scale: 1;
}

.board .card-harbor {
  order: 1;
}

.board .card-mood {
  order: 2;
}

.board .card-welcome {
  order: 3;
}

.board .card-sketch {
  order: 4;
}

.canvas .card {
  position: absolute;
}

.canvas .card-harbor {
  top: 7%;
  left: 5%;
  width: 38%;
  height: 46%;
  rotate: -2deg;
}

.canvas .card-mood {
  top: 12%;
  left: 60%;
  width: 34%;
  rotate: 2.5deg;
}

.canvas .card-welcome {
  top: 58%;
  left: 55%;
  width: 38%;
  rotate: -1deg;
}

.canvas .card-sketch {
  top: 58%;
  left: 12%;
  width: 34%;
  height: 36%;
  rotate: 1.5deg;
}

.card-mood {
  border-color: rgb(252 211 77 / 0.9);
  background: #fff7d6;
  padding: 0.45em 0.55em;
  color: rgb(120 53 15 / 0.85);
}

.card-mood.flash,
.card-mood.edited {
  background: #fff7d6;
  box-shadow:
    0 0 0 0.2em rgb(33 130 248 / 0.45),
    0 0.5em 1em -0.7em rgb(15 23 42 / 0.45);
}

.thumb {
  flex: 1;
  min-height: 0;
  border-radius: 0.35em;
  background:
    radial-gradient(circle at 76% 30%, #fde68a 0 0.45em, transparent 0.5em),
    linear-gradient(160deg, #bae6fd 0%, #7dd3fc 40%, #2182f8 100%);
}

.thumb-sketch {
  background:
    repeating-linear-gradient(135deg, transparent 0 0.35em, rgb(100 116 139 / 0.28) 0.35em 0.45em),
    hsl(40 60% 97%);
}

.card-name,
.card-title {
  overflow: hidden;
  font-size: 0.85em;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-doc {
  display: flex;
  align-items: center;
  gap: 0.3em;
  color: #334155;
}

.card-copy {
  font-size: 0.8em;
  color: rgb(120 53 15 / 0.65);
}

.card-welcome {
  padding: 0.45em 0.55em;
}

.lines {
  display: flex;
  flex-direction: column;
  gap: 0.3em;
  margin-top: 0.2em;
}

.lines i {
  display: block;
  height: 0.35em;
  border-radius: 999px;
  background: hsl(215 25% 90%);
}

.lines i + i {
  width: 65%;
}

.card-status {
  position: absolute;
  top: -0.45em;
  right: -0.45em;
  display: grid;
  width: 1.15em;
  height: 1.15em;
  place-items: center;
  border-radius: 50%;
  background: white;
  box-shadow: 0 0 0 1px var(--pc-gray-border);
}

.badge-float {
  position: absolute;
  top: -0.6em;
  right: -0.5em;
  padding: 0.25em;
}

.wire {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.wire path {
  fill: none;
  stroke: var(--color-pc-400);
  stroke-dasharray: 2 1.5;
  stroke-linecap: round;
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}

/* The wire between the panes */

.bridge {
  position: relative;
  flex: none;
  width: 9%;
  border-top: 1.5px dashed rgb(33 130 248 / 0.55);
}

.packet {
  position: absolute;
  top: 0;
  left: 50%;
  display: grid;
  width: 1.8em;
  height: 1.8em;
  place-items: center;
  border-radius: 50%;
  background: var(--color-pc-500);
  color: white;
  box-shadow: 0 0 0 0.35em rgb(33 130 248 / 0.16);
  translate: -50% -50%;
  opacity: 0;
  transition: opacity 0.25s ease;
}

.packet-up {
  opacity: 1;
  animation: sync-up 1.2s ease-in-out both;
}

.packet-down {
  opacity: 1;
  animation: sync-down 1.2s ease-in-out both;
}

/* Narrow cards: the story stays, the details go. */
@container (max-width: 520px) {
  .toggle-label,
  .badge-text,
  .dots,
  .row-extra,
  .card-welcome {
    display: none;
  }

  .sync {
    padding: 5% 3%;
  }

  .pane {
    width: 43%;
  }

  .bridge {
    width: 10%;
  }

  .path {
    font-size: 0.8em;
  }

  .body {
    height: 8.6em;
  }

  .views {
    font-size: 0.85em;
  }

  .active .view-name,
  .pane:not(.pane-cloud) .bar-icon,
  .card-copy {
    display: none;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .is-syncing {
    animation: sync-spin 1s linear infinite;
  }
}

@keyframes sync-spin {
  to {
    rotate: 360deg;
  }
}

@keyframes sync-up {
  from {
    left: 0;
  }

  to {
    left: 100%;
  }
}

@keyframes sync-down {
  from {
    left: 100%;
  }

  to {
    left: 0;
  }
}
</style>
