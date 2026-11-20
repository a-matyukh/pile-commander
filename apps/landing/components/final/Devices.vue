<!-- Block 6, any screen. The same folder in the desktop app, in a browser, on
     a tablet and on a phone. Facts as /alt2 states them, checked against the
     app (ExplorerShell.vue, TopBar.vue): the desktop app on macOS, Windows
     and Linux; tablets and phones use the web app in the browser, with cloud
     folders; 640px and wider keep the sidebar, a phone keeps it in a drawer
     that slides in from the edge; a canvas pinches to zoom. The stage keeps
     one height on every step, so the page does not jump. -->
<script setup lang="ts">
import { homeBookmarks, homeTree, type TreeRow } from "~/utils/finalFolder";
import type { Crumb } from "./AppWindow.vue";

type ScreenStep = "desktop" | "browser" | "tablet" | "phone";

const localCrumbs: Crumb[] = [{ glyph: "home" }, { name: "Pictures" }];
const cloudCrumbs: Crumb[] = [{ glyph: "cloud" }];
/** The web app has no disk: its own folders live in the browser's storage */
const browserCrumbs: Crumb[] = [{ glyph: "browser" }];

const cloudTree: TreeRow[] = [
  { name: "Family trip", icon: "i-tabler-template", color: "#534ab7", open: false },
  { name: "Harbor moodboard", icon: "i-tabler-template", color: "#534ab7", open: false, selected: true },
  { name: "Recipes", icon: "i-tabler-layout-cards", color: "#d85a30", open: false },
  { name: "Trip to Lisbon", icon: "i-tabler-artboard", color: "#1d9e75", open: false },
];

const steps: { id: ScreenStep; label: string; icon: string; caption: string }[] = [
  { id: "desktop", label: "Desktop app", icon: "i-tabler-device-desktop", caption: "macOS, Windows and Linux. Folders on your disk and sync live here." },
  { id: "browser", label: "In the browser", icon: "i-tabler-browser", caption: "Nothing to install. The browser cannot open your disk, so its folders live in its own storage (IndexedDB), and your cloud folders are one click away." },
  { id: "tablet", label: "Tablet", icon: "i-tabler-device-ipad-horizontal", caption: "On a tablet the sidebar stays beside the folder, and everything works by touch." },
  { id: "phone", label: "Phone", icon: "i-tabler-device-mobile", caption: "On a phone the sidebar slides in from the edge, menus fit the screen, and you pinch to zoom a canvas." },
];

const step = ref<ScreenStep>("desktop");
const meta = computed(() => steps.find(s => s.id === step.value)!);
const playing = ref(true);

function pick(id: ScreenStep) {
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
</script>

<template>
  <section id="screens" ref="root" class="sec" aria-labelledby="screens-title">
    <div class="lf-wrap">
      <header class="head">
        <span class="lf-marker" aria-hidden="true">6</span>
        <div class="trow">
          <h2 id="screens-title" class="title">Any screen</h2>
          <button type="button" class="play" :aria-pressed="playing" @click="toggle">
            <UIcon :name="playing ? 'i-tabler-player-pause' : 'i-tabler-player-play'" class="pi" />
            {{ playing ? "Pause" : "Play" }}
          </button>
          <p class="hint"><UIcon name="i-tabler-pointer" class="pi" />Pick one to see it</p>
        </div>
        <p class="lede">The same folder on a computer, a tablet or a phone, in the app or just in a browser.</p>

        <div class="steps" role="group" aria-label="Screens">
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

      <div class="stage">
        <!-- The desktop app: the window as everywhere on the page -->
        <FinalAppWindow
          v-if="step === 'desktop'"
          class="dev desk"
          fill
          :crumbs="localCrumbs"
          title="Harbor moodboard"
          :bookmarks="homeBookmarks('board')"
          :tree="homeTree('board')"
          :markers="[6]"
        >
          <FinalFolderViews view="board" />
        </FinalAppWindow>

        <!-- In the browser: the web app in a browser's window -->
        <div v-else-if="step === 'browser'" class="dev browser">
          <div class="bchrome">
            <span class="bdots"><span /><span /><span /></span>
            <span class="btab"><img src="/app-icon.png" alt="" class="bfav">Pile Commander</span>
            <span class="baddr"><UIcon name="i-tabler-lock" class="bli" />pile-commander.app</span>
          </div>
          <FinalAppWindow
            class="bare"
            fill
            web
            :crumbs="browserCrumbs"
            title="Harbor moodboard"
            :tree="cloudTree"
            drive="local"
          >
            <FinalFolderViews view="board" />
          </FinalAppWindow>
        </div>

        <!-- A tablet in landscape: the web app with its sidebar -->
        <div v-else-if="step === 'tablet'" class="dev tablet">
          <div class="screen">
            <FinalAppWindow
              class="bare"
              fill
              keep-sidebar
              web
              :crumbs="cloudCrumbs"
              title="Harbor moodboard"
              :tree="cloudTree"
              drive="cloud"
            >
              <FinalFolderViews view="board" />
            </FinalAppWindow>
          </div>
        </div>

        <!-- A phone: the sidebar in a drawer, the board scrolls -->
        <div v-else class="dev phone">
          <div class="screen">
            <FinalAppWindow
              class="bare"
              fill
              web
              :crumbs="cloudCrumbs"
              title="Harbor moodboard"
              drive="cloud"
            >
              <FinalFolderViews view="board" />
            </FinalAppWindow>
            <span class="pinch" aria-hidden="true"><span class="f f1" /><span class="f f2" /></span>
          </div>
        </div>
      </div>
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

.lede,
.caption {
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

/* One height on every step; each device centred in it */
.stage {
  display: flex;
  height: clamp(24rem, 52vw, 34rem);
  align-items: center;
  justify-content: center;
}

.dev :deep(.fv) {
  --fv-h: 100%;
}

.desk {
  width: 100%;
  height: 100%;
}

/* A window inside a device: the device is the frame */
.bare :deep(.lf-frame) {
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

/* ── The browser ─────────────────────────────────────── */

.browser {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--lf-line-strong);
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 24px 60px -24px rgb(0 0 0 / 0.22);
}

.browser .bare {
  flex: 1;
  min-height: 0;
}

.bchrome {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  border-bottom: 1px solid var(--lf-line);
  background: #e9e9e7;
  padding: 0.5rem 0.75rem;
  font-size: 0.8125rem;
}

.bdots {
  display: flex;
  gap: 0.375rem;
}

.bdots span {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 50%;
  background: rgb(0 0 0 / 0.18);
}

.btab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border-radius: 8px;
  background: #fff;
  padding: 0.3rem 0.75rem;
}

.bfav {
  width: 1rem;
  height: 1rem;
  border-radius: 22.5%;
}

.baddr {
  display: inline-flex;
  flex: 1;
  align-items: center;
  gap: 0.375rem;
  max-width: 28rem;
  border-radius: 99em;
  background: #fff;
  padding: 0.3rem 0.75rem;
  color: var(--lf-ink-2);
}

.bli {
  width: 0.9rem;
  height: 0.9rem;
}

/* ── The tablet and the phone: a dark bezel, the screen inside ── */

.tablet,
.phone {
  box-sizing: border-box;
  background: #1f1f1e;
  box-shadow: 0 24px 60px -24px rgb(0 0 0 / 0.35);
}

.tablet {
  height: 100%;
  aspect-ratio: 4 / 3;
  max-width: 100%;
  border-radius: 1.75rem;
  padding: 1rem;
}

.phone {
  height: 100%;
  aspect-ratio: 9 / 19;
  border-radius: 2.25rem;
  padding: 0.6rem;
}

.screen {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 0.75rem;
  background: #fff;
}

.phone .screen {
  border-radius: 1.75rem;
}

.screen .bare {
  height: 100%;
}

/* Two fingers pinching on the phone's board */
.pinch {
  position: absolute;
  top: 58%;
  left: 50%;
  width: 0;
  height: 0;
}

.f {
  position: absolute;
  width: 2.4rem;
  height: 2.4rem;
  border: 2px solid rgb(255 255 255 / 0.9);
  border-radius: 50%;
  background: rgb(36 83 255 / 0.35);
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.25);
  translate: -50% -50%;
}

.f1 { left: -2.4rem; top: -2.4rem; }
.f2 { left: 2.4rem; top: 2.4rem; }

@media (prefers-reduced-motion: no-preference) {
  .f1 { animation: pinch1 1.6s ease-in-out infinite alternate; }
  .f2 { animation: pinch2 1.6s ease-in-out infinite alternate; }
}

@keyframes pinch1 { to { left: -1rem; top: -1rem; } }
@keyframes pinch2 { to { left: 1rem; top: 1rem; } }
</style>
