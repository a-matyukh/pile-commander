<!-- Block 3, AI. The folder's four AI actions, named as the app names them
     (AiItems.vue: verb and object), on the person's own model or their
     agent. A tour like blocks 1 and 2: each action first shows the ✨ menu
     with its item, then what the app opens for it — a dialog to check, or
     idea cards on the board — since nothing changes until the person
     confirms. Then Settings → AI with a model on this computer, and an agent
     whose plan opens in the app's own dialog. Facts as on /alt2, checked
     against the app: any OpenAI-compatible provider; Ollama and LM Studio in
     the desktop app; the MCP server in the desktop app on macOS and Linux. -->
<script setup lang="ts">
import { homeBookmarks, homeTree } from "~/utils/finalFolder";
import type { Crumb } from "./AppWindow.vue";

type AiStep = "summarize" | "rename" | "sort" | "ideas" | "model" | "agent";

const crumbs: Crumb[] = [{ glyph: "home" }, { name: "Pictures" }];

const steps: { id: AiStep; label: string; icon: string; caption: string }[] = [
  { id: "summarize", label: "Summarize this folder", icon: "i-tabler-file-description", caption: "What the folder holds, in a few lines. Keep it as a note next to it, or discard it." },
  { id: "rename", label: "Rename files by content", icon: "i-tabler-forms", caption: "Names from what is inside: photos by what they show, notes by what they say. Uncheck what to keep." },
  { id: "sort", label: "Sort into folders", icon: "i-tabler-folders", caption: "A plan of folders with checkboxes. Nothing moves until you click Sort." },
  { id: "ideas", label: "Generate ideas", icon: "i-tabler-bulb", caption: "New ideas as cards right on the board. The ones you add become ordinary notes." },
  { id: "model", label: "Your model", icon: "i-lucide-plug", caption: "Any OpenAI-compatible provider with your key, or Ollama and LM Studio on your computer, which sends nothing out." },
  { id: "agent", label: "Your agent", icon: "i-lucide-terminal", caption: "Claude or Cursor works on your folders through the app's MCP server, and each plan opens in the app for your OK. Desktop app, macOS and Linux." },
];

/** The ✨ menu (AiItems.vue), in the app's order */
const menu = [
  { id: "summarize", icon: "i-tabler-file-description", label: "Summarize this folder" },
  { id: "rename", icon: "i-tabler-forms", label: "Rename files by content" },
  { id: "sort", icon: "i-tabler-folders", label: "Sort into folders" },
  { id: "ideas", icon: "i-tabler-bulb", label: "Generate ideas" },
];

const step = ref<AiStep>("summarize");
const meta = computed(() => steps.find(s => s.id === step.value)!);
const playing = ref(true);

/** An action first shows the menu with its item, then what it opens */
const phase = ref<"menu" | "result">("menu");
let phaseTimer: number | undefined;

function show(id: AiStep) {
  step.value = id;
  window.clearTimeout(phaseTimer);
  const action = menu.some(m => m.id === id);
  phase.value = action ? "menu" : "result";
  if (action) phaseTimer = window.setTimeout(() => { phase.value = "result"; }, 1300);
}

function pick(id: AiStep) {
  playing.value = false;
  show(id);
}

function next() {
  const i = steps.findIndex(s => s.id === step.value);
  show(steps[(i + 1) % steps.length]!.id);
}

function toggle() {
  playing.value = !playing.value;
  if (playing.value) next();
}

const root = useTemplateRef<HTMLElement>("root");

onMounted(() => {
  show(step.value);
  let visible = false;
  const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; }, { threshold: 0.35 });
  if (root.value) io.observe(root.value);
  const timer = window.setInterval(() => {
    if (visible && playing.value) next();
  }, 4600);
  onBeforeUnmount(() => {
    io.disconnect();
    window.clearInterval(timer);
    window.clearTimeout(phaseTimer);
  });
});

const menuOpen = computed(() => phase.value === "menu" && menu.some(m => m.id === step.value));
const dialog = computed(() => {
  if (phase.value !== "result") return null;
  if (step.value === "summarize" || step.value === "rename" || step.value === "sort" || step.value === "agent") return step.value;
  return null;
});

/* Generate ideas: the app's idea cards (IdeaGhosts.vue), checked or not */
const ideas = [
  { title: "Salt and citrus", text: "Lemon slices on a wet stone, sea light.", on: true, x: 4, y: 62 },
  { title: "Blue hour", text: "The horizon after sunset, one warm note.", on: true, x: 21.5, y: 62 },
  { title: "Fruit market", text: "Raspberries in paper cones, hands only.", on: false, x: 39, y: 62 },
];
</script>

<template>
  <section id="ai" ref="root" class="sec" aria-labelledby="ai-title">
    <div class="lf-wrap">
      <header class="head">
        <span class="lf-marker" aria-hidden="true">3</span>
        <div class="trow">
          <h2 id="ai-title" class="title">AI</h2>
          <button type="button" class="play" :aria-pressed="playing" @click="toggle">
            <UIcon :name="playing ? 'i-tabler-player-pause' : 'i-tabler-player-play'" class="pi" />
            {{ playing ? "Pause" : "Play" }}
          </button>
          <p class="hint"><UIcon name="i-tabler-pointer" class="pi" />Pick one to see it</p>
        </div>
        <p class="lede">Four actions in every folder, on your own model or your agent. You see the result first, and nothing changes until you confirm.</p>

        <div class="steps" role="group" aria-label="What AI does in a folder">
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

      <div class="stage">
        <FinalAppWindow
          class="shot"
          :crumbs="step === 'model' ? [] : crumbs"
          :title="step === 'model' ? 'Settings' : 'Harbor moodboard'"
          :bookmarks="homeBookmarks('board')"
          :tree="homeTree('board')"
          :markers="step === 'model' ? [] : [3]"
          :actions="step !== 'model'"
          :open="menuOpen ? 'ai' : null"
        >
          <!-- Settings → AI (AiSettingsSection.vue) with a model on this computer -->
          <div v-if="step === 'model'" class="settings">
            <p class="sh">AI</p>
            <div class="sr"><span class="k">Provider</span><span class="v select">Ollama<UIcon name="i-tabler-chevron-down" class="vi" /></span></div>
            <div class="sr"><span class="k">Address</span><span class="v field">http://localhost:11434/v1</span></div>
            <div class="sr"><span class="k">API key</span><span class="v field muted">Optional</span></div>
            <div class="sr">
              <span class="k">Connection</span>
              <span class="v test"><span class="tbtn">Test connection</span><span class="ok"><UIcon name="i-tabler-circle-check" class="vi" />Connected: 4 models available</span></span>
            </div>
            <div class="sr"><span class="k">Model</span><span class="v field">gemma3</span></div>
            <p class="providers">Or OpenAI, OpenRouter, DeepSeek, Fireworks, LM Studio, any OpenAI-compatible server.</p>
          </div>

          <div v-else class="board-wrap">
            <FinalFolderViews view="board" />

            <!-- Generate ideas: cards to check, and the bar under them -->
            <template v-if="step === 'ideas' && phase === 'result'">
              <div
                v-for="(idea, i) in ideas"
                :key="idea.title"
                class="ghost"
                :class="{ off: !idea.on }"
                :style="{ left: `${idea.x}%`, top: `${idea.y}%`, '--i': i }"
              >
                <span class="gh"><span class="gb"><UIcon name="i-lucide-sparkles" class="gbi" />AI</span><span class="gc" :class="{ on: idea.on }"><UIcon v-if="idea.on" name="i-lucide-check" class="gci" /></span></span>
                <p class="gt">{{ idea.title }}</p>
                <p class="gx">{{ idea.text }}</p>
              </div>
              <div class="ibar">
                <span class="ifield"><UIcon name="i-lucide-sparkles" class="ifi" />Shots for the coastal campaign</span>
                <span class="ib outline"><UIcon name="i-lucide-sparkles" class="ifi" />More</span>
                <span class="ib ghost-btn">Cancel</span>
                <span class="ib primary">Add 2</span>
              </div>
            </template>
          </div>

          <template #over>
            <!-- The ✨ menu under its button: AI is followed by sync, share and more -->
            <div v-if="menuOpen" class="am aim">
              <div v-for="m in menu" :key="m.id" class="am-i" :class="{ hl: m.id === step }">
                <UIcon :name="m.icon" class="am-ic" />{{ m.label }}
              </div>
            </div>
          </template>

          <template #modal>
            <FinalAiDialog v-if="dialog" :kind="dialog" />
          </template>
        </FinalAppWindow>

        <!-- Your agent: its terminal on the desktop, beside the app -->
        <div v-if="step === 'agent'" class="term" aria-hidden="true">
          <div class="tbar"><span class="dot" /><span class="dot" /><span class="dot" /><span class="tname">Claude Code</span></div>
          <div class="tbody">
            <p><span class="pr">&gt;</span> Sort my Harbor moodboard folder into folders</p>
            <p class="tool"><span class="bul">●</span> pile-commander · <b>propose_move</b></p>
            <p class="said">I've proposed three folders. The plan is open in Pile Commander for you to check.</p>
          </div>
        </div>
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

/* Room under the window for the agent's terminal, on every step, so the
   page does not jump when it shows */
.stage {
  position: relative;
  padding-bottom: 5.5rem;
}

.board-wrap {
  position: relative;
}

.board-wrap :deep(.fv),
.settings {
  --fv-h: 32em;
}

/* The ✨ menu: 300px; AI is followed by sync, share and more */
.aim {
  position: absolute;
  top: 3.25em;
  right: calc(1.25em + 3 * 2.6em);
  z-index: 3;
  width: 23em;
}

/* ── Settings → AI ───────────────────────────────────── */

.settings {
  height: var(--fv-h);
  box-sizing: border-box;
  background: #fff;
  padding: 1.6em 2.4em;
  color: #1f1f1e;
}

.sh {
  margin: 0 0 0.8em;
  font-size: 1.25em;
  font-weight: 600;
}

.sr {
  display: grid;
  grid-template-columns: 9em minmax(0, 26em);
  align-items: center;
  gap: 1em;
  border-bottom: 1px solid rgb(0 0 0 / 0.08);
  padding: 0.7em 0;
}

.k {
  color: #5f5e5a;
}

.v {
  display: flex;
  align-items: center;
  gap: 0.6em;
}

.field,
.select {
  justify-content: space-between;
  border: 1px solid rgb(0 0 0 / 0.15);
  border-radius: 0.54em;
  padding: 0.5em 0.7em;
}

.muted {
  color: #9a9893;
}

.vi {
  width: 1.15em;
  height: 1.15em;
  flex: none;
}

.tbtn {
  border: 1px solid rgb(0 0 0 / 0.15);
  border-radius: 0.54em;
  padding: 0.45em 0.9em;
  font-weight: 500;
  white-space: nowrap;
}

.ok {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  color: #3b6d11;
  white-space: nowrap;
}

.providers {
  margin: 1.2em 0 0;
  color: #9a9893;
}

/* ── Generate ideas: cards and the bar (IdeaGhosts.vue, IdeasBar.vue) ── */

.ghost {
  position: absolute;
  z-index: 2;
  display: flex;
  width: 16%;
  box-sizing: border-box;
  flex-direction: column;
  gap: 0.3em;
  border: 1.5px dashed rgb(33 130 248 / 0.6);
  border-radius: 0.77em;
  background: #f1f7ff;
  padding: 0.6em 0.77em 0.77em;
  box-shadow: 0 0 0 0.3em rgb(33 130 248 / 0.08), 0 0.9em 1.8em -1.2em rgb(33 130 248 / 0.7);
}

@media (prefers-reduced-motion: no-preference) {
  .ghost {
    animation: ghost-in 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.15) both;
    animation-delay: calc(var(--i) * 70ms);
  }
}

@keyframes ghost-in {
  from {
    opacity: 0;
    scale: 0.92;
  }
}

.ghost.off {
  opacity: 0.45;
  border-color: rgb(0 0 0 / 0.15);
  box-shadow: none;
}

.gh {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.gb {
  display: inline-flex;
  align-items: center;
  gap: 0.25em;
  border-radius: 99em;
  background: rgb(33 130 248 / 0.12);
  padding: 0.08em 0.54em;
  color: #2182f8;
  font-size: 0.85em;
  font-weight: 600;
}

.gbi {
  width: 0.92em;
  height: 0.92em;
}

.gc {
  display: grid;
  width: 1.23em;
  height: 1.23em;
  box-sizing: border-box;
  place-items: center;
  border: 1px solid rgb(0 0 0 / 0.25);
  border-radius: 0.3em;
  background: #fff;
  color: #fff;
}

.gc.on {
  border-color: #2182f8;
  background: #2182f8;
}

.gci {
  width: 0.92em;
  height: 0.92em;
}

.gt {
  margin: 0;
  font-weight: 600;
  line-height: 1.3;
}

.gx {
  margin: 0;
  color: #5f5e5a;
  font-size: 0.92em;
  line-height: 1.4;
}

.ibar {
  position: absolute;
  bottom: 0.7em;
  left: 50%;
  z-index: 3;
  display: flex;
  width: min(52em, 92%);
  box-sizing: border-box;
  align-items: center;
  gap: 0.77em;
  border: 1px solid rgb(0 0 0 / 0.15);
  border-radius: 2em;
  background: #fff;
  padding: 0.46em 0.46em 0.46em 0.92em;
  box-shadow: 0 0.62em 1.85em rgb(0 0 0 / 0.1), 0 0.15em 0.46em rgb(0 0 0 / 0.06);
  translate: -50% 0;
}

.ifield {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 0.5em;
  color: #1f1f1e;
}

.ifi {
  width: 1.15em;
  height: 1.15em;
  flex: none;
  color: #9a9893;
}

.ib {
  display: inline-flex;
  height: 2.3em;
  align-items: center;
  gap: 0.35em;
  border-radius: 99em;
  padding: 0 1em;
  font-size: 0.92em;
  font-weight: 500;
  white-space: nowrap;
}

.ib.outline {
  border: 1px solid rgb(0 0 0 / 0.15);
}

.ib.primary {
  background: #2182f8;
  color: #fff;
}

/* ── Your agent: its terminal beside the app ─────────── */


.term {
  position: absolute;
  bottom: 0;
  left: -1.25rem;
  z-index: 6;
  width: min(23rem, 70%);
  overflow: hidden;
  border-radius: 12px;
  background: #16181d;
  box-shadow: 0 24px 60px -24px rgb(0 0 0 / 0.5);
  color: #d6d9e0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8125rem;
}

/* On a phone the terminal would cover the app: it goes under the window */
@media (max-width: 760px) {
  .stage {
    padding-bottom: 0;
  }

  .term {
    position: relative;
    left: 0;
    width: auto;
    margin-top: 0.75rem;
  }
}

.tbar {
  display: flex;
  align-items: center;
  gap: 0.4em;
  border-bottom: 1px solid rgb(255 255 255 / 0.08);
  padding: 0.6em 0.8em;
}

.dot {
  width: 0.7em;
  height: 0.7em;
  border-radius: 50%;
  background: rgb(255 255 255 / 0.2);
}

.tname {
  margin-left: 0.5em;
  color: rgb(255 255 255 / 0.6);
}

.tbody {
  padding: 0.8em 1em 1em;
  line-height: 1.5;
}

.tbody p {
  margin: 0 0 0.5em;
}

.pr {
  color: #9aa3b5;
}

.tool {
  color: #9aa3b5;
}

.bul {
  color: #6ee7a8;
}

.tool b {
  color: #fff;
  font-weight: 600;
}

.said {
  color: #fff;
}
</style>
