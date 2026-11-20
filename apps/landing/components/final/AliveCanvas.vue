<!-- Block 2's folder: ~/Pictures/Harbor moodboard as a canvas, its files
     showing themselves (apps/client: PreviewWidgetContent.vue, NoteWidgetContent.vue,
     DefaultWidgetContent.vue, LazyFolderPreview.vue, Canvas.vue), checked
     against the web demo's Features folders. Each thing carries the steps of
     the tour it belongs to (data-f); the step on screen gets a ring.
     Sizes are em of the window and % of the canvas, so it scales like a
     screenshot. Decoration for screen readers: the section says it in words. -->
<script setup lang="ts">
export type AliveStep = "notes" | "previews" | "covers" | "folder" | "shapes" | "layers" | "connections" | "pen";

defineProps<{ step: AliveStep; drawing?: boolean }>();
</script>

<template>
  <div class="cv" :data-step="step" aria-hidden="true">
    <!-- A text block: the preview of Title.md -->
    <div class="w w-title" data-f="notes">
      <p class="ttl">Coastal summer</p>
      <p class="sub">Sun, salty air, fresh fruit</p>
    </div>

    <!-- Previews: a photo, a video and its player, a sound, a 3D model -->
    <img src="/landing-alt2/sea-horizon.jpg" alt="" class="w w-photo" data-f="previews layers">

    <div class="w w-video" data-f="previews">
      <img src="/landing-alt2/jellyfish.jpg" alt="">
      <span class="vbar">
        <UIcon name="i-tabler-player-play-filled" class="vi" />
        <span class="vt">0:04 / 0:17</span>
        <span class="vtrack"><span class="vfill" /></span>
        <UIcon name="i-tabler-volume" class="vi" />
        <UIcon name="i-tabler-maximize" class="vi" />
      </span>
    </div>

    <div class="w w-audio" data-f="previews">
      <UIcon name="i-tabler-player-play-filled" class="ai" />
      <span class="at">0:00 / 0:05</span>
      <span class="atrack"><span class="afill" /></span>
      <UIcon name="i-tabler-volume" class="ai" />
    </div>

    <!-- A 3D model stands on the canvas as an object -->
    <svg class="w w-model" data-f="previews" viewBox="0 0 120 110">
      <ellipse cx="60" cy="100" rx="40" ry="6" fill="rgb(0 0 0 / 0.12)" />
      <path d="M20 78 L100 78 L88 96 L32 96 Z" fill="#2c4f86" />
      <path d="M20 78 L100 78 L96 84 L24 84 Z" fill="#3b6fb6" />
      <rect x="58" y="12" width="3" height="66" fill="#5f5e5a" />
      <path d="M62 14 L62 72 L98 72 Z" fill="#f4f1ea" />
      <path d="M62 14 L80 72 L98 72 Z" fill="#e2ddd2" />
      <path d="M57 22 L57 72 L30 72 Z" fill="#e4574a" />
      <path d="M57 22 L44 72 L30 72 Z" fill="#c9443a" />
    </svg>

    <!-- Covers: a note with a colour, a folder with a picture, a folder with a colour -->
    <div class="w w-note" data-f="notes covers">
      <p>Warm light, salty air. One object on the table.</p>
      <span class="nf"><UIcon name="i-tabler-file-text" class="nfi" />md</span>
    </div>

    <div class="w w-pic" data-f="covers">
      <img src="/landing-alt2/raspberries.jpg" alt="">
      <span class="cap">References</span>
    </div>

    <div class="w w-fold" data-f="covers">
      <span class="ftab" />
      <span class="fbody"><UIcon name="i-tabler-palette" class="fgi" />Palette</span>
    </div>

    <!-- A folder open in place: its things in a frame -->
    <div class="w w-prev" data-f="folder">
      <span class="ph"><UIcon name="i-tabler-layout-grid" class="phi" />Inspiration</span>
      <span class="pg">
        <img src="/landing-alt2/lemon-tea.jpg" alt="">
        <img src="/landing-alt2/pink-blossom.jpg" alt="">
        <span class="pnote">Fresh fruit, morning light</span>
      </span>
    </div>

    <!-- Shapes: SVG files shown as shapes -->
    <span class="w w-circle" data-f="shapes" />
    <svg class="w w-tri" data-f="shapes" viewBox="0 0 100 90"><path d="M50 0 L100 90 L0 90 Z" fill="#f3ec95" /></svg>
    <svg class="w w-diamond" data-f="shapes" viewBox="0 0 100 100"><path d="M50 0 L100 50 L50 100 L0 50 Z" fill="#c8f5d3" /></svg>
    <svg class="w w-arrow" data-f="shapes" viewBox="0 0 100 20" preserveAspectRatio="none">
      <path d="M0 10 L92 10" stroke="#d85a30" stroke-width="3" vector-effect="non-scaling-stroke" />
      <path d="M86 3 L98 10 L86 17" fill="none" stroke="#d85a30" stroke-width="3" vector-effect="non-scaling-stroke" />
    </svg>

    <!-- A connection (Canvas.vue, CanvasLabeledEdge.vue): a dashed curve
         with an arrow and its label, from Palette to Inspiration -->
    <svg class="edge" :class="{ lit: step === 'connections' }" viewBox="0 0 1000 400" preserveAspectRatio="none">
      <path d="M665 252 C 665 300, 700 318, 760 300" />
      <path d="M748 290 L762 300 L748 310" />
    </svg>
    <span class="elabel" :class="{ lit: step === 'connections' }">colours</span>

    <!-- The pen, over everything -->
    <svg class="ink" :class="{ drawing }" data-f="pen" viewBox="0 0 1000 400" preserveAspectRatio="none">
      <path class="s1" d="M30 248 C 60 218, 90 278, 120 248 S 180 218, 210 248 S 250 270, 270 250" />
      <path class="s2" d="M350 212 C 290 218, 280 300, 310 330 C 340 358, 440 352, 462 318 C 484 284, 468 222, 420 210 C 395 204, 372 205, 358 214" />
      <path class="s3" d="M560 360 C 520 368, 492 352, 478 330" />
      <path class="s3" d="M473 344 L477 328 L492 334" />
    </svg>

    <!-- Canvas.vue's dock: the pen is picked on the Pen step -->
    <div class="dock">
      <span class="db"><UIcon name="i-tabler-hand-stop" class="di" /></span>
      <span class="db" :class="{ on: step !== 'pen' && step !== 'connections' }"><UIcon name="i-tabler-pointer" class="di" /></span>
      <span class="db"><UIcon name="i-tabler-lasso" class="di" /></span>
      <span class="dsep" />
      <span class="db" :class="{ on: step === 'connections' }" data-f="connections"><UIcon name="i-tabler-vector-spline" class="di" /></span>
      <span class="db"><UIcon name="i-tabler-unlink" class="di" /></span>
      <span class="dsep" />
      <span class="db" :class="{ on: step === 'pen' }" data-f="pen"><UIcon name="i-tabler-pencil" class="di" /></span>
      <span class="db"><UIcon name="i-tabler-eraser" class="di" /></span>
      <span class="dsep" />
      <span class="dz">74%<UIcon name="i-tabler-chevron-up" class="dzc" /></span>
    </div>
  </div>
</template>

<style scoped>
.cv {
  --tp: #1f1f1e;
  --ts: #5f5e5a;
  --tm: #9a9893;
  --bd: rgb(0 0 0 / 0.08);
  --ring: #2453ff;

  position: relative;
  height: var(--fv-h, 32em);
  overflow: hidden;
  background-color: #fff;
  background-image: radial-gradient(circle, rgb(0 0 0 / 0.16) 0.07em, transparent 0.1em);
  background-size: 1.55em 1.55em;
}

.w {
  position: absolute;
  box-sizing: border-box;
  transition: outline-color 0.2s ease, box-shadow 0.2s ease;
  outline: 2px solid transparent;
  outline-offset: 0.35em;
}

img {
  display: block;
  object-fit: cover;
}

/* The step on screen: its things get a ring */
.cv[data-step="notes"] [data-f~="notes"],
.cv[data-step="previews"] [data-f~="previews"],
.cv[data-step="covers"] [data-f~="covers"],
.cv[data-step="folder"] [data-f~="folder"],
.cv[data-step="shapes"] [data-f~="shapes"] {
  outline-color: var(--ring);
}

.w-title {
  top: 4%;
  left: 3%;
}

.ttl {
  margin: 0;
  font-size: 1.8em;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.sub {
  margin: 0.4em 0 0;
  color: var(--ts);
}

.w-photo { top: 28%; left: 3%; width: 24%; aspect-ratio: 520 / 346; }

/* The browser's own video player, as the app shows it */
.w-video {
  top: 5%;
  left: 31%;
  width: 25%;
  aspect-ratio: 16 / 10;
  background: #000;
}

.w-video img {
  width: 100%;
  height: 100%;
  opacity: 0.92;
}

.vbar {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  gap: 0.5em;
  background: linear-gradient(transparent, rgb(0 0 0 / 0.6));
  padding: 1.4em 0.6em 0.5em;
  color: #fff;
  font-size: 0.85em;
}

.vi {
  width: 1.1em;
  height: 1.1em;
  flex: none;
}

.vt {
  flex: none;
  font-variant-numeric: tabular-nums;
}

.vtrack,
.atrack {
  position: relative;
  height: 0.25em;
  flex: 1;
  border-radius: 1em;
  background: rgb(255 255 255 / 0.35);
}

.vfill,
.afill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 24%;
  border-radius: 1em;
  background: #fff;
}

/* The browser's own audio player */
.w-audio {
  top: 38%;
  left: 31%;
  display: flex;
  width: 25%;
  height: 2.6em;
  align-items: center;
  gap: 0.55em;
  border-radius: 99em;
  background: #f1f3f4;
  padding: 0 0.9em;
  color: var(--tp);
  font-size: 0.92em;
}

.ai {
  width: 1.15em;
  height: 1.15em;
  flex: none;
}

.at {
  flex: none;
  font-variant-numeric: tabular-nums;
}

.atrack {
  background: rgb(0 0 0 / 0.15);
}

.afill {
  width: 0;
}

.w-model { top: 5%; left: 60%; width: 12%; }

/* A note with a yellow cover: the card takes its colour */
.w-note {
  top: 55%;
  left: 31%;
  display: flex;
  width: 14%;
  aspect-ratio: 1;
  flex-direction: column;
  justify-content: space-between;
  background: #f6f0a8;
  padding: 0.8em 0.9em 0.7em;
}

.w-note p {
  margin: 0;
  line-height: 1.4;
}

.nf {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--ts);
  font-size: 0.8em;
}

.nfi {
  width: 1.3em;
  height: 1.3em;
}

/* A picture cover is the whole card; the name on a dark strip (CoverCaption.vue) */
.w-pic {
  top: 5%;
  left: 76%;
  width: 15%;
  aspect-ratio: 1;
  overflow: hidden;
}

.w-pic img {
  width: 100%;
  height: 100%;
}

.cap {
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

/* A colour cover: the folder, tab and all, takes it */
.w-fold {
  top: 40%;
  left: 60%;
  display: flex;
  width: 13%;
  flex-direction: column;
}

.ftab {
  display: block;
  width: 42%;
  height: 0.9em;
  border-radius: 0.4em 0.4em 0 0;
  background: #c8f5d3;
}

.fbody {
  display: flex;
  height: 6.4em;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.45em;
  border-radius: 0 0.5em 0.5em;
  background: #c8f5d3;
}

.fgi {
  width: 1.3em;
  height: 1.3em;
  color: #1d9e75;
}

/* A folder open in place (LazyFolderPreview.vue): a frame, its name, its things */
.w-prev {
  top: 38%;
  left: 76%;
  display: flex;
  width: 21%;
  height: 40%;
  flex-direction: column;
  border: 1px solid var(--bd);
  border-radius: 0.5em;
  background: #fff;
  overflow: hidden;
}

.ph {
  display: flex;
  align-items: center;
  gap: 0.4em;
  border-bottom: 1px solid var(--bd);
  padding: 0.45em 0.7em;
  font-size: 0.92em;
}

.phi {
  width: 1.2em;
  height: 1.2em;
  color: #d4537e;
}

.pg {
  position: relative;
  flex: 1;
}

.pg img {
  position: absolute;
  width: 30%;
  aspect-ratio: 4 / 5;
}

.pg img:first-child { top: 10%; left: 6%; }
.pg img:nth-child(2) { top: 18%; left: 40%; }

.pnote {
  position: absolute;
  top: 14%;
  right: 5%;
  width: 22%;
  border: 1px solid var(--bd);
  background: #fff;
  padding: 0.4em;
  font-size: 0.7em;
}

/* Shapes */
.w-circle {
  top: 70%;
  left: 3%;
  width: 6.5%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: #f4b9b2;
}

.w-tri { top: 70%; left: 11.5%; width: 7%; }
.w-diamond { top: 68%; left: 20%; width: 6.5%; }
.w-arrow { top: 62%; left: 47%; width: 11%; height: 1.6em; overflow: visible; }

/* The connection: grey and dashed; its step draws it in the accent */
.edge {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

.edge path {
  fill: none;
  stroke: #9a9893;
  stroke-width: 1.5px;
  stroke-dasharray: 5 4;
  vector-effect: non-scaling-stroke;
  transition: stroke 0.2s ease;
}

.edge path:last-child {
  stroke-dasharray: none;
}

.edge.lit path {
  stroke: var(--ring);
  stroke-width: 2px;
}

.elabel {
  position: absolute;
  top: 70%;
  left: 66.5%;
  border: 1px solid rgb(0 0 0 / 0.15);
  border-radius: 0.3em;
  background: #fff;
  padding: 0.15em 0.45em;
  font-size: 0.85em;
  transition: border-color 0.2s ease, color 0.2s ease;
}

.elabel.lit {
  border-color: var(--ring);
  color: var(--ring);
}

/* The pen's strokes */
.ink {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

.ink path {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 3px;
  vector-effect: non-scaling-stroke;
}

.s1 { stroke: #4f6fe8; }
.s2 { stroke: #e0559e; }
.s3 { stroke: #1f1f1e; }

/* The Pen step draws them again, unless motion is unwelcome */
@media (prefers-reduced-motion: no-preference) {
  .ink.drawing path {
    stroke-dasharray: 1600;
    animation: draw 1.6s ease-out both;
  }

  .ink.drawing .s2 { animation-delay: 0.5s; }
  .ink.drawing .s3 { animation-delay: 1s; }
}

@keyframes draw {
  from { stroke-dashoffset: 1600; }
  to { stroke-dashoffset: 0; }
}

/* The dock */
.dock {
  position: absolute;
  bottom: 0.9em;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 0.15em;
  border: 1px solid rgb(0 0 0 / 0.15);
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
  outline: 2px solid transparent;
  outline-offset: 0.15em;
  transition: outline-color 0.2s ease;
}

.db.on {
  background: #e6f1fb;
  color: #185fa5;
}

.di {
  width: 1.25em;
  height: 1.25em;
}

.cv[data-step="pen"] .db[data-f~="pen"],
.cv[data-step="connections"] .db[data-f~="connections"] {
  outline-color: var(--ring);
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
</style>
