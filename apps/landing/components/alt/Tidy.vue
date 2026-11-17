<!-- The four AI actions, each played by the home page's own scene. The labels
     are the app's action names and the texts repeat components/home/AiTools.vue
     word for word: keep the two in step while both pages exist. -->
<script setup lang="ts">
type SceneId = "names" | "summary" | "ideas" | "sort";

const scenes: { id: SceneId; label: string; icon: string; caption: string }[] = [
  {
    id: "names",
    label: "Rename files by content",
    icon: "i-lucide-tag",
    caption: "Select files and get names from what is inside them: notes are read, images looked at. A list of old and new, each with a checkbox.",
  },
  {
    id: "summary",
    label: "Summarize this folder",
    icon: "i-lucide-file-text",
    caption: "A short note about what the folder holds, or what is selected in it, lands right next to it.",
  },
  {
    id: "ideas",
    label: "Generate ideas",
    icon: "i-lucide-lightbulb",
    caption: "Say what the ideas should be about, or leave it empty. They appear on the board as cards where their notes will go; keep the ones you like.",
  },
  {
    id: "sort",
    label: "Sort into folders",
    icon: "i-lucide-folders",
    caption: "The model plans folders, new or already there, and lists what goes into each. Uncheck, rename a folder, then sort: they stand where their files stood.",
  },
];

const notes = [
  {
    title: "Your own model",
    body: "OpenAI, OpenRouter or any OpenAI-compatible address. In the desktop app also Ollama or LM Studio on your computer, and the key stays in the system's password storage.",
  },
  {
    title: "Nothing changes without Accept",
    body: "Names come as a list of old and new, ideas as cards on the board, folders as a plan with checkboxes. What you accept is ordinary files, and one undo takes it back.",
  },
  {
    title: "Asks before the cloud",
    body: "A model on your computer sends nothing out. A cloud provider asks once before names and notes go, and again before images.",
  },
];

const active = ref<SceneId>("names");
const activeScene = computed(() => scenes.find(scene => scene.id === active.value) ?? scenes[0]!);

/** The tabs play one after another until the person picks one */
const autoplay = ref(true);
const tabs = useTemplateRef<HTMLButtonElement[]>("tabs");

function pick(id: SceneId) {
  autoplay.value = false;
  active.value = id;
}

function next() {
  if (!autoplay.value) return;
  const index = scenes.findIndex(scene => scene.id === active.value);
  active.value = scenes[(index + 1) % scenes.length]!.id;
}

/** Arrow keys move between tabs, as a tab list should */
function onKey(event: KeyboardEvent) {
  const index = scenes.findIndex(scene => scene.id === active.value);
  const last = scenes.length - 1;
  const to
    = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
        : event.key === "Home" ? 0
          : event.key === "End" ? last
            : -1;
  if (to < 0) return;
  event.preventDefault();
  pick(scenes[to]!.id);
  nextTick(() => tabs.value?.[to]?.focus());
}
</script>

<template>
  <AltSection
    label="Tidy"
    shape="rect"
    title="AI that tidies the pile you already have."
    lede="Four things a model does with a folder: names files by what is in them, sums up a folder in a note, brings ideas as cards on the board, and sorts a pile into folders. You see every change before it happens."
  >
    <div class="tabs-scroll">
      <div role="tablist" aria-label="AI actions" class="tabs" @keydown="onKey">
        <button
          v-for="scene in scenes"
          :id="`alt-ai-tab-${scene.id}`"
          :key="scene.id"
          ref="tabs"
          type="button"
          role="tab"
          :aria-selected="active === scene.id"
          :tabindex="active === scene.id ? 0 : -1"
          aria-controls="alt-ai-stage"
          class="tab"
          :class="{ 'is-on': active === scene.id }"
          @click="pick(scene.id)"
        >
          <UIcon :name="scene.icon" class="size-4" />
          {{ scene.label }}
        </button>
      </div>
    </div>

    <div
      id="alt-ai-stage"
      role="tabpanel"
      :aria-labelledby="`alt-ai-tab-${active}`"
      class="alt-frame stage"
    >
      <div class="stage-box">
        <HomeAiNamingScene v-if="active === 'names'" key="names" mode="names" @done="next" />
        <HomeAiNamingScene v-else-if="active === 'summary'" key="summary" mode="summary" @done="next" />
        <HomeAiIdeasScene v-else-if="active === 'ideas'" @done="next" />
        <HomeAiSortScene v-else @done="next" />
      </div>
    </div>

    <p class="caption" aria-live="polite">{{ activeScene.caption }}</p>

    <ul class="notes">
      <li v-for="note in notes" :key="note.title">
        <h3 class="alt-h3">{{ note.title }}</h3>
        <p class="note-body">{{ note.body }}</p>
      </li>
    </ul>
  </AltSection>
</template>

<style scoped>
/* On a phone the row of tabs scrolls sideways, out to the screen's edges */
.tabs-scroll {
  margin-inline: calc(-1 * var(--alt-gutter));
  overflow-x: auto;
  padding: 3px var(--alt-gutter) 1rem;
}

.tabs {
  display: inline-flex;
  gap: 0.25rem;
  border: 1px solid var(--alt-line);
  border-radius: 999px;
  background: var(--alt-paper);
  padding: 0.25rem;
}

.tab {
  display: inline-flex;
  height: 2.5rem;
  flex-shrink: 0;
  cursor: pointer;
  align-items: center;
  gap: 0.45rem;
  border: 0;
  border-radius: 999px;
  background: none;
  padding: 0 1rem;
  color: var(--alt-ink-2);
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 500;
  white-space: nowrap;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.tab:hover {
  background: var(--alt-wash);
  color: var(--alt-ink);
}

.tab.is-on {
  background: var(--alt-ink);
  color: #fff;
}

.stage {
  padding: clamp(0.5rem, 1.2vw, 1rem);
}

.stage-box {
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: var(--alt-radius-s);
}

.caption {
  max-width: 46rem;
  margin: 1.25rem 0 0;
  color: var(--alt-ink-2);
}

.notes {
  display: grid;
  gap: 2rem;
  margin: clamp(2.5rem, 5vw, 4rem) 0 0;
  border-top: 1px solid var(--alt-line);
  padding: 2rem 0 0;
  list-style: none;
}

@media (min-width: 768px) {
  .notes {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 2.5rem;
  }
}

.note-body {
  margin: 0.5rem 0 0;
  font-size: 1rem;
  line-height: 1.55;
}
</style>
