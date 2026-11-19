<!-- Block 4, sync and cloud folders. A tour like the blocks above, drawn
     after the app: the sync button and its menu (SyncMenu.vue, i18n sync),
     the folder's two copies side by side, the cloud copy in the cloud
     source, and the Cloud page (CloudPage.vue). Facts as LOCAL_SYNC.md and
     the pricing page state them: the desktop app syncs, both ways, while it
     is open, with a free account; Cloud Free is 100 MB, files up to 25 MB. -->
<script setup lang="ts">
import { homeBookmarks, homeTree, type TreeRow } from "~/utils/finalFolder";
import type { Crumb } from "./AppWindow.vue";

type SyncStep = "sync" | "synced" | "both" | "copy" | "cloud";

const localCrumbs: Crumb[] = [{ glyph: "home" }, { name: "Pictures" }];
const cloudCrumbs: Crumb[] = [{ glyph: "cloud" }];

/** The cloud source's tree: the person's cloud folders */
const cloudTree = (selected: boolean): TreeRow[] => [
  { name: "Family trip", icon: "i-tabler-template", color: "#534ab7", open: false },
  { name: "Harbor moodboard", icon: "i-tabler-template", color: "#534ab7", open: false, selected },
  { name: "Recipes", icon: "i-tabler-layout-cards", color: "#d85a30", open: false },
  { name: "Trip to Lisbon", icon: "i-tabler-artboard", color: "#1d9e75", open: false },
];

const steps: { id: SyncStep; label: string; icon: string; caption: string }[] = [
  { id: "sync", label: "Sync with the cloud", icon: "i-tabler-cloud-up", caption: "Press Sync on any folder on your computer, and it gets a copy in the cloud." },
  { id: "synced", label: "Synced", icon: "i-tabler-cloud-check", caption: "Files, names, layout and drawings go both ways between the folder and its copy while the app is open." },
  { id: "both", label: "Both ways", icon: "i-tabler-arrows-exchange", caption: "Change either side, and the other follows. If both change one file, you keep both versions." },
  { id: "copy", label: "Cloud copy", icon: "i-tabler-cloud", caption: "Open the copy on another computer or in a browser: the same folder, board and all." },
  { id: "cloud", label: "Cloud folders", icon: "i-tabler-folders", caption: "Or keep folders only in the cloud. Free: 100 MB, files up to 25 MB." },
];

const step = ref<SyncStep>("sync");
const meta = computed(() => steps.find(s => s.id === step.value)!);
const playing = ref(true);

function pick(id: SyncStep) {
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
const stage = useTemplateRef<HTMLElement>("stage");
/** The one window's height: the stage keeps it while two windows show */
const stageH = ref<number | null>(null);

onMounted(() => {
  const measure = () => {
    const one = stage.value?.querySelector<HTMLElement>(":scope > .shot");
    if (one) stageH.value = Math.round(one.getBoundingClientRect().height);
  };
  measure();
  window.addEventListener("resize", measure);
  onBeforeUnmount(() => window.removeEventListener("resize", measure));

  let visible = false;
  const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; }, { threshold: 0.35 });
  if (root.value) io.observe(root.value);
  const timer = window.setInterval(() => {
    if (visible && playing.value) next();
  }, 4000);
  onBeforeUnmount(() => {
    io.disconnect();
    window.clearInterval(timer);
  });
});

/* The Cloud page's folders, as tiles with their covers */
const cloudFolders = [
  { name: "Family trip", color: "#c9c6f2", icon: "i-tabler-template", tint: "#534ab7" },
  { name: "Harbor moodboard", cover: "/landing-alt2/sea-horizon.jpg" },
  { name: "Recipes", color: "#f6d3c3", icon: "i-tabler-layout-cards", tint: "#d85a30" },
  { name: "Trip to Lisbon", color: "#c8f5d3", icon: "i-tabler-artboard", tint: "#1d9e75" },
  { name: "Lemon studio", cover: "/landing-alt2/lemon-tea.jpg" },
];
</script>

<template>
  <section id="sync" ref="root" class="sec" aria-labelledby="sync-title">
    <div class="lf-wrap">
      <header class="head">
        <span class="lf-marker" aria-hidden="true">4</span>
        <div class="trow">
          <h2 id="sync-title" class="title">Sync</h2>
          <button type="button" class="play" :aria-pressed="playing" @click="toggle">
            <UIcon :name="playing ? 'i-tabler-player-pause' : 'i-tabler-player-play'" class="pi" />
            {{ playing ? "Pause" : "Play" }}
          </button>
          <p class="hint"><UIcon name="i-tabler-pointer" class="pi" />Pick one to see it</p>
        </div>
        <p class="lede">Any folder on your computer can have a copy in the cloud, kept in sync both ways. Desktop app, with a free account.</p>

        <div class="steps" role="group" aria-label="Sync and cloud folders">
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

      <!-- As tall on every step, so the page does not jump on Both ways -->
      <div ref="stage" class="stage" :style="stageH ? { minHeight: `${stageH}px` } : undefined">
      <!-- Both ways: the folder on disk and its cloud copy, side by side -->
      <div v-if="step === 'both'" class="pair">
        <div class="side">
          <p class="where"><span class="hm">~</span> On this computer</p>
          <FinalAppWindow
            class="shot half"
            :crumbs="localCrumbs"
            title="Harbor moodboard"
            :bookmarks="homeBookmarks('board')"
            :tree="homeTree('board')"
          >
            <FinalFolderViews view="board" />
            <span class="newmark">New</span>
          </FinalAppWindow>
        </div>
        <span class="swap" aria-hidden="true"><UIcon name="i-tabler-arrows-exchange" class="swi" /></span>
        <div class="side">
          <p class="where"><UIcon name="i-tabler-cloud" class="wi" /> In the cloud</p>
          <FinalAppWindow
            class="shot half"
            :crumbs="cloudCrumbs"
            title="Harbor moodboard"
            :tree="cloudTree(true)"
            drive="cloud"
          >
            <FinalFolderViews view="board" />
            <span class="newmark">New</span>
          </FinalAppWindow>
        </div>
      </div>

      <FinalAppWindow
        v-else
        class="shot"
        :crumbs="step === 'cloud' ? [] : step === 'copy' ? cloudCrumbs : localCrumbs"
        :title="step === 'cloud' ? 'Cloud' : 'Harbor moodboard'"
        :bookmarks="homeBookmarks('board')"
        :tree="step === 'copy' || step === 'cloud' ? cloudTree(step === 'copy') : homeTree('board')"
        :drive="step === 'copy' || step === 'cloud' ? 'cloud' : 'local'"
        :markers="step === 'cloud' ? [] : [4]"
        :actions="step !== 'cloud'"
        :sync-icon="step === 'sync' ? 'i-tabler-cloud-up' : 'i-tabler-cloud-check'"
        :open="step === 'sync' || step === 'synced' ? 'sync' : null"
      >
        <!-- The Cloud page: a button, then the cloud folders as tiles -->
        <div v-if="step === 'cloud'" class="cloudpage">
          <span class="cbtn"><UIcon name="i-tabler-folder-plus" class="cbi" />New folder</span>
          <div class="tiles">
            <div v-for="f in cloudFolders" :key="f.name" class="tile">
              <div v-if="f.cover" class="tpic"><img :src="f.cover" alt=""><span class="tcap">{{ f.name }}</span></div>
              <div v-else class="tfold">
                <span class="ttab" :style="{ background: f.color }" />
                <span class="tbody" :style="{ background: f.color }"><UIcon :name="f.icon!" class="tfi" :style="{ color: f.tint }" />{{ f.name }}</span>
              </div>
            </div>
          </div>
        </div>
        <FinalFolderViews v-else view="board" />

        <template #over>
          <!-- The sync menu under its button: sync is followed by share and more -->
          <div v-if="step === 'sync'" class="am smenu">
            <div class="am-h">Only on this computer</div>
            <div class="am-i"><UIcon name="i-tabler-cloud-plus" class="am-ic" />Copy to cloud</div>
            <div class="am-i hl"><UIcon name="i-tabler-cloud-up" class="am-ic" />Sync with the cloud</div>
          </div>
          <div v-if="step === 'synced'" class="am smenu">
            <div class="sst">
              <p class="stt">Synced</p>
              <p class="smu">Last synced just now</p>
              <p class="smu">Changes go both ways between this folder and its copy while the app is open.</p>
            </div>
            <div class="am-sep" />
            <div class="am-i"><UIcon name="i-tabler-refresh" class="am-ic" />Sync now</div>
            <div class="am-i"><UIcon name="i-tabler-cloud" class="am-ic" />Open cloud copy</div>
            <div class="am-i"><UIcon name="i-tabler-cloud-off" class="am-ic" />Stop syncing</div>
          </div>
        </template>
      </FinalAppWindow>
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

.shot :deep(.fv) {
  --fv-h: 32em;
}

/* The sync menu: 300px; sync is followed by share and more */
.smenu {
  position: absolute;
  top: 3.25em;
  right: calc(1.25em + 2 * 2.6em);
  z-index: 3;
  width: 23em;
}

.sst {
  display: flex;
  flex-direction: column;
  gap: 0.46em;
  padding: 0.46em 0.62em;
  font-size: 0.92em;
  line-height: 1.4;
}

.sst p {
  margin: 0;
}

.stt {
  font-size: 1.08em;
  font-weight: 600;
}

.smu {
  color: #9a9893;
}

/* ── Both ways: two windows ──────────────────────────── */

.stage {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 0.75rem;
}

/* A phone: one copy above the other */
@media (max-width: 760px) {
  .pair {
    grid-template-columns: minmax(0, 1fr);
    justify-items: center;
  }

  .pair .side {
    width: 100%;
  }

  .swap {
    rotate: 90deg;
  }
}

.where {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin: 0 0 0.5rem;
  color: var(--lf-ink-2);
  font-size: 0.9375rem;
}

.hm {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.wi {
  width: 1.1rem;
  height: 1.1rem;
}

.half :deep(.fv) {
  --fv-h: 26em;
}

.swap {
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  place-items: center;
  border: 1px solid var(--lf-line-strong);
  border-radius: 50%;
  background: var(--lf-surface);
  color: var(--lf-accent);
}

.swi {
  width: 1.25rem;
  height: 1.25rem;
}

/* The picture just added, the same in both copies */
.newmark {
  position: absolute;
  top: 9%;
  left: 59%;
  z-index: 2;
  border-radius: 99em;
  background: #2453ff;
  padding: 0.15em 0.6em;
  color: #fff;
  font-size: 0.85em;
  font-weight: 600;
}

/* ── The Cloud page ──────────────────────────────────── */

.cloudpage {
  height: 32em;
  box-sizing: border-box;
  background: #fff;
  padding: 1.2em 1.4em;
}

.cbtn {
  display: inline-flex;
  height: 2.46em;
  align-items: center;
  gap: 0.46em;
  border: 1px solid rgb(0 0 0 / 0.15);
  border-radius: 0.54em;
  padding: 0 1em;
  font-weight: 500;
}

.cbi {
  width: 1.23em;
  height: 1.23em;
}

.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, 9.5em);
  gap: 1.2em;
  margin-top: 1.4em;
}

.tile {
  width: 9.5em;
}

.tpic {
  position: relative;
  height: 9.5em;
  overflow: hidden;
  border-radius: 0.5em;
}

.tpic img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tcap {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  background: linear-gradient(to top, rgb(0 0 0 / 0.62), transparent);
  padding: 1.6em 0.5em 0.5em;
  color: #fff;
  font-size: 0.92em;
  text-align: center;
}

.tfold {
  display: flex;
  height: 9.5em;
  flex-direction: column;
  padding-top: 0.6em;
}

.ttab {
  display: block;
  width: 42%;
  height: 0.9em;
  border-radius: 0.4em 0.4em 0 0;
}

.tbody {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.45em;
  border-radius: 0 0.5em 0.5em;
  font-size: 0.95em;
  text-align: center;
}

.tfi {
  width: 1.3em;
  height: 1.3em;
}
</style>
