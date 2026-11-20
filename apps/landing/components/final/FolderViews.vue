<!-- The folder ~/Pictures/Harbor moodboard in each of the app's nine views,
     drawn after the app (apps/client: ListView.vue, GalleryView.vue, the
     board, Canvas.vue with its dock, View3D.vue, the stack, masonry,
     dashboard and slides containers) and checked against the web demo.
     Board, Canvas and 3D share one layout: a canvas is the board zoomed out
     on its dots, 3D is the board lying as a table. Sizes are em of the
     window, so it scales like a screenshot. -->
<script setup lang="ts">
import { FOLDER_ITEMS, type ViewId } from "~/utils/finalFolder";

defineProps<{ view: ViewId }>();

const fileIcon = (kind: string) =>
  kind === "folder" ? "i-tabler-layout-grid" : kind === "image" ? "i-tabler-photo" : "i-tabler-file-text";

const images = FOLDER_ITEMS.filter(i => i.kind === "image");
</script>

<template>
  <div class="fv" :data-view="view" aria-hidden="true">
    <!-- ── List ─────────────────────────────────────────── -->
    <div v-if="view === 'list'" class="list">
      <div class="lh"><span>Name</span><span>Size</span></div>
      <div v-for="item in FOLDER_ITEMS" :key="item.name" class="lr">
        <UIcon :name="fileIcon(item.kind)" class="li" :style="item.kind === 'folder' ? { color: '#d4537e' } : undefined" />
        <span class="ln">{{ item.name }}</span>
        <span class="ls">{{ item.size }}</span>
        <UIcon name="i-tabler-dots" class="ld" />
      </div>
    </div>

    <!-- ── Gallery ──────────────────────────────────────── -->
    <div v-else-if="view === 'grid'" class="gal">
      <template v-for="item in FOLDER_ITEMS" :key="item.name">
        <div v-if="item.kind === 'folder'" class="gt gf">
          <span class="ftab" /><span class="fbody"><UIcon name="i-tabler-layout-grid" class="fgi" />{{ item.name }}</span>
        </div>
        <img v-else-if="item.kind === 'image'" :src="item.src" alt="" class="gt gi">
        <div v-else class="gt gd">
          <span class="gn">{{ item.name.replace(/\.md$/, "") }}</span>
          <span class="gm"><UIcon name="i-tabler-file-text" class="gmi" />md</span>
        </div>
      </template>
    </div>

    <!-- ── Board, Canvas, 3D: one layout ────────────────── -->
    <div v-else-if="view === 'board' || view === 'canvas' || view === '3d'" class="spatial" :class="view">
      <div class="plane">
        <div class="bd">
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
            <span class="ftab" />
            <span class="fbody"><UIcon name="i-tabler-layout-grid" class="fgi" />References</span>
          </div>
          <img src="/landing-alt2/jellyfish.jpg" alt="" class="card c-jelly" width="416" height="520">
          <!-- On a canvas things connect -->
          <svg v-if="view === 'canvas'" class="link" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d="M 66 73 C 72 73, 72 60, 77 58" />
          </svg>
        </div>
      </div>

      <!-- Canvas.vue's dock: tools, then the zoom -->
      <div v-if="view === 'canvas'" class="dock">
        <span class="db"><UIcon name="i-tabler-hand-stop" class="di" /></span>
        <span class="db on"><UIcon name="i-tabler-pointer" class="di" /></span>
        <span class="db"><UIcon name="i-tabler-lasso" class="di" /></span>
        <span class="dsep" />
        <span class="db"><UIcon name="i-tabler-vector-spline" class="di" /></span>
        <span class="db"><UIcon name="i-tabler-unlink" class="di" /></span>
        <span class="dsep" />
        <span class="db"><UIcon name="i-tabler-pencil" class="di" /></span>
        <span class="db"><UIcon name="i-tabler-eraser" class="di" /></span>
        <span class="dsep" />
        <span class="dz">74%<UIcon name="i-tabler-chevron-up" class="dzc" /></span>
      </div>

      <!-- View3D.vue's bar: the camera, then the zoom and the tips -->
      <div v-if="view === '3d'" class="dock">
        <span class="db"><UIcon name="i-tabler-perspective" class="di" /></span>
        <span class="db"><UIcon name="i-tabler-template" class="di" /></span>
        <span class="dsep" />
        <span class="db"><UIcon name="i-tabler-minus" class="di" /></span>
        <span class="db"><UIcon name="i-tabler-plus" class="di" /></span>
        <span class="dsep" />
        <span class="db"><UIcon name="i-tabler-help-circle" class="di" /></span>
      </div>
    </div>

    <!-- ── Stack ────────────────────────────────────────── -->
    <div v-else-if="view === 'stack'" class="stack">
      <div class="st-title">
        <p class="b-title static">Coastal summer</p>
        <p class="b-sub static">Brand refresh · sun, salty air, fresh fruit</p>
      </div>
      <div class="st-item">
        <img src="/landing-alt2/sea-horizon.jpg" alt="">
        <span class="st-tools"><UIcon name="i-tabler-grip-vertical" /><UIcon name="i-tabler-dots" /></span>
      </div>
      <div class="st-item"><img src="/landing-alt2/lemon-tea.jpg" alt=""></div>
    </div>

    <!-- ── Masonry: each card goes to the shortest column ─ -->
    <div v-else-if="view === 'masonry'" class="mas">
      <div class="col">
        <img src="/landing-alt2/sea-horizon.jpg" alt="" class="mc landscape">
        <img src="/landing-alt2/jellyfish.jpg" alt="" class="mc tall">
      </div>
      <div class="col">
        <img src="/landing-alt2/lemon-tea.jpg" alt="" class="mc tall">
        <div class="mc note"><p>Warm light, salty air. One object on the table.</p><span>Mood.md</span></div>
      </div>
      <div class="col">
        <img src="/landing-alt2/raspberries.jpg" alt="" class="mc square">
        <div class="mc mfolder"><span class="ftab" /><span class="fbody"><UIcon name="i-tabler-layout-grid" class="fgi" />References</span></div>
      </div>
      <div class="col">
        <img src="/landing-alt2/pink-blossom.jpg" alt="" class="mc tall">
        <div class="mc mtitle"><p class="mt-h">Coastal summer</p><p class="mt-s">Brand refresh · sun, salty air, fresh fruit</p></div>
      </div>
    </div>

    <!-- ── Dashboard: twelve columns ────────────────────── -->
    <div v-else-if="view === 'dashboard'" class="dash">
      <img src="/landing-alt2/sea-horizon.jpg" alt="" class="dc" style="grid-column: 1 / span 5; grid-row: 1 / span 2">
      <img src="/landing-alt2/lemon-tea.jpg" alt="" class="dc" style="grid-column: 6 / span 3; grid-row: 1 / span 2">
      <img src="/landing-alt2/raspberries.jpg" alt="" class="dc" style="grid-column: 9 / span 4; grid-row: 1 / span 2">
      <img src="/landing-alt2/jellyfish.jpg" alt="" class="dc" style="grid-column: 1 / span 3; grid-row: 3 / span 2">
      <img src="/landing-alt2/pink-blossom.jpg" alt="" class="dc" style="grid-column: 4 / span 3; grid-row: 3 / span 2">
      <div class="dc dnote" style="grid-column: 7 / span 3; grid-row: 3 / span 1"><p>Warm light, salty air. One object on the table.</p><span>Mood.md</span></div>
      <div class="dc dfolder" style="grid-column: 10 / span 3; grid-row: 3 / span 1"><UIcon name="i-tabler-layout-grid" class="fgi" />References</div>
      <div class="dc dtitle" style="grid-column: 7 / span 6; grid-row: 4 / span 1"><p class="mt-h">Coastal summer</p></div>
    </div>

    <!-- ── Slides: one at a time ────────────────────────── -->
    <div v-else-if="view === 'slides'" class="slides">
      <div class="sb">
        <UIcon name="i-tabler-chevron-left" class="sbi off" />
        <span class="sc">1 / {{ images.length + 3 }}</span>
        <UIcon name="i-tabler-chevron-right" class="sbi" />
        <UIcon name="i-tabler-photo" class="sbi" />
        <span class="sn">sea-horizon.jpg</span>
        <UIcon name="i-tabler-dots" class="sbi end" />
      </div>
      <div class="ss"><img src="/landing-alt2/sea-horizon.jpg" alt=""></div>
    </div>
  </div>
</template>

<style scoped>
/* The app's palette (apps/client/src/ui/explorer/tokens.css) */
.fv {
  --s0: #f0f0ee;
  --s1: #f8f8f7;
  --tp: #1f1f1e;
  --ts: #5f5e5a;
  --tm: #9a9893;
  --bd: rgb(0 0 0 / 0.08);
  --bd2: rgb(0 0 0 / 0.15);

  position: relative;
  height: var(--fv-h, 30em);
  overflow: hidden;
  background: #fff;
}

img {
  display: block;
  object-fit: cover;
}

/* A folder as the app draws it on a board or in a gallery: a tab and a
   coloured body with its view's icon and its name */
.ftab {
  display: block;
  width: 42%;
  height: 0.9em;
  border-radius: 0.4em 0.4em 0 0;
  background: #f2cad8;
}

.fbody {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.45em;
  border-radius: 0 0.5em 0.5em;
  background: #f2cad8;
  font-size: 0.95em;
}

.fgi {
  width: 1.3em;
  height: 1.3em;
  color: #d4537e;
}

/* ── List (ListView.vue): a 30px header, 32px rows ─────── */

/* Edge to edge, as in the app */
.list {
  padding: 0;
}

.lh,
.lr {
  display: grid;
  grid-template-columns: 1.6em minmax(0, 1fr) 7em 2em;
  align-items: center;
  border-bottom: 1px solid var(--bd);
  padding: 0 0.6em;
}

.lh {
  grid-template-columns: minmax(0, 1fr) 7em 2em;
  height: 2.3em;
  color: var(--tm);
  font-size: 0.846em;
}

.lh span:last-child {
  text-align: right;
}

.lr {
  height: 2.46em;
}

.li {
  width: 1.23em;
  height: 1.23em;
  color: var(--ts);
}

.ln {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ls {
  color: var(--tm);
  font-size: 0.923em;
  text-align: right;
}

.ld {
  justify-self: end;
  width: 1.1em;
  height: 1.1em;
  color: var(--tm);
}

/* ── Gallery (GalleryView.vue): square tiles ───────────── */

.gal {
  display: grid;
  grid-template-columns: repeat(auto-fill, 7.5em);
  gap: 0.75em;
  padding: 0.75em;
}

.gt {
  width: 7.5em;
  height: 7.5em;
  box-sizing: border-box;
  border: 1px solid var(--bd);
  border-radius: 0.5em;
}

.gi {
  object-fit: cover;
}

.gd {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: #fff;
  padding: 0.7em;
}

.gn {
  font-size: 0.92em;
}

.gm {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--tm);
  font-size: 0.77em;
}

.gmi {
  width: 1.3em;
  height: 1.3em;
  color: var(--ts);
}

.gf {
  display: flex;
  flex-direction: column;
  border: 0;
  padding-top: 0.6em;
}

.gf .fbody {
  flex: 1;
}

/* ── Board, Canvas, 3D ─────────────────────────────────── */

.spatial,
.plane,
.bd {
  position: absolute;
  inset: 0;
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
  color: var(--ts);
  font-size: 1.05em;
}

.b-title.static,
.b-sub.static {
  position: static;
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
.c-folder { top: 66%; left: 54%; width: 14%; }
.c-folder .fbody { height: 5.6em; }

.c-note {
  top: 10%;
  left: 75.5%;
  width: 20%;
  box-sizing: border-box;
  border: 1px solid var(--bd);
  background: #fff;
  padding: 0.9em 1em 0.75em;
}

.c-note p,
.note p,
.dnote p {
  margin: 0;
  font-size: 1.05em;
  line-height: 1.4;
}

.c-note span,
.note span,
.dnote span {
  display: block;
  margin-top: 0.7em;
  color: var(--tm);
  font-size: 0.85em;
}

/* Canvas: the board zoomed out to 74% on its dots, the dock at the bottom */
.canvas {
  background-color: #fff;
  background-image: radial-gradient(circle, rgb(0 0 0 / 0.16) 0.07em, transparent 0.1em);
  background-size: 1.55em 1.55em;
}

.canvas .plane {
  transform: scale(0.74);
  transform-origin: 50% 40%;
}

.link {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.link path {
  fill: none;
  stroke: #d85a30;
  stroke-width: 0.35;
  vector-effect: non-scaling-stroke;
  stroke-width: 2px;
}

/* 3D: the board as a table in perspective, on its grid */
.\33 d {
  perspective: 60em;
  perspective-origin: 50% 0%;
  background: linear-gradient(#fff 40%, #f4f4f3);
}

.\33 d .plane {
  inset: 6% 9% 8%;
  border-radius: 0.4em;
  background-color: #fff;
  background-image:
    linear-gradient(rgb(0 0 0 / 0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgb(0 0 0 / 0.07) 1px, transparent 1px);
  background-size: 3.2em 3.2em;
  box-shadow: 0 2em 4em -2em rgb(0 0 0 / 0.25);
  transform: rotateX(48deg) scale(0.92);
  transform-origin: 50% 60%;
}

.\33 d .card {
  box-shadow: 0 0.3em 0.6em rgb(0 0 0 / 0.18);
}

/* Both bars: a white pill at the bottom centre */
.dock {
  position: absolute;
  bottom: 0.9em;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 0.15em;
  border: 1px solid var(--bd2);
  border-radius: 999px;
  background: #fff;
  padding: 0.25em 0.5em;
  box-shadow: 0 0.3em 1em rgb(0 0 0 / 0.08);
  color: var(--ts);
  translate: -50% 0;
}

/* A tool: the icon on a pill; the picked one is filled. The icons are masks
   in currentColor, so the fill goes on the pill, not on the icon */
.db {
  display: grid;
  width: 2em;
  height: 1.95em;
  flex: none;
  place-items: center;
  border-radius: 999px;
}

.db.on {
  background: #e6f1fb;
  color: #185fa5;
}

.di {
  width: 1.25em;
  height: 1.25em;
}

.dsep {
  width: 1px;
  height: 1.1em;
  margin: 0 0.2em;
  background: var(--bd);
}

.dz {
  display: inline-flex;
  align-items: center;
  gap: 0.2em;
  padding: 0 0.3em;
  font-size: 0.92em;
}

.dzc {
  width: 0.9em;
  height: 0.9em;
}

/* Narrow: the board keeps fewer cards, bigger */
@container (max-width: 760px) {
  .board .c-sea { top: 34%; width: 50%; }
  .board .c-tea { top: 12%; left: 58%; width: 22%; }
  .board .c-note { top: 60%; left: 58%; width: 36%; }
  .board .c-blossom,
  .board .c-rasp,
  .board .c-folder,
  .board .c-jelly,
  .board .b-sub { display: none; }
}

/* ── Stack: one column, full width ─────────────────────── */

.stack {
  display: flex;
  flex-direction: column;
  gap: 0.75em;
  padding: 1.4em 3em;
}

.st-title {
  padding: 0 0 0.4em;
}

.st-title .b-sub {
  margin-top: 0.4em;
}

.st-item {
  position: relative;
}

.st-item img {
  width: 100%;
  aspect-ratio: 520 / 346;
}

.st-tools {
  position: absolute;
  top: 45%;
  right: -2.4em;
  display: flex;
  gap: 0.2em;
  color: var(--tm);
}

/* ── Masonry: four columns ─────────────────────────────── */

.mas {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.6em;
  padding: 0.75em 3.5em;
  background: var(--s0);
}

.col {
  display: flex;
  flex-direction: column;
  gap: 0.6em;
}

.mc {
  width: 100%;
  box-sizing: border-box;
}

.mc.landscape { aspect-ratio: 520 / 346; }
.mc.tall { aspect-ratio: 4 / 5; }
.mc.square { aspect-ratio: 1; }

.note,
.dnote {
  background: #fff;
  padding: 0.8em 0.9em;
}

.mfolder {
  display: flex;
  flex-direction: column;
}

.mfolder .fbody {
  height: 5.2em;
}

.mtitle {
  padding: 0.4em 0.2em;
}

.mt-h {
  margin: 0;
  font-size: 1.7em;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
}

.mt-s {
  margin: 0.5em 0 0;
  color: var(--ts);
}

/* ── Dashboard: twelve columns, rows that cards snap to ── */

.dash {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-auto-rows: 6.4em;
  gap: 0.75em;
  padding: 0.9em 1.2em;
  background: var(--s0);
}

.dc {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}

.dnote {
  overflow: hidden;
}

.dnote p {
  font-size: 0.95em;
}

.dfolder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4em;
  border-radius: 0.5em;
  background: #f2cad8;
  font-size: 0.95em;
}

.dtitle {
  display: flex;
  align-items: center;
  padding: 0 0.4em;
}

/* ── Slides: the bar, then the slide on the folder's gray ── */

.slides {
  display: grid;
  height: 100%;
  grid-template-rows: auto 1fr;
}

.sb {
  display: flex;
  height: 2.5em;
  align-items: center;
  gap: 0.6em;
  border-bottom: 1px solid var(--bd);
  padding: 0 0.9em;
  color: var(--ts);
}

.sbi {
  width: 1.15em;
  height: 1.15em;
  flex: none;
}

.sbi.off {
  color: var(--tm);
  opacity: 0.6;
}

.sbi.end {
  margin-left: auto;
}

.sc {
  color: var(--tm);
  font-size: 0.92em;
}

.sn {
  color: var(--tp);
}

.ss {
  display: grid;
  min-height: 0;
  place-items: center;
  background: var(--s0);
  padding: 1em 3em;
}

.ss img {
  max-width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
