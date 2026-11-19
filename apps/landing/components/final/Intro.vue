<!-- Block 0, the pitch: what Pile Commander is, and the app itself — a folder
     in your home folder laid out as a board, with the blocks 1–6 pinned where
     they live. On a computer the whole block fits one screen (a MacBook's
     included): the window takes the height that is left. The ways in
     (download, the browser) are in the header. -->
<script setup lang="ts">
import type { Crumb, TreeItem } from "./AppWindow.vue";

const crumbs: Crumb[] = [{ glyph: "home" }, { name: "Pictures" }];

const bookmarks: TreeItem[] = [
  { name: "Harbor moodboard", icon: "i-tabler-template", color: "#534ab7", selected: true },
  { name: "Projects" },
  { name: "Downloads", icon: "i-tabler-download" },
];

/* A typical home folder, its standard folders with the app's icons
   (STANDARD_FOLDERS in apps/client/src/store/explorer/folder_cover.ts) */
const tree: TreeItem[] = [
  { name: "Applications", icon: "i-tabler-apps", open: false },
  { name: "Desktop", icon: "i-tabler-device-desktop", open: false },
  { name: "Documents", icon: "i-tabler-file-text", open: false },
  { name: "Downloads", icon: "i-tabler-download", open: false },
  { name: "Library", icon: "i-tabler-building-warehouse", open: false },
  { name: "Movies", icon: "i-tabler-movie", open: false },
  { name: "Music", icon: "i-tabler-music", open: false },
  { name: "Pictures", icon: "i-tabler-photo", open: true },
  { name: "Harbor moodboard", icon: "i-tabler-template", color: "#534ab7", depth: 1, open: true, selected: true },
  { name: "References", icon: "i-tabler-layout-grid", color: "#d4537e", depth: 2 },
  { name: "Projects", open: false },
  { name: "Public", icon: "i-tabler-users", open: false },
];
</script>

<template>
  <section class="intro">
    <div class="lf-wrap in">
      <div class="copy">
        <h1 class="lf-h1 tag">Your files and folders, <span class="em">no longer boring.</span></h1>
        <p class="lf-lede">
          Pile Commander is a file manager for your home folder and the cloud.
          See any folder nine ways, lay it out like a board, and keep every
          file an ordinary file on your disk.
        </p>
      </div>

      <FinalAppWindow
        class="shot"
        :crumbs="crumbs"
        title="Harbor moodboard"
        :bookmarks="bookmarks"
        :tree="tree"
        markers
        fill
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
      <FinalLegend />
    </div>
  </section>
</template>

<style scoped>
.intro {
  padding: clamp(1.25rem, 3vh, 2.5rem) 0 var(--lf-section);
}

.in {
  display: flex;
  flex-direction: column;
}

.copy {
  display: grid;
  justify-items: center;
  gap: 0.875rem;
  text-align: center;
}

/* The tagline in one row on a computer */
.tag {
  font-size: clamp(2.25rem, 3.6vw, 3.5rem);
}

@media (min-width: 900px) {
  .tag {
    white-space: nowrap;
  }
}

.em {
  color: var(--lf-accent);
}

.copy .lf-lede {
  max-width: 46rem;
}

.shot {
  margin-top: clamp(1.25rem, 3vh, 2.25rem);
}

/* A computer: header, copy, window and legend fill one screen; the window
   takes what is left, within reason */
@media (min-width: 761px) and (min-height: 560px) {
  .intro {
    padding-bottom: clamp(1rem, 2.5vh, 2rem);
  }

  .in {
    height: clamp(36rem, calc(100svh - 4rem - clamp(2.25rem, 5.5vh, 4.5rem)), 62rem);
  }

  .shot {
    flex: 1;
    min-height: 0;
  }

  .shot .board {
    height: 100%;
  }
}

/* ── The board (the window scales its own font) ──────── */

.board {
  position: relative;
  height: 27em;
  background: #ebe9e6;
}

.b-title {
  position: absolute;
  top: 0.9em;
  left: 4%;
  margin: 0;
  font-size: 2.1em;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.b-sub {
  position: absolute;
  top: 4.4em;
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
}
</style>
