<!-- Block 7, your files stay yours. No marker: it is about where things live,
     not a place in the window. Beside the app stands an ordinary file window
     on the same folder (generic, no OS's own look): the files were plain
     files all along. Delete the app and they are unchanged; install it again
     and the board is back, because views and places live in the files' own
     attributes and drawings in the hidden .pile folder (README.md, local.ts;
     as /alt2 states it). The cloud step says what the home page says
     (WhereItLives.vue): a private B2 bucket, AES-256 at rest, short-lived
     signed links, thumbnails for anonymous visitors of a public folder. -->
<script setup lang="ts">
import { FOLDER_ITEMS, homeBookmarks, homeTree } from "~/utils/finalFolder";
import type { Crumb } from "./AppWindow.vue";

type YoursStep = "files" | "deleted" | "back" | "cloud";

const crumbs: Crumb[] = [{ glyph: "home" }, { name: "Pictures" }];

const steps: { id: YoursStep; label: string; icon: string; caption: string }[] = [
  { id: "files", label: "Plain files", icon: "i-tabler-files", caption: "On your computer the app opens real folders. A note is a .md file, a picture is a picture." },
  { id: "deleted", label: "Delete the app", icon: "i-tabler-trash", caption: "Delete Pile Commander, and every file stays where it was. Nothing to export, nothing locked in." },
  { id: "back", label: "Install it again", icon: "i-tabler-download", caption: "Views and places live in the files' own attributes and a small hidden .pile folder, so every board comes back as it was." },
  { id: "cloud", label: "In the cloud", icon: "i-tabler-lock", caption: "Cloud copies sit in a private Backblaze B2 bucket, encrypted at rest, and open through short-lived signed links." },
];

const step = ref<YoursStep>("files");
const meta = computed(() => steps.find(s => s.id === step.value)!);
const playing = ref(true);

function pick(id: YoursStep) {
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
  }, 4000);
  onBeforeUnmount(() => {
    io.disconnect();
    window.clearInterval(timer);
  });
});

const kinds: Record<string, string> = { folder: "Folder", image: "JPEG image", text: "Markdown" };
</script>

<template>
  <section id="yours" ref="root" class="sec" aria-labelledby="yours-title">
    <div class="lf-wrap">
      <header class="head">
        <span class="lf-marker" aria-hidden="true">7</span>
        <div class="trow">
          <h2 id="yours-title" class="title">Your files stay yours</h2>
          <button type="button" class="play" :aria-pressed="playing" @click="toggle">
            <UIcon :name="playing ? 'i-tabler-player-pause' : 'i-tabler-player-play'" class="pi" />
            {{ playing ? "Pause" : "Play" }}
          </button>
          <p class="hint"><UIcon name="i-tabler-pointer" class="pi" />Pick one to see it</p>
        </div>
        <p class="lede">On your disk, files stay ordinary files, with the app or without it. In the cloud, they stay private.</p>

        <div class="steps" role="group" aria-label="Where your files live">
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

      <div class="pair">
        <!-- The app, or the place where it was -->
        <div class="slot">
          <p class="label">
            <img src="/app-icon.png" alt="" class="li">
            {{ step === 'deleted' ? "Pile Commander: deleted" : step === 'cloud' ? "Pile Commander, the cloud copy" : "Pile Commander" }}
          </p>
          <div v-if="step === 'deleted'" class="gone">
            <span class="bin"><UIcon name="i-tabler-trash" class="bi" /></span>
            <img src="/app-icon.png" alt="" class="gi">
          </div>
          <FinalAppWindow
            v-else
            class="shot"
            fill
            :crumbs="step === 'cloud' ? [{ glyph: 'cloud' }] : crumbs"
            title="Harbor moodboard"
            :bookmarks="homeBookmarks('board')"
            :tree="homeTree('board')"
            :drive="step === 'cloud' ? 'cloud' : 'local'"
          >
            <FinalFolderViews view="board" />
            <span v-if="step === 'back'" class="backmark"><UIcon name="i-tabler-circle-check" class="bm" />Every card where you left it</span>
          </FinalAppWindow>
        </div>

        <!-- An ordinary file window on the same folder, or the cloud's storage -->
        <div class="slot">
          <p class="label">
            <UIcon :name="step === 'cloud' ? 'i-tabler-cloud-lock' : 'i-tabler-folder'" class="lic" />
            {{ step === 'cloud' ? "Where the cloud copy lives" : "Any file manager" }}
          </p>

          <div v-if="step !== 'cloud'" class="os">
            <div class="osbar">
              <span class="dots"><i /><i /><i /></span>
              <span class="ost"><UIcon name="i-tabler-folder" class="oi" />Harbor moodboard</span>
            </div>
            <p class="ospath">~/Pictures/Harbor moodboard</p>
            <div class="oshead"><span>Name</span><span>Kind</span><span>Size</span></div>
            <ul class="oslist">
              <li v-for="f in FOLDER_ITEMS" :key="f.name">
                <span class="nm"><UIcon :name="f.kind === 'folder' ? 'i-tabler-folder' : f.kind === 'image' ? 'i-tabler-photo' : 'i-tabler-file-text'" class="oi" />{{ f.name }}</span>
                <span class="k">{{ kinds[f.kind] }}</span>
                <span class="sz">{{ f.size }}</span>
              </li>
              <li class="hidden">
                <span class="nm"><UIcon name="i-tabler-folder" class="oi" />.pile</span>
                <span class="k">Hidden folder</span>
                <span class="sz">8 KB</span>
              </li>
            </ul>
            <p class="osnote" :class="{ lit: step === 'deleted' }">
              <UIcon name="i-tabler-circle-check" class="oi" />
              {{ step === 'deleted' ? "Nothing changed" : "The same files the app shows" }}
            </p>
          </div>

          <div v-else class="vault">
            <span class="lock"><UIcon name="i-tabler-lock" class="lk" /></span>
            <p class="vt">Backblaze B2</p>
            <ul class="vl">
              <li><UIcon name="i-tabler-shield-lock" class="vi" />A private bucket, encrypted at rest with AES-256</li>
              <li><UIcon name="i-tabler-link" class="vi" />The app opens files through short-lived signed links</li>
              <li><UIcon name="i-tabler-photo" class="vi" />Visitors to a public folder see thumbnails, not your originals</li>
              <li><UIcon name="i-tabler-device-desktop" class="vi" />Files that stay on your computer never go there</li>
              <li><UIcon name="i-tabler-key" class="vi" />Bookmarks, settings and AI keys stay on your device</li>
            </ul>
            <a href="https://www.backblaze.com/blog/backblaze-b2-to-encrypt-new-uploads-by-default/" target="_blank" rel="noopener noreferrer" class="vlink">How Backblaze encrypts files at rest</a>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sec {
  padding: var(--lf-section) 0 var(--lf-section);
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

/* ── Two slots side by side, one height on every step ── */

.pair {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: 1.5rem;
}

@media (max-width: 900px) {
  .pair {
    grid-template-columns: minmax(0, 1fr);
  }
}

.slot {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.625rem;
  color: var(--lf-ink-2);
  font-size: 0.9375rem;
}

.li {
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 22.5%;
}

.lic {
  width: 1.25rem;
  height: 1.25rem;
}

.shot :deep(.fv) {
  --fv-h: 100%;
}

.slot > .shot,
.gone,
.os,
.vault {
  flex: 1;
  min-height: 24rem;
}

/* The app deleted: an empty place, its icon over the bin */
.gone {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 0.5rem;
  border: 2px dashed var(--lf-line-strong);
  border-radius: 12px;
}

.bin {
  display: grid;
  width: 4rem;
  height: 4rem;
  place-items: center;
  border-radius: 50%;
  background: var(--lf-surface);
  color: var(--lf-ink-3);
}

.bi {
  width: 2rem;
  height: 2rem;
}

.gi {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 22.5%;
  opacity: 0.35;
  filter: grayscale(1);
}

.backmark {
  position: absolute;
  top: 0.8em;
  right: 0.8em;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  border-radius: 99em;
  background: #eaf3de;
  padding: 0.3em 0.8em;
  color: #3b6d11;
  font-weight: 500;
}

.bm {
  width: 1.15em;
  height: 1.15em;
}

/* ── An ordinary file window (no OS's own look) ──────── */

.os {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--lf-line-strong);
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 24px 60px -24px rgb(0 0 0 / 0.22);
  font-size: 0.875rem;
}

.osbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  border-bottom: 1px solid var(--lf-line);
  background: #f4f4f3;
  padding: 0.55rem 0.75rem;
}

.dots {
  display: flex;
  gap: 0.35rem;
}

.dots i {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 50%;
  background: rgb(0 0 0 / 0.18);
}

.ost {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-weight: 600;
}

.oi {
  width: 1rem;
  height: 1rem;
  flex: none;
  color: var(--lf-ink-3);
}

.ospath {
  margin: 0;
  border-bottom: 1px solid var(--lf-line);
  padding: 0.4rem 0.75rem;
  color: var(--lf-ink-3);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8125rem;
}

.oshead,
.oslist li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 6.5rem 4.5rem;
  gap: 0.5rem;
  align-items: center;
  padding: 0.35rem 0.75rem;
}

.oshead {
  border-bottom: 1px solid var(--lf-line);
  color: var(--lf-ink-3);
  font-size: 0.75rem;
}

.oslist {
  flex: 1;
  margin: 0;
  padding: 0;
  list-style: none;
}

.oslist li + li {
  border-top: 1px solid rgb(0 0 0 / 0.04);
}

.nm {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.45rem;
  overflow: hidden;
  white-space: nowrap;
}

.k,
.sz {
  color: var(--lf-ink-3);
  font-size: 0.8125rem;
}

.sz {
  text-align: right;
}

.hidden {
  opacity: 0.5;
}

.osnote {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  border-top: 1px solid var(--lf-line);
  padding: 0.55rem 0.75rem;
  color: var(--lf-ink-2);
}

.osnote.lit {
  background: #eaf3de;
  color: #3b6d11;
  font-weight: 500;
}

.osnote.lit .oi {
  color: inherit;
}

/* ── The cloud's storage ─────────────────────────────── */

.vault {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.75rem;
  border: 1px solid var(--lf-line-strong);
  border-radius: 12px;
  background: #fff;
  padding: 1.5rem;
}

.lock {
  display: grid;
  width: 3rem;
  height: 3rem;
  place-items: center;
  border-radius: 50%;
  background: #eaf3de;
  color: #3b6d11;
}

.lk {
  width: 1.5rem;
  height: 1.5rem;
}

.vt {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
}

.vl {
  display: grid;
  gap: 0.6rem;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--lf-ink-2);
}

.vl li {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  line-height: 1.4;
}

.vlink {
  color: var(--lf-accent);
  font-size: 0.9375rem;
  text-decoration: none;
}

.vlink:hover {
  text-decoration: underline;
}

.vi {
  width: 1.15rem;
  height: 1.15rem;
  flex: none;
  margin-top: 0.1rem;
  color: var(--lf-ink);
}
</style>
