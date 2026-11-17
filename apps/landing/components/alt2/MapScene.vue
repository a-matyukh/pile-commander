<!-- The hero's map: the desktop app's window with a folder on a board, and
     the page's six ideas pinned to where they live in the app. The folder
     header's buttons are in the app's order for a folder of your own
     (FolderActions.vue): view, add, layers, AI, share, sync, more. Its
     background lives in the ⋯ menu since 2.8. ① the view, ② AI, ③ sync,
     ④ share, ⑤ the window itself (any screen), ⑥ the folder's path on disk.
     The window keeps the app's own palette: it is a picture of the product.
     On a narrow screen it zooms into the folder: the sidebar and the
     bookmarks leave, the buttons get a row of their own. -->
<script setup lang="ts">
import { alt2Ideas as ideas } from "~/utils/alt2Ideas";

/** The idea under the pointer or keyboard focus, on the map and in the legend */
const active = ref<number | null>(null);

function go(n: number) {
  const idea = ideas.find(i => i.n === n);
  if (idea) location.hash = `#${idea.id}`;
}
</script>

<template>
  <div class="mapw">
    <div
      class="a2-frame shot"
      :data-active="active ?? undefined"
      role="img"
      aria-label="The Pile Commander window: a folder called Harbor moodboard laid out as a board, with photos and a note. Numbers mark where the view, AI, sync and sharing live in the folder's header, the window itself, and the folder's path on disk."
    >
      <div class="win">
        <div class="topbar">
          <span class="tb"><UIcon name="i-tabler-layout-sidebar" class="ic" /></span>
          <span class="tb"><UIcon name="i-tabler-chevron-left" class="ic" /></span>
          <span class="tb"><UIcon name="i-tabler-chevron-right" class="ic" /></span>
          <span class="sep" />
          <span class="tb"><UIcon name="i-tabler-arrow-back-up" class="ic" /></span>
          <span class="tb"><UIcon name="i-tabler-arrow-forward-up" class="ic" /></span>
          <span class="sep" />
          <span class="bms">
            <span class="bm"><UIcon name="i-tabler-template" class="ic v-board" />Harbor moodboard</span>
            <span class="bm"><UIcon name="i-tabler-folder" class="ic" />Projects</span>
            <span class="bm"><UIcon name="i-tabler-folder" class="ic" />Downloads</span>
          </span>
        </div>

        <div class="body">
          <aside class="side">
            <div class="drives">
              <span class="dr on"><UIcon name="i-tabler-device-desktop" class="ic" /></span>
              <span class="dr"><UIcon name="i-tabler-cloud" class="ic" /></span>
              <span class="dr"><UIcon name="i-tabler-world" class="ic" /></span>
            </div>
            <!-- Each folder shows the icon of its own view -->
            <ul class="tree">
              <li><UIcon name="i-tabler-chevron-right" class="ic tw" /><UIcon name="i-tabler-folder" class="ic fi" />Clients</li>
              <li class="sel"><UIcon name="i-tabler-chevron-down" class="ic tw" /><UIcon name="i-tabler-template" class="ic fi v-board" />Harbor moodboard</li>
              <li class="sub"><span class="tw" /><UIcon name="i-tabler-layout-grid" class="ic fi v-gallery" />References</li>
              <li><UIcon name="i-tabler-chevron-right" class="ic tw" /><UIcon name="i-tabler-layout-cards" class="ic fi v-masonry" />Recipes</li>
              <li><UIcon name="i-tabler-chevron-right" class="ic tw" /><UIcon name="i-tabler-artboard" class="ic fi v-canvas" />Trip to Lisbon</li>
            </ul>
          </aside>

          <div class="main">
            <div class="fh">
              <div class="where">
                <span class="crumbs" data-anchor="6">
                  <UIcon name="i-tabler-home" class="ic" />
                  <UIcon name="i-tabler-chevron-right" class="ic chev" />
                  Pictures
                  <i class="a2-marker mk mk-side" data-n="6" style="--i: 6" @mouseenter="active = 6" @mouseleave="active = null" @click="go(6)">6</i>
                </span>
                <span class="name">Harbor moodboard</span>
              </div>

              <div class="acts">
                <span class="act" data-anchor="1">
                  <UIcon name="i-tabler-template" class="ic v-board" />
                  <i class="a2-marker mk" data-n="1" style="--i: 1" @mouseenter="active = 1" @mouseleave="active = null" @click="go(1)">1</i>
                </span>
                <span class="act"><UIcon name="i-tabler-plus" class="ic" /></span>
                <span class="act"><UIcon name="i-tabler-stack-2" class="ic" /></span>
                <span class="act" data-anchor="2">
                  <UIcon name="i-lucide-sparkles" class="ic" />
                  <i class="a2-marker mk" data-n="2" style="--i: 2" @mouseenter="active = 2" @mouseleave="active = null" @click="go(2)">2</i>
                </span>
                <span class="act" data-anchor="4">
                  <UIcon name="i-tabler-share-2" class="ic" />
                  <i class="a2-marker mk" data-n="4" style="--i: 4" @mouseenter="active = 4" @mouseleave="active = null" @click="go(4)">4</i>
                </span>
                <span class="act" data-anchor="3">
                  <UIcon name="i-tabler-cloud-check" class="ic" />
                  <i class="a2-marker mk" data-n="3" style="--i: 3" @mouseenter="active = 3" @mouseleave="active = null" @click="go(3)">3</i>
                </span>
                <span class="act"><UIcon name="i-tabler-dots" class="ic" /></span>
              </div>
            </div>

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
                <span class="fbody"><UIcon name="i-tabler-layout-grid" class="ic v-gallery" />References</span>
              </div>
              <img src="/landing-alt2/jellyfish.jpg" alt="" class="card c-jelly" width="416" height="520">
            </div>
          </div>
        </div>

        <!-- ⑤ The window's corner: it fits any screen -->
        <span class="grip" data-anchor="5">
          <i class="a2-marker mk mk-grip" data-n="5" style="--i: 5" @mouseenter="active = 5" @mouseleave="active = null" @click="go(5)">5</i>
        </span>
      </div>
    </div>

    <ol class="legend">
      <li v-for="idea in ideas" :key="idea.n">
        <a
          :href="`#${idea.id}`"
          class="lg"
          :class="{ on: active === idea.n }"
          @mouseenter="active = idea.n"
          @mouseleave="active = null"
          @focus="active = idea.n"
          @blur="active = null"
        >
          <span class="a2-marker" :data-n="idea.n" aria-hidden="true">{{ idea.n }}</span>
          <span class="lg-text">
            <span class="lg-title">{{ idea.title }}</span>
            <span class="lg-hint">{{ idea.hint }}</span>
          </span>
        </a>
      </li>
    </ol>
  </div>
</template>

<style scoped>
/* ── The frame ───────────────────────────────────────── */

.shot {
  position: relative;
  container-type: inline-size;
  transition: outline-color 0.15s ease;
  outline: 3px solid transparent;
  outline-offset: 4px;
}

/* ⑤ lights the whole window */
.shot[data-active="5"] {
  outline-color: var(--a2-m5, var(--a2-accent));
}

/* The app's palette (apps/client/src/ui/explorer/tokens.css) */
.win {
  --s0: #f0f0ee;
  --s1: #f8f8f7;
  --s2: #ffffff;
  --tp: #1f1f1e;
  --ts: #5f5e5a;
  --tm: #9a9893;
  --bd: rgb(0 0 0 / 0.08);
  --acc-bg: #e6f1fb;
  --acc-tx: #185fa5;

  position: relative;
  display: grid;
  grid-template-rows: auto 1fr;
  background: var(--s2);
  color: var(--tp);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: clamp(7px, 1.12cqw, 13px);
  line-height: 1.3;
  letter-spacing: 0;
  text-align: left;
  user-select: none;
}

.ic {
  width: 1.3em;
  height: 1.3em;
  flex: none;
}

.ic.v-board {
  color: #534ab7;
}

.ic.v-gallery {
  color: #d4537e;
}

.ic.v-masonry {
  color: #d85a30;
}

.ic.v-canvas {
  color: #1d9e75;
}

/* ── Top bar ─────────────────────────────────────────── */

.topbar {
  display: flex;
  height: 2.9em;
  align-items: center;
  gap: 0.2em;
  border-bottom: 1px solid var(--bd);
  background: var(--s1);
  padding: 0 0.8em;
  color: var(--ts);
}

.tb {
  display: grid;
  width: 2em;
  height: 2em;
  place-items: center;
}

.sep {
  width: 1px;
  height: 1.3em;
  margin: 0 0.4em;
  background: var(--bd);
}

.bms {
  display: flex;
  gap: 0.3em;
  overflow: hidden;
}

.bm {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  border-radius: 0.45em;
  padding: 0.35em 0.6em;
  color: var(--tp);
  white-space: nowrap;
}

.bm:first-child {
  background: var(--s0);
}

/* ── Sidebar ─────────────────────────────────────────── */

.body {
  display: grid;
  grid-template-columns: 15em minmax(0, 1fr);
  min-height: 0;
}

.side {
  border-right: 1px solid var(--bd);
  background: var(--s1);
  padding: 0.6em 0.5em;
}

.drives {
  display: flex;
  justify-content: space-between;
  padding: 0.2em 0.5em 0.7em;
  color: var(--ts);
}

.dr {
  display: grid;
  width: 2.1em;
  height: 2.1em;
  place-items: center;
  border-radius: 0.45em;
}

.dr.on {
  background: var(--s0);
  color: var(--tp);
}

.tree {
  margin: 0;
  padding: 0;
  list-style: none;
}

.tree li {
  display: flex;
  align-items: center;
  gap: 0.35em;
  border-radius: 0.45em;
  padding: 0.45em 0.4em;
  white-space: nowrap;
}

.tree .sel {
  background: var(--acc-bg);
  color: var(--acc-tx);
}

.tree .sub {
  padding-left: 1.6em;
}

.tw {
  width: 1em;
  height: 1em;
  color: var(--tm);
}

span.tw {
  display: inline-block;
}

/* ── Folder header ───────────────────────────────────── */

.main {
  display: grid;
  grid-template-rows: auto 1fr;
  min-width: 0;
}

.fh {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1em;
  border-bottom: 1px solid var(--bd);
  padding: 0.8em 1.25em 0.85em;
}

.where {
  display: grid;
  gap: 0.25em;
  min-width: 0;
}

.crumbs {
  position: relative;
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 0.25em;
  border-radius: 0.35em;
  color: var(--tm);
  font-size: 0.95em;
}

.chev {
  width: 0.9em;
  height: 0.9em;
}

.name {
  font-size: 1.45em;
  font-weight: 600;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.acts {
  display: flex;
  align-items: center;
  gap: 0.3em;
  color: var(--ts);
}

.act {
  position: relative;
  display: grid;
  width: 2.3em;
  height: 2.3em;
  place-items: center;
  border-radius: 0.45em;
}

.act .ic {
  width: 1.4em;
  height: 1.4em;
}

/* ── Board ───────────────────────────────────────────── */

.board {
  position: relative;
  height: 33em;
  overflow: hidden;
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
  color: var(--ts);
  font-size: 1.05em;
}

.card {
  position: absolute;
  display: block;
  height: auto;
  object-fit: cover;
}

.c-sea {
  top: 27%;
  left: 4%;
  width: 33%;
  aspect-ratio: 520 / 346;
}

.c-tea {
  top: 11%;
  left: 40%;
  width: 15%;
  aspect-ratio: 4 / 5;
}

.c-blossom {
  top: 24%;
  left: 58%;
  width: 14%;
  aspect-ratio: 4 / 5;
}

.c-note {
  top: 10%;
  left: 75.5%;
  width: 20%;
  box-sizing: border-box;
  border: 1px solid var(--bd);
  background: var(--s2);
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
  color: var(--tm);
  font-size: 0.85em;
}

.c-rasp {
  top: 62%;
  left: 40%;
  width: 11%;
  aspect-ratio: 1;
}

.c-folder {
  top: 66%;
  left: 54%;
  width: 14%;
}

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

.c-jelly {
  top: 42%;
  left: 77%;
  width: 12%;
  aspect-ratio: 4 / 5;
}

/* ── ⑤ the corner ────────────────────────────────────── */

.grip {
  position: absolute;
  right: 0.5em;
  bottom: 0.5em;
  width: 1.4em;
  height: 1.4em;
  background:
    linear-gradient(135deg, transparent 45%, rgb(0 0 0 / 0.28) 45% 52%, transparent 52% 64%, rgb(0 0 0 / 0.28) 64% 71%, transparent 71%);
}

/* ── Markers ─────────────────────────────────────────── */

/* Above their button, at the page's own size whatever the window's scale */
.mk {
  position: absolute;
  bottom: calc(100% + 0.35rem);
  left: 50%;
  z-index: 2;
  width: 1.375rem;
  height: 1.375rem;
  cursor: pointer;
  font-size: 0.6875rem;
  font-style: normal;
  translate: -50% 0;
  box-shadow: 0 0 0 2px #fff;
  transition: scale 0.15s ease;
}

.mk-side {
  top: 50%;
  bottom: auto;
  left: calc(100% + 0.45rem);
  translate: 0 -50%;
}

.mk-grip {
  right: calc(100% + 0.4rem);
  bottom: 0;
  left: auto;
  translate: 0 0;
}

/* The pins come in one by one */
@media (prefers-reduced-motion: no-preference) {
  .mk {
    animation: mk-in 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.35) both;
    animation-delay: calc(0.35s + var(--i) * 0.09s);
  }
}

@keyframes mk-in {
  from {
    opacity: 0;
    scale: 0.3;
  }
}

/* The idea in focus: its marker grows, its place in the app gets a ring */
.shot[data-active="1"] [data-anchor="1"],
.shot[data-active="2"] [data-anchor="2"],
.shot[data-active="3"] [data-anchor="3"],
.shot[data-active="4"] [data-anchor="4"],
.shot[data-active="6"] [data-anchor="6"] {
  box-shadow: 0 0 0 2px var(--mk, var(--a2-accent));
}

.shot[data-active="1"] .mk[data-n="1"],
.shot[data-active="2"] .mk[data-n="2"],
.shot[data-active="3"] .mk[data-n="3"],
.shot[data-active="4"] .mk[data-n="4"],
.shot[data-active="5"] .mk[data-n="5"],
.shot[data-active="6"] .mk[data-n="6"] {
  scale: 1.2;
}

/* With the logo accent the ring takes its idea's colour */
:where(.alt2[data-accent="logo"]) [data-anchor="1"] { --mk: var(--a2-m1); }
:where(.alt2[data-accent="logo"]) [data-anchor="2"] { --mk: var(--a2-m2); }
:where(.alt2[data-accent="logo"]) [data-anchor="3"] { --mk: var(--a2-m3); }
:where(.alt2[data-accent="logo"]) [data-anchor="4"] { --mk: var(--a2-m4); }
:where(.alt2[data-accent="logo"]) [data-anchor="6"] { --mk: var(--a2-m6); }

/* ── Narrow: zoom into the folder ────────────────────── */

@container (max-width: 860px) {
  .win {
    font-size: clamp(8.5px, 2.15cqw, 13px);
  }

  .bms,
  .side {
    display: none;
  }

  .body {
    grid-template-columns: minmax(0, 1fr);
  }

  /* Room for the pins above the buttons, at the page's size */
  .fh {
    flex-direction: column;
    align-items: stretch;
    gap: 2.25rem;
    padding-bottom: 0.7em;
  }

  /* ⑥ is taller than the small path it sits beside */
  .where {
    gap: 0.5rem;
  }

  .acts {
    justify-content: space-between;
  }

  .board {
    height: 27em;
  }

  .c-sea {
    top: 34%;
    width: 50%;
  }

  .c-tea {
    top: 12%;
    left: 58%;
    width: 22%;
  }

  .c-note {
    top: 60%;
    left: 58%;
    width: 36%;
  }

  .c-blossom,
  .c-rasp,
  .c-folder,
  .c-jelly,
  .b-sub {
    display: none;
  }

  .b-title {
    top: 9%;
  }
}

/* ── Legend ──────────────────────────────────────────── */

.legend {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.25rem 1rem;
  margin: 1.5rem 0 0;
  padding: 0;
  list-style: none;
}

@media (min-width: 640px) {
  .legend {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (min-width: 1100px) {
  .legend {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}

.lg {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  border-radius: var(--a2-radius-m);
  padding: 0.625rem 0.5rem;
  color: var(--a2-ink-2);
  text-decoration: none;
  transition: background-color 0.15s ease;
}

.lg:hover,
.lg.on {
  background: var(--a2-accent-soft);
}

.lg-text {
  display: grid;
  gap: 0.125rem;
}

.lg-title {
  color: var(--a2-ink);
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.3;
}

.lg-hint {
  color: var(--a2-ink-3);
  font-size: 0.8125rem;
  line-height: 1.4;
}
</style>
