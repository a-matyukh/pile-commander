<!-- AI tools: a prompt typed into the folder turns into idea cards on the
     board. The other actions are static chips — named, not working.
     SSR, no-JS and reduced motion get the finished frame. -->
<script setup lang="ts">
const PROMPT = "Ideas for the harbor moodboard";

const root = ref<HTMLElement>();
// The finished frame; the loop rewinds it on the client.
const typed = ref(PROMPT);
const thinking = ref(false);
const shown = ref(true);
const resolved = ref(true);
const fading = ref(false);
const typing = ref(false);

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
  fading.value = false;

  const typeStart = 600;
  const perChar = 70;
  for (let i = 1; i <= PROMPT.length; i++) {
    at(typeStart + i * perChar, () => (typed.value = PROMPT.slice(0, i)));
  }
  const sent = typeStart + PROMPT.length * perChar + 250;
  at(sent, () => {
    typing.value = false;
    thinking.value = true;
  });
  at(sent + 200, () => (shown.value = true));
  at(sent + 1200, () => (resolved.value = true));
  at(sent + 1900, () => (thinking.value = false));
  at(sent + 3200, () => (typed.value = ""));
  at(sent + 5600, () => (fading.value = true));
  at(sent + 6600, cycle);
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

const ideas = [
  { key: "fog", kind: "note" },
  { key: "lighthouse", kind: "image" },
  { key: "palette", kind: "palette" },
] as const;

const palette = ["#b45309", "#e7d3b0", "#0e7490", "#1e3a5f"];
</script>

<template>
  <div
    ref="root"
    class="ai"
    :class="{ 'is-thinking': thinking, 'is-shown': shown, 'is-resolved': resolved, 'is-fading': fading }"
    aria-hidden="true"
  >
    <p class="folder">
      <UIcon name="i-lucide-folder" class="size-[1.15em] text-pc-600" />
      Harbor moodboard
    </p>

    <!-- Files already in the folder -->
    <article class="file file-photo">
      <div class="thumb" />
      <p class="file-name">Harbor</p>
    </article>

    <article class="file file-note">
      <p class="note-title">Mood</p>
      <p class="note-copy">warm light<br />quiet room</p>
    </article>

    <!-- Ideas the prompt adds -->
    <article
      v-for="(idea, i) in ideas"
      :key="idea.key"
      class="idea"
      :class="`idea-${idea.key}`"
      :style="{ '--i': i }"
    >
      <div class="idea-skel">
        <span class="skel skel-block" v-if="idea.kind !== 'note'" />
        <span class="skel skel-line" />
        <span class="skel skel-line skel-short" />
      </div>

      <div class="idea-body">
        <span class="badge">
          <UIcon name="i-lucide-sparkles" class="size-[1em]" />
          AI
        </span>

        <template v-if="idea.kind === 'note'">
          <p class="idea-title">Fog at dawn</p>
          <p class="idea-copy">Shoot the pier before sunrise, while the water is still.</p>
        </template>

        <template v-else-if="idea.kind === 'image'">
          <div class="lighthouse">
            <span class="tower" />
          </div>
          <p class="idea-title">Lighthouse close-up</p>
        </template>

        <template v-else>
          <div class="swatches">
            <span v-for="color in palette" :key="color" class="swatch" :style="{ background: color }" />
          </div>
          <p class="idea-title">Rope &amp; rust</p>
        </template>
      </div>
    </article>

    <!-- Actions: only the first one runs in this loop -->
    <ul class="actions">
      <li class="action action-live">
        <UIcon name="i-lucide-sparkles" class="size-[1em]" />
        Generate ideas
      </li>
      <li class="action">Sort into folders</li>
      <li class="action">Summarize</li>
      <li class="action action-extra">Name files</li>
    </ul>

    <div class="prompt">
      <div class="prompt-bar">
        <UIcon name="i-lucide-sparkles" class="size-[1.15em] shrink-0 text-pc-500" />
        <p class="prompt-text">
          <span v-if="typed">{{ typed }}</span>
          <span v-else class="prompt-placeholder">Ask this folder…</span>
          <span v-if="typing" class="caret" />
        </p>
        <kbd class="enter">↵</kbd>
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

/* ── Files already there ─────────────────────────────── */

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
  border: 1px solid var(--color-pc-200);
  border-radius: 0.85em;
  background: white;
  padding: 0.65em 0.75em 0.7em;
  box-shadow:
    0 0 0 0.3em rgb(33 130 248 / 0.07),
    0 0.8em 1.6em -0.8em rgb(33 130 248 / 0.45);
  /* Hidden: tucked into the prompt bar. */
  opacity: 0;
  translate: var(--fly-x) var(--fly-y);
  scale: 0.35;
  transition:
    opacity 0.35s ease,
    translate 0.6s cubic-bezier(0.2, 0.9, 0.3, 1.15),
    scale 0.6s cubic-bezier(0.2, 0.9, 0.3, 1.15);
  transition-delay: calc(var(--i) * 150ms);
}

.is-shown .idea {
  opacity: 1;
  translate: 0 0;
  scale: 1;
}

.is-fading .idea {
  opacity: 0;
  translate: 0 -0.6em;
  scale: 1;
  transition-delay: calc(var(--i) * 80ms);
}

.idea-fog {
  top: 14%;
  left: 49%;
  width: 22%;
  rotate: -1deg;
  --fly-x: 20%;
  --fly-y: 160%;
}

.idea-lighthouse {
  top: 10%;
  left: 75%;
  width: 20%;
  rotate: 1.5deg;
  --fly-x: -110%;
  --fly-y: 110%;
}

.idea-palette {
  top: 45%;
  left: 55%;
  width: 18%;
  rotate: 1deg;
  --fly-x: -20%;
  --fly-y: 90%;
}

.idea-skel,
.idea-body {
  transition: opacity 0.35s ease;
  transition-delay: calc(var(--i) * 250ms);
}

.idea-skel {
  position: absolute;
  inset: 0.65em 0.75em;
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

.skel-block {
  flex: 1;
  min-height: 2em;
}

.skel-line {
  height: 0.8em;
}

.skel-short {
  width: 60%;
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

.lighthouse {
  position: relative;
  height: 6.5em;
  margin-top: 0.5em;
  overflow: hidden;
  border-radius: 0.5em;
  background: linear-gradient(180deg, #fde4cf 0%, #fbc4ab 52%, #7dd3fc 53%, #2182f8 100%);
}

.tower {
  position: absolute;
  bottom: 38%;
  left: 38%;
  width: 1.1em;
  height: 3.3em;
  border-radius: 0.2em 0.2em 0 0;
  background: repeating-linear-gradient(180deg, #ef4444 0 0.55em, #fff 0.55em 1.1em);
}

.tower::before {
  content: "";
  position: absolute;
  bottom: 100%;
  left: 50%;
  width: 1.5em;
  height: 0.7em;
  translate: -50% 0;
  border-radius: 0.3em 0.3em 0 0;
  background: #334155;
}

.tower::after {
  content: "";
  position: absolute;
  bottom: calc(100% + 0.25em);
  left: 50%;
  width: 5em;
  height: 1.2em;
  translate: -50% 0;
  background: radial-gradient(ellipse at center, rgb(254 240 138 / 0.9), transparent 70%);
}

.swatches {
  display: flex;
  gap: 0.35em;
  margin-top: 0.55em;
}

.swatch {
  width: 1.7em;
  height: 1.7em;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px rgb(15 23 42 / 0.08);
}

/* ── Actions + prompt ────────────────────────────────── */

.actions {
  position: absolute;
  bottom: 22%;
  left: 50%;
  display: flex;
  gap: 0.45em;
  margin: 0;
  padding: 0;
  list-style: none;
  translate: -50% 0;
  white-space: nowrap;
}

.action {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  border: 1px solid var(--pc-gray-border);
  border-radius: 999px;
  background: rgb(255 255 255 / 0.7);
  padding: 0.3em 0.75em;
  font-weight: 600;
  color: #94a3b8;
}

.action-live {
  border-color: var(--color-pc-200);
  background: white;
  color: var(--color-pc-700);
  transition:
    background-color 0.25s ease,
    color 0.25s ease,
    border-color 0.25s ease;
}

.is-thinking .action-live {
  border-color: var(--color-pc-500);
  background: var(--color-pc-500);
  color: white;
}

.prompt {
  position: absolute;
  bottom: 7%;
  left: 50%;
  width: 58%;
  translate: -50% 0;
  isolation: isolate;
}

/* The "thinking" glow runs around the bar while ideas are made. */
.prompt::before,
.prompt::after {
  content: "";
  position: absolute;
  inset: -2px;
  z-index: -1;
  border-radius: 999px;
  background: linear-gradient(90deg, #2182f8, #a78bfa, #38bdf8, #f0abfc, #2182f8);
  background-size: 300% 100%;
  opacity: 0;
  transition: opacity 0.35s ease;
}

.prompt::after {
  inset: -0.4em;
  filter: blur(0.9em);
}

.is-thinking .prompt::before {
  opacity: 1;
}

.is-thinking .prompt::after {
  opacity: 0.55;
}

.prompt-bar {
  display: flex;
  align-items: center;
  gap: 0.6em;
  border: 1px solid var(--pc-gray-border);
  border-radius: 999px;
  background: white;
  padding: 0.7em 0.7em 0.7em 1em;
  box-shadow: 0 0.8em 1.6em -0.8em rgb(15 23 42 / 0.35);
}

.prompt-text {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  overflow: hidden;
  font-weight: 500;
  white-space: nowrap;
  color: #1e293b;
}

.prompt-placeholder {
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
  font-family: inherit;
  font-weight: 600;
  color: #64748b;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}

.is-thinking .enter {
  border-color: var(--color-pc-500);
  background: var(--color-pc-500);
  color: white;
}

/* Narrow cards: fewer words, same story. */
@container (max-width: 520px) {
  .action-extra,
  .idea-copy,
  .file-note,
  .idea-palette {
    display: none;
  }

  .actions {
    bottom: 25%;
    font-size: 0.9em;
  }

  .prompt {
    width: 84%;
  }

  .file-photo {
    top: 20%;
    width: 22%;
    height: 42%;
  }

  .idea-fog {
    top: 20%;
    left: 32%;
    width: 29%;
  }

  .idea-lighthouse {
    top: 9%;
    left: 67%;
    width: 28%;
  }

  .lighthouse {
    height: 4em;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .skel {
    animation: ai-shimmer 1.2s linear infinite;
  }

  .caret {
    animation: ai-caret 1s steps(1) infinite;
  }

  .prompt::before,
  .prompt::after {
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
