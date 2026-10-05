<!-- The same workspace on a monitor, a tablet and a phone, each laid out for
     its screen. A card added on the phone reaches the other two through the
     cloud. SSR, no-JS and reduced motion get the frame where it is everywhere. -->
<script setup lang="ts">
const facts = [
  {
    icon: "i-lucide-layout-panel-left",
    title: "Adaptive layout",
    body: "The sidebar folds away on a tablet; on a phone the board becomes one easy column.",
  },
  {
    icon: "i-lucide-hand",
    title: "Made for touch",
    body: "Tap, drag and pinch to zoom work the way they do with a mouse and trackpad.",
  },
  {
    icon: "i-lucide-smartphone",
    title: "Install from the browser",
    body: "Add it to the home screen and it opens like an app — no store needed.",
  },
  {
    icon: "i-lucide-refresh-cw",
    title: "Synced — or not",
    body: "Cloud desktops follow you to every device; local and browser desktops stay on the one you use.",
  },
];

const views = ["i-lucide-layout-grid", "i-lucide-list", "i-lucide-spline"];

const root = ref<HTMLElement>();
// The settled frame; the loop rewinds it on the client.
const onPhone = ref(true);
const onTablet = ref(true);
const onMonitor = ref(true);
const tap = ref(false);
const cloudBusy = ref(false);
const syncing = reactive({ phone: false, tablet: false, monitor: false });

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
  onPhone.value = false;
  onTablet.value = false;
  onMonitor.value = false;
  tap.value = false;
  cloudBusy.value = false;

  // Added on the phone…
  at(700, () => (tap.value = true));
  at(1000, () => {
    tap.value = false;
    onPhone.value = true;
    syncing.phone = true;
  });
  // …through the cloud…
  at(1700, () => {
    syncing.phone = false;
    cloudBusy.value = true;
    syncing.tablet = true;
    syncing.monitor = true;
  });
  // …onto the tablet and the monitor.
  at(2300, () => {
    syncing.tablet = false;
    onTablet.value = true;
  });
  at(2700, () => {
    syncing.monitor = false;
    onMonitor.value = true;
    cloudBusy.value = false;
  });
  at(5600, () => {
    onPhone.value = false;
    onTablet.value = false;
    onMonitor.value = false;
  });
  at(7000, cycle);
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
  <FeatureSection
    eyebrow="Any device"
    title="Use it on any device."
    lede="The same app on a desktop, a tablet and a phone. The interface reshapes itself for the screen — and for fingers instead of a mouse."
    muted
  >
    <div ref="root" class="devices-wrap" aria-hidden="true">
      <p class="cloud" :class="{ busy: cloudBusy }">
        <UIcon name="i-lucide-cloud" class="size-4 text-pc-500" />
        Synced through the cloud
      </p>

      <div class="devices">
        <!-- Monitor: sidebar + board -->
        <div class="device monitor">
          <div class="bezel">
            <div class="screen">
              <div class="ui ui-monitor">
                <aside class="side">
                  <p class="side-app"><img src="/app-icon.png" alt="" /> Pile</p>
                  <p class="side-item"><UIcon name="i-lucide-folder" /> Research</p>
                  <p class="side-item active"><UIcon name="i-lucide-folder-open" /> Harbor moodboard</p>
                  <p class="side-item"><UIcon name="i-lucide-folder" /> Inbox</p>
                </aside>
                <div class="main">
                  <div class="bar">
                    <span class="bar-title">Harbor moodboard</span>
                    <span class="views">
                      <i v-for="(v, i) in views" :key="v" :class="{ on: i === 0 }"><UIcon :name="v" /></i>
                    </span>
                    <UIcon
                      :name="syncing.monitor ? 'i-lucide-refresh-cw' : 'i-lucide-cloud-check'"
                      class="sync-icon"
                      :class="{ spin: syncing.monitor }"
                    />
                  </div>
                  <div class="board board-free">
                    <div class="c c-photo" style="left: 4%; top: 7%; width: 25%; height: 58%">
                      <div class="thumb" /><b>Harbor</b>
                    </div>
                    <div class="c c-note" style="left: 33%; top: 9%; width: 20%"><b>Mood</b><span>warm light</span></div>
                    <div class="c" style="left: 57%; top: 6%; width: 25%"><b>Fog at dawn</b><span>shoot the pier</span></div>
                    <div class="c c-palette" style="left: 33%; top: 50%; width: 21%">
                      <span class="dots"><i /><i /><i /><i /></span><b>Rope &amp; rust</b>
                    </div>
                    <div class="c c-new" :class="{ on: onMonitor }" style="left: 60%; top: 40%; width: 25%; height: 42%">
                      <div class="thumb thumb-lh"><span class="tower" /></div><b>Lighthouse</b>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <span class="neck" />
          <span class="foot" />
        </div>

        <!-- Tablet: no sidebar, bigger controls -->
        <div class="device tablet">
          <div class="bezel">
            <div class="screen">
              <div class="ui ui-tablet">
                <div class="bar">
                  <UIcon name="i-lucide-menu" class="bar-menu" />
                  <span class="bar-title">Harbor moodboard</span>
                  <span class="views">
                    <i v-for="(v, i) in views" :key="v" :class="{ on: i === 0 }"><UIcon :name="v" /></i>
                  </span>
                  <UIcon
                    :name="syncing.tablet ? 'i-lucide-refresh-cw' : 'i-lucide-cloud-check'"
                    class="sync-icon"
                    :class="{ spin: syncing.tablet }"
                  />
                </div>
                <div class="board board-grid">
                  <div class="c c-photo"><div class="thumb" /><b>Harbor</b></div>
                  <div class="c c-note"><b>Mood</b><span>warm light</span></div>
                  <div class="c"><b>Fog at dawn</b><span>shoot the pier</span></div>
                  <div class="c c-palette"><span class="dots"><i /><i /><i /><i /></span><b>Rope &amp; rust</b></div>
                  <div class="c c-new" :class="{ on: onTablet }">
                    <div class="thumb thumb-lh"><span class="tower" /></div><b>Lighthouse</b>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Phone: one column, tab bar -->
        <div class="device phone">
          <div class="bezel">
            <div class="screen">
              <span class="notch" />
              <div class="ui ui-phone">
                <div class="bar">
                  <span class="bar-title">Harbor moodboard</span>
                  <UIcon
                    :name="syncing.phone ? 'i-lucide-refresh-cw' : 'i-lucide-cloud-check'"
                    class="sync-icon"
                    :class="{ spin: syncing.phone }"
                  />
                </div>
                <div class="column">
                  <div class="grow" :class="{ on: onPhone }">
                    <div class="c c-new" :class="{ on: onPhone }">
                      <div class="thumb thumb-lh"><span class="tower" /></div><b>Lighthouse</b>
                    </div>
                  </div>
                  <div class="c c-photo"><div class="thumb" /><b>Harbor</b></div>
                  <div class="c c-note"><b>Mood</b><span>warm light</span></div>
                  <div class="c"><b>Fog at dawn</b><span>shoot the pier</span></div>
                </div>
                <div class="tabs">
                  <i v-for="(v, i) in views" :key="v" :class="{ on: i === 0 }"><UIcon :name="v" /></i>
                  <span class="fab" :class="{ tap }"><UIcon name="i-lucide-plus" /></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ul class="mt-12 grid list-none gap-6 p-0 sm:grid-cols-2 lg:grid-cols-4">
      <li v-for="fact in facts" :key="fact.title">
        <UIcon :name="fact.icon" class="size-5 text-pc-500" />
        <h3 class="mt-3 text-base font-semibold text-slate-900">{{ fact.title }}</h3>
        <p class="mt-1.5 text-sm leading-relaxed text-slate-600">{{ fact.body }}</p>
      </li>
    </ul>
  </FeatureSection>
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
  border: 1px solid var(--color-pc-200);
  border-radius: 999px;
  background: white;
  padding: 0.35rem 0.9rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-pc-700);
  transition: box-shadow 0.3s ease;
}

.cloud.busy {
  box-shadow: 0 0 0 6px rgb(33 130 248 / 0.15);
}

/* Wide: three in a row, bottoms aligned. Narrow: monitor on top. */
.devices {
  display: grid;
  grid-template-columns: 2fr 0.75fr;
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

.bezel {
  width: 100%;
  background: #0f172a;
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
  aspect-ratio: 9 / 19;
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
  z-index: 2;
  top: 1.6%;
  left: 50%;
  width: 32%;
  height: 3.2%;
  translate: -50% 0;
  border-radius: 999px;
  background: #0f172a;
}

/* ── App UI, sized from each screen's own width ─────── */

.ui {
  position: absolute;
  inset: 0;
  display: flex;
  color: #334155;
}

.ui-monitor {
  font-size: 1.75cqw;
}

.ui-tablet {
  flex-direction: column;
  font-size: 2.9cqw;
}

.ui-phone {
  flex-direction: column;
  padding-top: 11%;
  font-size: 6.2cqw;
}

.side {
  width: 22%;
  flex: none;
  border-right: 1px solid var(--pc-gray-border);
  background: var(--pc-gray-header);
  padding: 0.8em 0.6em;
}

.side p {
  display: flex;
  align-items: center;
  gap: 0.45em;
  margin: 0;
  overflow: hidden;
  white-space: nowrap;
}

.side-app {
  margin-bottom: 0.9em !important;
  font-weight: 700;
  color: #0f172a;
}

.side-app img {
  width: 1.3em;
  height: 1.3em;
  border-radius: 0.3em;
}

.side-item {
  border-radius: 0.4em;
  padding: 0.35em 0.45em;
  color: #64748b;
}

.side-item.active {
  background: white;
  font-weight: 600;
  color: var(--color-pc-700);
  box-shadow: 0 0 0 1px var(--pc-gray-border);
}

.main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.bar {
  display: flex;
  align-items: center;
  gap: 0.6em;
  border-bottom: 1px solid var(--pc-gray-border);
  padding: 0.55em 0.8em;
}

.bar-title {
  min-width: 0;
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #0f172a;
}

.bar-menu {
  width: 1.3em;
  height: 1.3em;
  flex: none;
  color: #475569;
}

.views {
  display: inline-flex;
  flex: none;
  gap: 0.15em;
  margin-left: auto;
  border: 1px solid var(--pc-gray-border);
  border-radius: 0.5em;
  padding: 0.15em;
}

.views i,
.tabs i {
  display: grid;
  width: 1.6em;
  height: 1.4em;
  place-items: center;
  border-radius: 0.35em;
  color: #94a3b8;
}

.ui-tablet .views i {
  width: 2em;
  height: 1.7em;
}

.views i.on,
.tabs i.on {
  background: var(--color-pc-500);
  color: white;
}

.sync-icon {
  width: 1.15em;
  height: 1.15em;
  flex: none;
  color: var(--color-pc-500);
}

.ui-phone .sync-icon {
  margin-left: auto;
}

.spin {
  animation: any-spin 0.9s linear infinite;
}

/* ── Boards ─────────────────────────────────────────── */

.board {
  position: relative;
  flex: 1;
  min-height: 0;
  background-color: hsl(213 40% 97%);
  background-image: radial-gradient(hsl(215 25% 84%) 1px, transparent 1px);
  background-size: 1.4em 1.4em;
}

.board-free .c {
  position: absolute;
}

.board-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-auto-rows: 1fr;
  gap: 0.7em;
  padding: 0.8em;
}

.c {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 0.3em;
  overflow: hidden;
  border: 1px solid var(--pc-gray-border);
  border-radius: 0.6em;
  background: white;
  padding: 0.45em 0.55em;
  box-shadow: 0 0.5em 1em -0.7em rgb(15 23 42 / 0.45);
}

.c b {
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #1e293b;
}

.c span {
  overflow: hidden;
  font-size: 0.85em;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #64748b;
}

.c-note {
  border-color: rgb(252 211 77 / 0.9);
  background: #fff7d6;
}

.c-note b {
  color: rgb(120 53 15 / 0.9);
}

.c-note span {
  color: rgb(120 53 15 / 0.65);
}

.thumb {
  flex: 1;
  min-height: 2.2em;
  border-radius: 0.35em;
  background:
    radial-gradient(circle at 76% 30%, #fde68a 0 0.45em, transparent 0.5em),
    linear-gradient(160deg, #bae6fd 0%, #7dd3fc 40%, #2182f8 100%);
}

.thumb-lh {
  position: relative;
  overflow: hidden;
  background: linear-gradient(180deg, #fde4cf 0%, #fbc4ab 52%, #7dd3fc 53%, #2182f8 100%);
}

.tower {
  position: absolute;
  bottom: 38%;
  left: 42%;
  width: 0.7em;
  height: 2em;
  border-radius: 0.15em 0.15em 0 0;
  background: repeating-linear-gradient(180deg, #ef4444 0 0.33em, #fff 0.33em 0.66em);
}

.dots {
  display: flex;
  gap: 0.25em;
}

.dots i {
  width: 1.1em;
  height: 1.1em;
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

/* The card that travels. */
.c-new {
  border-color: var(--color-pc-300);
  opacity: 0;
  scale: 0.8;
  transition:
    opacity 0.35s ease,
    scale 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.25);
}

.c-new.on {
  opacity: 1;
  scale: 1;
  box-shadow:
    0 0 0 0.25em rgb(33 130 248 / 0.18),
    0 0.5em 1em -0.7em rgb(15 23 42 / 0.45);
}

/* ── Phone column + tab bar ─────────────────────────── */

.ui-phone .bar {
  border-bottom: none;
  padding: 0.5em 0.8em 0.4em;
}

.column {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 0.55em;
  overflow: hidden;
  background: hsl(213 40% 97%);
  padding: 0.6em 0.7em;
}

.column > .c {
  flex: none;
}

.column .c-photo .thumb {
  height: 5em;
  flex: none;
}

/* Room for the new card opens as it arrives. */
.grow {
  display: grid;
  flex: none;
  grid-template-rows: 0fr;
  margin-bottom: -0.55em;
  transition:
    grid-template-rows 0.45s ease,
    margin-bottom 0.45s ease;
}

.grow.on {
  grid-template-rows: 1fr;
  margin-bottom: 0;
}

.grow > .c {
  min-height: 0;
}

.grow .thumb {
  height: 4em;
  flex: none;
}

.tabs {
  display: flex;
  align-items: center;
  justify-content: space-around;
  border-top: 1px solid var(--pc-gray-border);
  background: white;
  padding: 0.55em 0.6em 1em;
}

.fab {
  display: grid;
  width: 2.2em;
  height: 2.2em;
  place-items: center;
  border-radius: 50%;
  background: var(--color-pc-500);
  color: white;
  box-shadow: 0 0.4em 0.8em -0.3em rgb(33 130 248 / 0.7);
  transition:
    scale 0.15s ease,
    box-shadow 0.3s ease;
}

.fab.tap {
  scale: 0.88;
  box-shadow: 0 0 0 0.6em rgb(33 130 248 / 0.2);
}

@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}

@keyframes any-spin {
  to {
    rotate: 360deg;
  }
}
</style>
