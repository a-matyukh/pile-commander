<!-- Ideas as they ship: a wish typed into the bar under the board, ideas
     appear in place as dashed cards with a check, "Add" turns them into
     notes. SSR, no-JS and reduced motion get the cards as proposed. -->
<script setup lang="ts">
const PROMPT = "sunrise shots by the sea";

const ideas = [
  { key: "fog", title: "Fog at dawn", copy: "Shoot the pier before sunrise, while the water is still." },
  { key: "lighthouse", title: "Lighthouse close-up", copy: "Red and white stripes against a pale sky." },
  { key: "rope", title: "Rope & rust", copy: "A palette of rust, sand and teal." },
] as const;

const emit = defineEmits<{ done: [] }>();

const root = ref<HTMLElement>();
// The finished frame: the cards as proposed. The loop rewinds it on the client.
const typed = ref(PROMPT);
const typing = ref(false);
const thinking = ref(false);
const shown = ref(true);
const resolved = ref(true);
const pressing = ref(false);
const added = ref(false);
const fading = ref(false);

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
  typed.value = "";
  typing.value = true;
  thinking.value = false;
  shown.value = false;
  resolved.value = false;
  pressing.value = false;
  added.value = false;
  fading.value = false;

  const typeStart = 600;
  const perChar = 65;
  for (let i = 1; i <= PROMPT.length; i++) {
    at(typeStart + i * perChar, () => (typed.value = PROMPT.slice(0, i)));
  }
  const sent = typeStart + PROMPT.length * perChar + 300;
  at(sent, () => {
    typing.value = false;
    thinking.value = true;
  });
  at(sent + 200, () => (shown.value = true));
  at(sent + 1300, () => (resolved.value = true));
  at(sent + 1900, () => (thinking.value = false));
  at(sent + 3600, () => (pressing.value = true));
  at(sent + 3900, () => {
    pressing.value = false;
    added.value = true;
  });
  at(sent + 6600, () => (fading.value = true));
  at(sent + 7600, () => {
    // The block may move to the next tab; if it does not, the scene plays again
    emit("done");
    cycle();
  });
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
  <div
    ref="root"
    class="ai"
    :class="{ 'is-thinking': thinking, 'is-shown': shown, 'is-resolved': resolved, 'is-added': added, 'is-fading': fading }"
    aria-hidden="true"
  >
    <p class="folder">
      <UIcon name="i-lucide-folder" class="size-[1.15em] text-pc-600" />
      Harbor moodboard
    </p>

    <!-- What the folder already holds -->
    <article class="file file-photo">
      <div class="thumb" />
      <p class="file-name">Harbor.jpg</p>
    </article>

    <article class="file file-note">
      <p class="note-title">Mood</p>
      <p class="note-copy">warm light<br />quiet water</p>
    </article>

    <!-- Ideas, where their notes will be written -->
    <article
      v-for="(idea, i) in ideas"
      :key="idea.key"
      class="idea"
      :class="`idea-${idea.key}`"
      :style="{ '--i': i }"
    >
      <div class="idea-skel">
        <span class="skel skel-line" />
        <span class="skel skel-line" />
        <span class="skel skel-line skel-short" />
      </div>

      <div class="idea-body">
        <div class="idea-head">
          <span class="badge">
            <UIcon name="i-lucide-sparkles" class="size-[1em]" />
            AI
          </span>
          <span class="check">
            <UIcon name="i-lucide-check" class="size-[0.85em]" />
          </span>
        </div>
        <p class="idea-title">{{ idea.title }}</p>
        <p class="idea-copy">{{ idea.copy }}</p>
      </div>
    </article>

    <div class="bar">
      <div class="bar-panel">
        <UIcon name="i-lucide-sparkles" class="size-[1.15em] shrink-0 text-pc-500" />
        <p class="bar-text">
          <span v-if="typed">{{ typed }}</span>
          <span v-else class="bar-placeholder">What ideas?…</span>
          <span v-if="typing" class="caret" />
        </p>
        <span v-if="!resolved" class="enter">↵</span>
        <template v-else>
          <span class="pill">More</span>
          <span class="pill pill-plain">Cancel</span>
          <span class="pill pill-main" :class="{ 'is-pressed': pressing }">Add 3</span>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ai {
  position: relative;
  height: 100%;
  container-type: inline-size;
  overflow: hidden;
  font-size: clamp(8px, 1.5cqw, 14px);
  color: #334155;
  background-color: hsl(213 40% 96.5%);
  background-image: radial-gradient(hsl(215 25% 80%) 1px, transparent 1px);
  background-size: 1.6em 1.6em;
}

p {
  margin: 0;
}

.folder {
  position: absolute;
  top: 6%;
  left: 4%;
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  border: 1px solid var(--pc-gray-border);
  border-radius: 0.6em;
  background: white;
  padding: 0.35em 0.7em;
  font-weight: 600;
  color: #475569;
}

/* ── What the folder holds ───────────────────────────── */

.file {
  position: absolute;
  box-shadow: 0 0.7em 1.4em -0.8em rgb(15 23 42 / 0.4);
}

.file-photo {
  top: 19%;
  left: 5%;
  display: flex;
  width: 20%;
  height: 44%;
  flex-direction: column;
  border: 1px solid var(--pc-gray-border);
  border-radius: 0.85em;
  background: white;
  padding: 0.5em;
  rotate: -1.5deg;
}

.thumb {
  flex: 1;
  min-height: 0;
  border-radius: 0.5em;
  background:
    radial-gradient(circle at 76% 26%, #fde68a 0 0.7em, transparent 0.75em),
    linear-gradient(160deg, #bae6fd 0%, #7dd3fc 40%, #2182f8 100%);
}

.file-name {
  margin: 0.45em 0.15em 0.05em;
  font-weight: 700;
}

.file-note {
  top: 22%;
  left: 28%;
  width: 16%;
  border: 1px solid rgb(252 211 77 / 0.9);
  border-radius: 0.7em;
  background: #fff7d6;
  padding: 0.6em 0.75em;
  color: rgb(120 53 15 / 0.85);
  rotate: 2deg;
}

.note-title {
  font-weight: 700;
}

.note-copy {
  margin-top: 0.2em;
  color: rgb(120 53 15 / 0.65);
  line-height: 1.35;
}

/* ── Ideas ───────────────────────────────────────────── */

.idea {
  position: absolute;
  width: 22%;
  min-height: 24%;
  box-sizing: border-box;
  border: 1.5px dashed rgb(33 130 248 / 0.6);
  border-radius: 0.85em;
  background: hsl(214 100% 98.5%);
  padding: 0.6em 0.75em 0.7em;
  box-shadow:
    0 0 0 0.3em rgb(33 130 248 / 0.07),
    0 0.8em 1.6em -0.8em rgb(33 130 248 / 0.45);
  /* Hidden: tucked into the bar */
  opacity: 0;
  translate: var(--fly-x) var(--fly-y);
  scale: 0.35;
  transition:
    opacity 0.35s ease,
    translate 0.6s cubic-bezier(0.2, 0.9, 0.3, 1.15),
    scale 0.6s cubic-bezier(0.2, 0.9, 0.3, 1.15),
    border-color 0.4s ease,
    background-color 0.4s ease,
    box-shadow 0.4s ease;
  transition-delay: calc(var(--i) * 150ms);
}

.is-shown .idea {
  opacity: 1;
  translate: 0 0;
  scale: 1;
}

/* Added: the same places, now plain notes */
.is-added .idea {
  border-style: solid;
  border-color: var(--pc-gray-border);
  background: white;
  box-shadow: 0 0.7em 1.4em -0.8em rgb(15 23 42 / 0.4);
  transition-delay: calc(var(--i) * 90ms);
}

.is-fading .idea {
  opacity: 0;
  translate: 0 -0.6em;
  transition-delay: calc(var(--i) * 80ms);
}

.idea-fog {
  top: 12%;
  left: 49%;
  --fly-x: 10%;
  --fly-y: 170%;
}

.idea-lighthouse {
  top: 12%;
  left: 74%;
  --fly-x: -90%;
  --fly-y: 170%;
}

.idea-rope {
  top: 44%;
  left: 49%;
  --fly-x: 20%;
  --fly-y: 70%;
}

.idea-skel,
.idea-body {
  transition: opacity 0.35s ease;
  transition-delay: calc(var(--i) * 250ms);
}

.idea-skel {
  position: absolute;
  inset: 0.7em 0.75em;
  display: flex;
  flex-direction: column;
  gap: 0.45em;
}

.idea-body {
  opacity: 0;
}

.is-resolved .idea-skel {
  opacity: 0;
}

.is-resolved .idea-body {
  opacity: 1;
}

.skel {
  display: block;
  border-radius: 0.35em;
  background: linear-gradient(90deg, hsl(213 40% 93%) 0%, hsl(213 60% 97%) 50%, hsl(213 40% 93%) 100%);
  background-size: 200% 100%;
}

.skel-line {
  height: 0.8em;
}

.skel-short {
  width: 60%;
}

.idea-head {
  display: flex;
  align-items: center;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25em;
  border-radius: 999px;
  background: var(--color-pc-50);
  padding: 0.15em 0.5em;
  font-size: 0.8em;
  font-weight: 700;
  color: var(--color-pc-600);
  transition: opacity 0.3s ease;
}

.check {
  display: grid;
  place-items: center;
  margin-left: auto;
  width: 1.2em;
  height: 1.2em;
  border-radius: 0.3em;
  background: var(--color-pc-500);
  color: white;
  transition: opacity 0.3s ease;
}

.is-added .badge,
.is-added .check {
  opacity: 0;
}

.idea-title {
  margin-top: 0.45em;
  font-weight: 700;
  color: #1e293b;
}

.idea-copy {
  margin-top: 0.2em;
  color: #64748b;
  line-height: 1.35;
}

/* ── The bar under the board ─────────────────────────── */

.bar {
  position: absolute;
  bottom: 7%;
  left: 50%;
  width: 66%;
  translate: -50% 0;
  isolation: isolate;
}

/* The "thinking" glow runs around the bar while ideas are written */
.bar::before,
.bar::after {
  content: "";
  position: absolute;
  inset: -2px;
  z-index: -1;
  border-radius: 1em;
  background: linear-gradient(90deg, #2182f8, #a78bfa, #38bdf8, #f0abfc, #2182f8);
  background-size: 300% 100%;
  opacity: 0;
  transition: opacity 0.35s ease;
}

.bar::after {
  inset: -0.4em;
  filter: blur(0.9em);
}

.is-thinking .bar::before {
  opacity: 1;
}

.is-thinking .bar::after {
  opacity: 0.55;
}

.bar-panel {
  display: flex;
  align-items: center;
  gap: 0.5em;
  border: 1px solid var(--pc-gray-border);
  border-radius: 1em;
  background: white;
  padding: 0.55em 0.55em 0.55em 0.9em;
  box-shadow: 0 0.8em 1.6em -0.8em rgb(15 23 42 / 0.35);
}

.bar-text {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  overflow: hidden;
  font-weight: 500;
  white-space: nowrap;
  color: #1e293b;
}

.bar-placeholder {
  color: #94a3b8;
}

.caret {
  width: 1.5px;
  height: 1.15em;
  margin-left: 1px;
  background: var(--color-pc-500);
}

.enter {
  display: grid;
  width: 1.9em;
  height: 1.9em;
  place-items: center;
  border: 1px solid var(--pc-gray-border);
  border-bottom-width: 2px;
  border-radius: 0.45em;
  background: hsl(213 40% 97%);
  font-weight: 600;
  color: #64748b;
}

.pill {
  flex-shrink: 0;
  border: 1px solid var(--pc-gray-border);
  border-radius: 0.55em;
  background: white;
  padding: 0.3em 0.7em;
  font-weight: 600;
  color: #475569;
}

.pill-plain {
  border-color: transparent;
}

.pill-main {
  border-color: var(--color-pc-500);
  background: var(--color-pc-500);
  color: white;
  transition: scale 0.15s ease, filter 0.15s ease;
}

.pill-main.is-pressed {
  scale: 0.92;
  filter: brightness(0.9);
}

/* Narrow cards: fewer words, same story */
@container (max-width: 520px) {
  .idea-copy,
  .file-note,
  .idea-rope,
  .pill:not(.pill-main) {
    display: none;
  }

  .bar {
    width: 88%;
  }

  .file-photo {
    top: 20%;
    width: 24%;
    height: 42%;
  }

  .idea {
    top: 20%;
    width: 30%;
  }

  .idea-fog {
    left: 32%;
  }

  .idea-lighthouse {
    left: 66%;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .skel {
    animation: ai-shimmer 1.2s linear infinite;
  }

  .caret {
    animation: ai-caret 1s steps(1) infinite;
  }

  .bar::before,
  .bar::after {
    animation: ai-flow 2.4s linear infinite;
  }
}

@media (prefers-reduced-motion: reduce) {
  .idea,
  .idea-skel,
  .idea-body {
    transition: none;
  }
}

@keyframes ai-shimmer {
  to {
    background-position: -200% 0;
  }
}

@keyframes ai-caret {
  50% {
    opacity: 0;
  }
}

@keyframes ai-flow {
  to {
    background-position: 300% 0;
  }
}
</style>
