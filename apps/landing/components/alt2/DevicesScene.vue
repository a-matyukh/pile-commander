<!-- ⑤ One cloud folder on a monitor, a tablet and a phone. Drawn after
     components/home/AnyDevice.vue, which the home page keeps, but as the app
     really adapts (ExplorerShell.vue, TopBar.vue, Board.vue):
     - the desktop app and a tablet's browser (640px and wider) keep the
       sidebar; a phone's sidebar is a drawer behind its button, and its
       bookmarks are a dropdown;
     - the board never reflows: the same cards in the same places at the
       same size, so the phone sees the board's left part and scrolls;
     - there is no tab bar and no floating button: a note is added with the
       folder header's + (Add → Note), and as the folder is in the cloud it
       shows up on the other two.
     Each screen's UI is sized as if it were that device's width in CSS
     pixels (monitor 1440, tablet 1024, phone 390), so one board fits them
     all at the same scale.
     SSR, no-JS and reduced motion get the frame where the note is
     everywhere. play() runs the story once, also with reduced motion. -->
<script setup lang="ts">
type Kind = "monitor" | "tablet" | "phone";

const devices: { kind: Kind; label: string }[] = [
  { kind: "monitor", label: "Desktop app" },
  { kind: "tablet", label: "Tablet, in the browser" },
  { kind: "phone", label: "Phone, in the browser" },
];

const root = ref<HTMLElement>();
// The settled frame; the loop rewinds it on the client.
const arrived = reactive<Record<Kind, boolean>>({ monitor: true, tablet: true, phone: true });
const tap = ref(false);
const menuOpen = ref(false);
const menuPick = ref(false);
const cloudBusy = ref(false);
/** Play was pressed: the story runs with motion, once */
const playing = ref(false);

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

function settle() {
  stop();
  playing.value = false;
  arrived.monitor = arrived.tablet = arrived.phone = true;
  tap.value = menuOpen.value = menuPick.value = cloudBusy.value = false;
}

/** One telling; `again` decides whether it loops or settles */
function cycle(again: boolean) {
  arrived.monitor = arrived.tablet = arrived.phone = false;
  tap.value = menuOpen.value = menuPick.value = cloudBusy.value = false;

  // + in the phone's folder header…
  at(600, () => {
    tap.value = true;
    menuOpen.value = true;
  });
  // …Note…
  at(1300, () => {
    tap.value = false;
    menuPick.value = true;
  });
  at(1750, () => {
    menuOpen.value = false;
    menuPick.value = false;
    arrived.phone = true;
  });
  // …through the cloud, onto the tablet and the monitor.
  at(2250, () => (cloudBusy.value = true));
  at(2750, () => (arrived.tablet = true));
  at(3150, () => {
    arrived.monitor = true;
    cloudBusy.value = false;
  });

  if (again) {
    at(6000, () => {
      arrived.monitor = arrived.tablet = arrived.phone = false;
    });
    at(7000, () => cycle(true));
  } else {
    at(4200, settle);
  }
}

function start() {
  if (running) return;
  running = true;
  cycle(true);
}

function play() {
  stop();
  running = true;
  playing.value = true;
  cycle(false);
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
  <div ref="root" class="devices-wrap" :class="{ playing }" aria-hidden="true">
    <p class="cloud" :class="{ busy: cloudBusy }">
      <UIcon name="i-tabler-cloud" class="size-4" />
      One cloud folder, live on every screen
    </p>

    <div class="devices">
      <div v-for="d in devices" :key="d.kind" class="device" :class="d.kind">
        <div class="bezel">
          <div class="screen">
            <span v-if="d.kind === 'phone'" class="notch" />
            <div class="ui" :class="`ui-${d.kind}`">
              <!-- Top bar: on a phone the bookmarks are a dropdown -->
              <div class="topbar">
                <UIcon name="i-tabler-layout-sidebar" class="ic" />
                <UIcon name="i-tabler-chevron-left" class="ic" />
                <UIcon name="i-tabler-chevron-right" class="ic" />
                <span class="sep" />
                <template v-if="d.kind === 'phone'">
                  <span class="bm-drop"><UIcon name="i-tabler-bookmark" class="ic" />Bookmarks<UIcon name="i-tabler-selector" class="ic dim" /></span>
                </template>
                <template v-else>
                  <span class="bm on"><UIcon name="i-tabler-template" class="ic v-board" />Harbor moodboard</span>
                  <span class="bm"><UIcon name="i-tabler-folder" class="ic" />Projects</span>
                </template>
              </div>

              <div class="body">
                <!-- The sidebar; a phone keeps it in a drawer -->
                <aside v-if="d.kind !== 'phone'" class="side">
                  <div class="drives">
                    <UIcon :name="d.kind === 'monitor' ? 'i-tabler-device-desktop' : 'i-tabler-database'" class="ic" />
                    <span class="dr-on"><UIcon name="i-tabler-cloud" class="ic" /></span>
                    <UIcon name="i-tabler-world" class="ic" />
                  </div>
                  <p class="t-row sel"><UIcon name="i-tabler-template" class="ic v-board" />Harbor moodboard</p>
                  <p class="t-row"><UIcon name="i-tabler-folder" class="ic" />Projects</p>
                  <p class="t-row"><UIcon name="i-tabler-folder" class="ic" />Recipes</p>
                </aside>

                <div class="main">
                  <div class="fh">
                    <div class="where">
                      <span class="crumbs"><UIcon name="i-tabler-cloud" class="ic" />Cloud</span>
                      <span class="title">Harbor moodboard</span>
                    </div>
                    <span class="acts">
                      <span class="act"><UIcon name="i-tabler-template" class="ic v-board" /></span>
                      <span class="act plus" :class="{ tap: d.kind === 'phone' && tap }"><UIcon name="i-tabler-plus" class="ic" /></span>
                      <span class="act"><UIcon name="i-tabler-stack-2" class="ic" /></span>
                      <span class="act"><UIcon name="i-lucide-sparkles" class="ic" /></span>
                      <span class="act"><UIcon name="i-tabler-share-2" class="ic" /></span>
                      <span class="act"><UIcon name="i-tabler-dots" class="ic" /></span>
                    </span>
                  </div>

                  <!-- The same board on every screen: places in em, at one scale -->
                  <div class="board">
                    <div class="c c-photo" style="left: 2em; top: 1.6em; width: 17em">
                      <img src="/landing-alt2/sea-horizon.jpg" alt="" class="thumb" width="520" height="346">
                      <b>Harbor morning</b>
                    </div>
                    <div class="c c-sticky" style="left: 21em; top: 2.2em; width: 11em">
                      <b>Mood</b><span>warm light, salty air</span>
                    </div>
                    <div class="c c-photo" style="left: 34em; top: 1.2em; width: 9em">
                      <img src="/landing-alt2/lemon-tea.jpg" alt="" class="thumb thumb-tall" width="416" height="520">
                    </div>
                    <div class="c c-palette" style="left: 21em; top: 9.6em; width: 11em">
                      <span class="dots"><i /><i /><i /><i /></span><b>Rope &amp; rust</b>
                    </div>
                    <div class="c c-photo" style="left: 46em; top: 3em; width: 10em">
                      <img src="/landing-alt2/pink-blossom.jpg" alt="" class="thumb thumb-tall" width="416" height="520">
                    </div>
                    <div class="c c-photo" style="left: 59em; top: 1.6em; width: 12em">
                      <img src="/landing-alt2/raspberries.jpg" alt="" class="thumb thumb-square" width="520" height="520">
                    </div>
                    <!-- The note that travels -->
                    <div class="c c-new" :class="{ on: arrived[d.kind] }" style="left: 2.5em; top: 15.5em; width: 14em">
                      <b>Call the framer</b><span>two frames, oak, by Friday</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- The phone's Add menu, from the header's + -->
              <div v-if="d.kind === 'phone'" class="add-menu" :class="{ open: menuOpen }">
                <p class="mi"><UIcon name="i-tabler-folder-plus" class="ic" />Folder</p>
                <p class="mi"><UIcon name="i-tabler-file-text" class="ic" />Text file</p>
                <p class="mi"><UIcon name="i-tabler-markdown" class="ic" />Markdown file</p>
                <p class="mi" :class="{ pick: menuPick }"><UIcon name="i-tabler-note" class="ic" />Note</p>
              </div>
            </div>
          </div>
        </div>
        <span v-if="d.kind === 'monitor'" class="neck" />
        <span v-if="d.kind === 'monitor'" class="foot" />
        <p class="device-label">{{ d.label }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.devices-wrap {
  container-type: inline-size;
}

.cloud {
  display: flex;
  width: fit-content;
  align-items: center;
  gap: 0.5rem;
  margin: 0 auto 1.5rem;
  border: 1px solid var(--a2-line);
  border-radius: 999px;
  background: var(--a2-surface);
  padding: 0.35rem 0.9rem;
  color: var(--a2-ink);
  font-size: 0.875rem;
  font-weight: 600;
  transition: box-shadow 0.3s ease;
}

.cloud.busy {
  box-shadow: 0 0 0 6px var(--a2-accent-soft);
}

/* Wide: three in a row, bottoms aligned. Narrow: monitor on top. */
.devices {
  display: grid;
  grid-template-columns: 2fr 0.8fr;
  grid-template-areas:
    "monitor monitor"
    "tablet phone";
  align-items: end;
  gap: 1.5rem 1rem;
}

@container (min-width: 900px) {
  .devices {
    grid-template-columns: 2fr 1.3fr 0.52fr;
    grid-template-areas: "monitor tablet phone";
    gap: 2rem;
  }
}

.monitor {
  grid-area: monitor;
}

.tablet {
  grid-area: tablet;
}

.phone {
  grid-area: phone;
}

.device {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
}

.device-label {
  margin: 0.75rem 0 0;
  color: var(--a2-ink-3);
  font-size: 0.8125rem;
  text-align: center;
}

.bezel {
  width: 100%;
  box-sizing: border-box;
  background: #14161b;
  box-shadow: 0 1.5rem 2.5rem -1.5rem rgb(15 23 42 / 0.55);
}

.monitor .bezel {
  border-radius: 0.8rem;
  padding: 0.55rem;
}

.tablet .bezel {
  border-radius: 1.2rem;
  padding: 0.7rem;
}

.phone .bezel {
  border-radius: 1.6rem;
  padding: 0.4rem;
}

.screen {
  position: relative;
  overflow: hidden;
  container-type: inline-size;
  background: white;
}

.monitor .screen {
  aspect-ratio: 16 / 10;
  border-radius: 0.35rem;
}

.tablet .screen {
  aspect-ratio: 4 / 3;
  border-radius: 0.55rem;
}

.phone .screen {
  aspect-ratio: 9 / 19.5;
  border-radius: 1.25rem;
}

.neck {
  width: 12%;
  height: 1.6rem;
  background: linear-gradient(90deg, #cbd5e1, #e2e8f0, #cbd5e1);
}

.foot {
  width: 30%;
  height: 0.45rem;
  border-radius: 0.4rem 0.4rem 0.15rem 0.15rem;
  background: #cbd5e1;
}

.notch {
  position: absolute;
  z-index: 3;
  top: 1.4%;
  left: 50%;
  width: 30%;
  height: 2.8%;
  translate: -50% 0;
  border-radius: 999px;
  background: #14161b;
}

/* ── The app, sized as each device's CSS width (13px type) ── */

.ui {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  color: #1f1f1e;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  line-height: 1.3;
}

/* 13 / 1440, 13 / 1024, 13 / 390 of the screen's width */
.ui-monitor {
  font-size: 0.903cqw;
}

.ui-tablet {
  font-size: 1.27cqw;
}

.ui-phone {
  padding-top: 9%;
  font-size: 3.33cqw;
}

.ic {
  width: 1.3em;
  height: 1.3em;
  flex: none;
}

.ic.v-board {
  color: #534ab7;
}

.ic.dim {
  color: #9a9893;
}

.topbar {
  display: flex;
  height: 2.9em;
  flex: none;
  align-items: center;
  gap: 0.55em;
  border-bottom: 1px solid rgb(0 0 0 / 0.08);
  background: #f8f8f7;
  padding: 0 0.9em;
  color: #5f5e5a;
}

.sep {
  width: 1px;
  height: 1.3em;
  background: rgb(0 0 0 / 0.08);
}

.bm,
.bm-drop {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  border-radius: 0.45em;
  padding: 0.3em 0.55em;
  color: #1f1f1e;
  white-space: nowrap;
}

.bm.on {
  background: #f0f0ee;
}

.body {
  display: flex;
  min-height: 0;
  flex: 1;
}

.side {
  width: 15em;
  flex: none;
  border-right: 1px solid rgb(0 0 0 / 0.08);
  background: #f8f8f7;
  padding: 0.6em 0.5em;
}

.drives {
  display: flex;
  justify-content: space-between;
  padding: 0.2em 0.6em 0.7em;
  color: #5f5e5a;
}

.dr-on {
  display: grid;
  margin: -0.35em;
  place-items: center;
  border-radius: 0.45em;
  background: #f0f0ee;
  padding: 0.35em;
  color: #1f1f1e;
}

.side p {
  margin: 0;
}

.t-row {
  display: flex;
  overflow: hidden;
  align-items: center;
  gap: 0.4em;
  border-radius: 0.45em;
  padding: 0.45em 0.5em;
  white-space: nowrap;
}

.t-row.sel {
  background: #e6f1fb;
  color: #185fa5;
}

.main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.fh {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 1em;
  border-bottom: 1px solid rgb(0 0 0 / 0.08);
  padding: 0.75em 1.1em 0.8em;
}

.where {
  display: grid;
  min-width: 0;
  gap: 0.2em;
}

.crumbs {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  color: #9a9893;
  font-size: 0.95em;
}

.title {
  overflow: hidden;
  font-size: 1.35em;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acts {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.2em;
  color: #5f5e5a;
}

.act {
  display: grid;
  width: 2.2em;
  height: 2.2em;
  place-items: center;
  border-radius: 0.45em;
  transition:
    background-color 0.15s ease,
    scale 0.15s ease;
}

.act.tap {
  background: #e6f1fb;
  color: #185fa5;
  scale: 0.92;
}

/* The phone's header: the title over the row of buttons */
.ui-phone .fh {
  flex-direction: column;
  align-items: stretch;
  gap: 0.5em;
}

.ui-phone .acts {
  justify-content: flex-end;
}

/* ── The board ───────────────────────────────────────── */

.board {
  position: relative;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  background: #ebe9e6;
}

.c {
  position: absolute;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.3em;
  box-sizing: border-box;
  border: 1px solid rgb(0 0 0 / 0.08);
  background: white;
  padding: 0.55em 0.7em;
}

.c b {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.c span {
  overflow: hidden;
  color: #5f5e5a;
  font-size: 0.9em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.c-photo {
  border: 0;
  background: transparent;
  padding: 0;
}

.c-photo b {
  padding-top: 0.3em;
  font-size: 0.9em;
}

.thumb {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 520 / 346;
  object-fit: cover;
}

.thumb-tall {
  aspect-ratio: 4 / 5;
}

.thumb-square {
  aspect-ratio: 1;
}

.c-sticky {
  border-color: rgb(252 211 77 / 0.9);
  background: #fff7d6;
}

.c-sticky b {
  color: rgb(120 53 15 / 0.9);
}

.c-sticky span {
  color: rgb(120 53 15 / 0.65);
}

.dots {
  display: flex;
  gap: 0.3em;
}

.dots i {
  width: 1.3em;
  height: 1.3em;
  border-radius: 50%;
  background: #b45309;
}

.dots i:nth-child(2) {
  background: #e7d3b0;
}

.dots i:nth-child(3) {
  background: #0e7490;
}

.dots i:nth-child(4) {
  background: #1e3a5f;
}

/* The note that travels */
.c-new {
  border-color: #85b7eb;
  opacity: 0;
  scale: 0.85;
  transition:
    opacity 0.35s ease,
    scale 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.25);
}

.c-new.on {
  opacity: 1;
  scale: 1;
  box-shadow: 0 0 0 0.3em rgb(55 138 221 / 0.18);
}

/* ── The phone's Add menu ────────────────────────────── */

.add-menu {
  position: absolute;
  top: 25.5%;
  right: 4%;
  z-index: 2;
  width: 62%;
  border: 1px solid rgb(0 0 0 / 0.08);
  border-radius: 0.8em;
  background: white;
  padding: 0.35em;
  box-shadow: 0 1em 2em -0.8em rgb(15 23 42 / 0.45);
  opacity: 0;
  translate: 0 -0.4em;
  transition:
    opacity 0.2s ease,
    translate 0.2s ease;
}

.add-menu.open {
  opacity: 1;
  translate: 0 0;
}

.mi {
  display: flex;
  align-items: center;
  gap: 0.5em;
  margin: 0;
  border-radius: 0.5em;
  padding: 0.5em 0.55em;
}

.mi.pick {
  background: #e6f1fb;
  color: #185fa5;
}

/* With reduced motion the frame changes at once, unless Play was pressed */
@media (prefers-reduced-motion: reduce) {
  .devices-wrap:not(.playing) * {
    transition-duration: 0ms !important;
  }
}
</style>
