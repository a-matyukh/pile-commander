<!-- Block 0, the pitch: what Pile Commander is, the two ways in, and the app
     itself — a folder in your home folder, laid out as a board. -->
<script setup lang="ts">
import type { Crumb, TreeItem } from "./AppWindow.vue";

const { demoUrl } = useAppLinks();
const { os, downloadLabel } = useDownloadCta();

const external = { target: "_blank", rel: "noopener noreferrer" };

const crumbs: Crumb[] = [{ glyph: "home" }, { name: "Pictures" }];

const bookmarks: TreeItem[] = [
  { name: "Harbor moodboard", icon: "i-tabler-template", color: "#534ab7", selected: true },
  { name: "Projects" },
  { name: "Downloads" },
];

const tree: TreeItem[] = [
  { name: "Documents", open: false },
  { name: "Pictures", open: true },
  { name: "Harbor moodboard", icon: "i-tabler-template", color: "#534ab7", depth: 1, open: true, selected: true },
  { name: "References", icon: "i-tabler-layout-grid", color: "#d4537e", depth: 2 },
  { name: "Recipes", icon: "i-tabler-layout-cards", color: "#d85a30", depth: 1, open: false },
  { name: "Trip to Lisbon", icon: "i-tabler-artboard", color: "#1d9e75", depth: 1, open: false },
  { name: "Projects", open: false },
];
</script>

<template>
  <section class="intro">
    <div class="lf-wrap">
      <div class="copy">
        <h1 class="lf-h1">
          Your files and folders,<br>
          <span class="em">no longer boring.</span>
        </h1>
        <p class="lf-lede">
          Pile Commander is a file manager for your home folder and the cloud.
          See any folder nine ways, lay it out like a board, and keep every
          file an ordinary file on your disk.
        </p>

        <!-- A phone cannot run the desktop app: the web demo leads there -->
        <div class="actions">
          <template v-if="os === 'mobile'">
            <a :href="demoUrl" v-bind="external" class="lf-btn lf-btn-primary">Try it in the browser</a>
            <NuxtLink to="/download" class="lf-btn lf-btn-secondary">Get the desktop app</NuxtLink>
          </template>
          <template v-else>
            <NuxtLink to="/download" class="lf-btn lf-btn-primary">
              <UIcon name="i-lucide-download" class="size-[1.1em]" />
              {{ downloadLabel }}
            </NuxtLink>
            <a :href="demoUrl" v-bind="external" class="lf-btn lf-btn-secondary">Try it in the browser</a>
          </template>
        </div>
        <p class="lf-small">Free on your computer · No account · macOS, Windows, Linux and the web</p>
      </div>

      <FinalAppWindow
        class="shot"
        :crumbs="crumbs"
        title="Harbor moodboard"
        :bookmarks="bookmarks"
        :tree="tree"
        label="The Pile Commander window: the folder ~/Pictures/Harbor moodboard laid out as a board, with photos, a note and a folder."
      >
        <div class="board">
          <p class="b-title">Coastal summer</p>
          <p class="b-sub">Brand refresh · sun, salty air, fresh fruit</p>
          <img src="/landing-alt2/sea-horizon.jpg" alt="" class="card c-sea" width="520" height="346">
          <img src="/landing-alt2/lemon-tea.jpg" alt="" class="card c-tea" width="416" height="520">
          <img src="/landing-alt2/pink-blossom.jpg" alt="" class="card c-blossom" width="416" height="520">
          <div class="card c-note">
            <p>Warm light, salty air. One object on the table.</p>
            <span>Mood.md</span>
          </div>
          <img src="/landing-alt2/raspberries.jpg" alt="" class="card c-rasp" width="520" height="520">
          <div class="card c-folder">
            <span class="tab" />
            <span class="fbody"><UIcon name="i-tabler-layout-grid" class="fi" />References</span>
          </div>
          <img src="/landing-alt2/jellyfish.jpg" alt="" class="card c-jelly" width="416" height="520">
        </div>
      </FinalAppWindow>
    </div>
  </section>
</template>

<style scoped>
.intro {
  padding: clamp(2.5rem, 6vw, 5.5rem) 0 var(--lf-section);
}

.copy {
  display: grid;
  justify-items: center;
  gap: 1.5rem;
  text-align: center;
}

.copy .lf-lede {
  margin-top: -0.25rem;
}

.em {
  color: var(--lf-accent);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.shot {
  margin-top: clamp(2.5rem, 5vw, 4rem);
}

/* ── The board (the window scales its own font) ──────── */

.board {
  position: relative;
  height: 33em;
  background: #ebe9e6;
}

.b-title {
  position: absolute;
  top: 6%;
  left: 4%;
  margin: 0;
  font-size: 2.1em;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.b-sub {
  position: absolute;
  top: 17%;
  left: 4%;
  margin: 0;
  color: #5f5e5a;
  font-size: 1.05em;
}

.card {
  position: absolute;
  display: block;
  height: auto;
  object-fit: cover;
}

.c-sea { top: 27%; left: 4%; width: 33%; aspect-ratio: 520 / 346; }
.c-tea { top: 11%; left: 40%; width: 15%; aspect-ratio: 4 / 5; }
.c-blossom { top: 24%; left: 58%; width: 14%; aspect-ratio: 4 / 5; }
.c-rasp { top: 62%; left: 40%; width: 11%; aspect-ratio: 1; }
.c-jelly { top: 42%; left: 77%; width: 12%; aspect-ratio: 4 / 5; }

.c-note {
  top: 10%;
  left: 75.5%;
  width: 20%;
  box-sizing: border-box;
  border: 1px solid rgb(0 0 0 / 0.08);
  background: #fff;
  padding: 0.9em 1em 0.75em;
}

.c-note p {
  margin: 0;
  font-size: 1.05em;
  line-height: 1.4;
}

.c-note span {
  display: block;
  margin-top: 0.7em;
  color: #9a9893;
  font-size: 0.85em;
}

.c-folder { top: 66%; left: 54%; width: 14%; }

.c-folder .tab {
  display: block;
  width: 42%;
  height: 0.9em;
  border-radius: 0.4em 0.4em 0 0;
  background: #f2cad8;
}

.c-folder .fbody {
  display: flex;
  height: 5.6em;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.45em;
  border-radius: 0 0.5em 0.5em;
  background: #f2cad8;
  font-size: 0.95em;
}

.fi {
  width: 1.3em;
  height: 1.3em;
  color: #d4537e;
}

/* Narrow: fewer cards, bigger */
@container (max-width: 760px) {
  .board { height: 27em; }
  .c-sea { top: 34%; width: 50%; }
  .c-tea { top: 12%; left: 58%; width: 22%; }
  .c-note { top: 60%; left: 58%; width: 36%; }
  .c-blossom, .c-rasp, .c-folder, .c-jelly, .b-sub { display: none; }
  .b-title { top: 9%; }
}
</style>
