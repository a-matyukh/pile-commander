<!-- Block 0: the app itself, open on the desktop (the tagline is in the
     header, over the window) — a folder
     in your home folder laid out as a board, with the blocks 1–6 pinned where
     they live. No marketing copy: the blocks are listed plainly, in the
     pinned menu on a wide screen, under the window otherwise. On a computer
     the whole block fits one screen (a MacBook's included): the window takes
     the height that is left. The ways in are in the header. -->
<script setup lang="ts">
import { homeBookmarks, homeTree } from "~/utils/finalFolder";
import type { Crumb } from "./AppWindow.vue";

const crumbs: Crumb[] = [{ glyph: "home" }, { name: "Pictures" }];
const bookmarks = homeBookmarks("board");
const tree = homeTree("board");
</script>

<template>
  <section class="intro">
    <div class="lf-wrap in">
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
        <FinalFolderViews view="board" />
      </FinalAppWindow>
      <!-- Wide screens have the pinned menu (Nav.vue) instead -->
      <FinalLegend class="legend" />
    </div>
  </section>
</template>

<style scoped>
.intro {
  padding: var(--lf-intro-top) 0 var(--lf-section);
}

.in {
  display: flex;
  flex-direction: column;
}

.shot {
  margin-top: 1.5rem;
}

/* The board itself (FolderViews.vue): its own height, or the screen's */
.shot :deep(.fv) {
  --fv-h: 27em;
}

@media (min-width: 1100px) {
  .shot {
    margin-top: 0;
  }

  .legend {
    display: none;
  }
}

/* A wide screen: OS bar, header and window fill one screen; the window
   takes what is left */
@media (min-width: 1100px) and (min-height: 560px) {
  .intro {
    padding-bottom: var(--lf-intro-bottom);
  }

  .in {
    height: calc(var(--lf-screen) - var(--lf-header-h) - var(--lf-intro-top) - var(--lf-intro-bottom));
  }

  .shot {
    flex: 1;
    min-height: 0;
  }

  .shot :deep(.fv) {
    --fv-h: 100%;
  }
}
</style>
