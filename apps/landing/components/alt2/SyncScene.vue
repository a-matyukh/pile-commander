<!-- ③ A folder on the computer and its cloud copy: a picture added on the
     computer goes up, an edit made in the cloud comes back down. A copy of
     components/home/SyncScene.vue for this page, drawn as the app works
     (LOCAL_SYNC.md, SyncMenu.vue):
     - the computer's side shows the folder header's Sync button and its
       status, "Synced" or "Syncing…" (there is no Auto-sync switch);
     - the other side is "Cloud", and its folder says "Synced with a
       computer · just now", as the app's tree does;
     - both sides show the same view, because a folder's view syncs too: the
       loop shows the story in List, then in Board.
     SSR, no-JS and reduced motion get the settled Board frame. play() runs
     the story once in both looks, also with reduced motion: the visitor
     asked for it. -->
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

const syncing = computed(() => sketchLocalSyncing.value || moodLocalSyncing.value || packet.value !== "idle");
const viewIcon = computed(() => (view.value === "list" ? "i-tabler-list" : "i-tabler-template"));

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

/** The settled frame: the picture is on both sides, nothing moving */
function settle() {
  stop();
  view.value = "board";
  sketchLocal.value = true;
  sketchCloud.value = true;
  sketchLocalSyncing.value = false;
  moodCloudEdited.value = false;
  moodLocalSyncing.value = false;
  moodLocalFlash.value = false;
  packet.value = "idle";
}

/** One telling of the story in one look; `left` more tellings follow */
function cycle(look: View, left: number) {
  view.value = look;
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

  if (left > 0) {
    at(7600, () => {
      sketchLocal.value = false;
      sketchCloud.value = false;
    });
    // Same story again, in the other look.
    at(9000, () => cycle(look === "list" ? "board" : "list", left - 1));
  } else {
    at(7600, settle);
  }
}

function start() {
  if (running) return;
  running = true;
  cycle("list", Number.POSITIVE_INFINITY);
}

/** The visitor's Play: the story once in each look, then the settled frame */
function play() {
  stop();
  running = true;
  cycle("list", 1);
}

defineExpose({ play });

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
    <div class="sync-in">
    <!-- On this computer -->
    <div class="pane">
      <div class="pane-bar">
        <UIcon name="i-tabler-device-desktop" class="size-[1.15em] shrink-0" />
        <span class="pane-title">On this computer</span>
      </div>
      <div class="fh">
        <span class="where">
          <span class="path">~/Harbor moodboard</span>
        </span>
        <span class="acts">
          <span class="act"><UIcon :name="viewIcon" class="size-[1.15em]" :class="view === 'board' ? 'text-[#534ab7]' : ''" /></span>
          <!-- The Sync button, in its two looks -->
          <span class="act sync-btn" :class="{ busy: syncing }">
            <UIcon
              :name="syncing ? 'i-tabler-refresh' : 'i-tabler-cloud-check'"
              class="size-[1.15em]"
              :class="{ 'is-syncing': syncing }"
            />
            <span class="sync-label">{{ syncing ? "Syncing…" : "Synced" }}</span>
          </span>
        </span>
      </div>

      <div class="body">
        <ul class="look rows" :class="{ 'look-on': view === 'list' }">
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

        <div class="look board" :class="{ 'look-on': view === 'board' }">
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

    <!-- Cloud -->
    <div class="pane pane-cloud">
      <div class="pane-bar">
        <UIcon name="i-tabler-cloud" class="size-[1.2em] shrink-0" />
        <span class="pane-title">Cloud</span>
      </div>
      <div class="fh">
        <span class="where">
          <span class="path path-name">Harbor moodboard</span>
          <span class="badge-line">Synced with a computer · just now</span>
        </span>
        <span class="acts">
          <span class="act"><UIcon :name="viewIcon" class="size-[1.15em]" :class="view === 'board' ? 'text-[#534ab7]' : ''" /></span>
        </span>
      </div>

      <div class="body">
        <ul class="look rows" :class="{ 'look-on': view === 'list' }">
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
            </div>
          </li>
        </ul>

        <div class="look board" :class="{ 'look-on': view === 'board' }">
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
  </div>
</template>

<style scoped>
/* The app's palette (apps/client/src/ui/explorer/tokens.css).
   .sync is only the size container: a container cannot query itself, so the
   layout that changes with the width lives on .sync-in. */
.sync {
  height: 100%;
  container-type: inline-size;
  overflow: hidden;
  background: #f0f0ee;
}

.sync-in {
  position: relative;
  display: flex;
  height: 100%;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  padding: 6% 5%;
  color: #1f1f1e;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: clamp(9px, 1.75cqw, 18px);
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
  border: 1px solid rgb(0 0 0 / 0.08);
  border-radius: 0.9em;
  background: white;
  box-shadow: 0 0.9em 1.8em -1.1em rgb(15 23 42 / 0.35);
}

.pane-bar {
  display: flex;
  align-items: center;
  gap: 0.45em;
  border-bottom: 1px solid rgb(0 0 0 / 0.08);
  background: #f8f8f7;
  padding: 0.5em 0.7em;
  color: #5f5e5a;
  font-weight: 600;
}

.pane-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The folder's header: where it is, its view and (on the computer) Sync */
.fh {
  display: flex;
  min-height: 3.1em;
  align-items: center;
  gap: 0.5em;
  border-bottom: 1px solid rgb(0 0 0 / 0.06);
  padding: 0.35em 0.5em 0.35em 0.7em;
}

.where {
  display: grid;
  min-width: 0;
  gap: 0.1em;
}

.path {
  overflow: hidden;
  color: #9a9893;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.path-name {
  color: #1f1f1e;
  font-family: inherit;
  font-size: 0.9em;
  font-weight: 600;
}

.badge-line {
  overflow: hidden;
  color: #9a9893;
  font-size: 0.75em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acts {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.25em;
  margin-left: auto;
  color: #5f5e5a;
}

.act {
  display: inline-flex;
  height: 1.9em;
  min-width: 1.9em;
  align-items: center;
  justify-content: center;
  gap: 0.3em;
  border-radius: 0.45em;
}

.sync-btn {
  background: #f0f0ee;
  padding: 0 0.5em;
  color: #3b6d11;
}

.sync-btn.busy {
  color: #185fa5;
}

.sync-label {
  font-size: 0.8em;
  font-weight: 600;
  white-space: nowrap;
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
}

.status {
  width: 1.1em;
  height: 1.1em;
  flex: none;
  margin-left: auto;
}

.is-synced {
  color: #3b6d11;
}

.is-syncing {
  color: #378add;
}

.flash,
.edited {
  background: #e6f1fb;
  box-shadow: inset 0 0 0 1px #85b7eb;
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
  color: #b45309;
  font-size: 0.8em;
  font-weight: 700;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.edited .badge {
  opacity: 1;
}

/* Board: the same arrangement on both sides */

.board {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 0.5em;
  background: #f8f8f7;
  padding: 0.55em;
}

.card {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 0.25em;
  border: 1px solid rgb(0 0 0 / 0.08);
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
    0 0 0 0.2em rgb(55 138 221 / 0.45),
    0 0.5em 1em -0.7em rgb(15 23 42 / 0.45);
}

.thumb {
  flex: 1;
  min-height: 0;
  border-radius: 0.35em;
  background: url("/landing-alt2/sea-horizon.jpg") center / cover;
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
  background: #e6e5e1;
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
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.08);
}

.badge-float {
  position: absolute;
  top: -0.6em;
  right: -0.5em;
  padding: 0.25em;
}

/* The wire between the panes */

.bridge {
  position: relative;
  flex: none;
  width: 9%;
  border-top: 1.5px dashed rgb(55 138 221 / 0.55);
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
  background: #378add;
  color: white;
  box-shadow: 0 0 0 0.35em rgb(55 138 221 / 0.16);
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

/* Narrow: the panes stand one above the other and the wire runs down;
   the story stays, some details go. */
@container (max-width: 520px) {
  .sync-in {
    flex-direction: column;
    padding: 6% 6%;
    font-size: clamp(9px, 3.5cqw, 13px);
  }

  .pane {
    width: 100%;
  }

  .bridge {
    width: 0;
    height: 2.6em;
    border-top: 0;
    border-left: 1.5px dashed rgb(55 138 221 / 0.55);
  }

  .packet {
    top: 50%;
    left: 0;
  }

  .packet-up {
    animation-name: sync-up-v;
  }

  .packet-down {
    animation-name: sync-down-v;
  }

  .badge-text,
  .row-extra,
  .card-welcome {
    display: none;
  }

  .body {
    height: 8.6em;
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

@keyframes sync-up-v {
  from {
    top: 0;
  }

  to {
    top: 100%;
  }
}

@keyframes sync-down-v {
  from {
    top: 100%;
  }

  to {
    top: 0;
  }
}
</style>
