<!-- ② The four AI actions, each played by the home page's own scene, which
     this page uses as it is. The labels are the app's action names
     (AiItems.vue) and the captions repeat components/home/AiTools.vue.
     The scenes play while they are on screen and motion is welcome; with
     reduced motion each shows its finished frame. -->
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

const active = ref<SceneId>("names");
const activeScene = computed(() => scenes.find((scene) => scene.id === active.value) ?? scenes[0]!);

/** The tabs play one after another until the visitor picks one */
const autoplay = ref(true);
const tabs = useTemplateRef<HTMLButtonElement[]>("tabs");

function pick(id: SceneId) {
  autoplay.value = false;
  active.value = id;
}

function next() {
  if (!autoplay.value) return;
  const index = scenes.findIndex((scene) => scene.id === active.value);
  active.value = scenes[(index + 1) % scenes.length]!.id;
}

/** Arrow keys move between tabs, as a tab list should */
function onKey(event: KeyboardEvent) {
  const index = scenes.findIndex((scene) => scene.id === active.value);
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
  <div>
    <div class="tabs-scroll">
      <div role="tablist" aria-label="AI actions" class="tabs" @keydown="onKey">
        <button
          v-for="scene in scenes"
          :id="`a2-ai-tab-${scene.id}`"
          :key="scene.id"
          ref="tabs"
          type="button"
          role="tab"
          :aria-selected="active === scene.id"
          :tabindex="active === scene.id ? 0 : -1"
          aria-controls="a2-ai-stage"
          class="tab"
          :class="{ 'is-on': active === scene.id }"
          @click="pick(scene.id)"
        >
          <UIcon :name="scene.icon" class="size-4" />
          {{ scene.label }}
        </button>
      </div>
    </div>

    <p class="caption" aria-live="polite">{{ activeScene.caption }}</p>

    <div id="a2-ai-stage" role="tabpanel" :aria-labelledby="`a2-ai-tab-${active}`" class="a2-frame stage">
      <div class="stage-box">
        <HomeAiNamingScene v-if="active === 'names'" key="names" mode="names" @done="next" />
        <HomeAiNamingScene v-else-if="active === 'summary'" key="summary" mode="summary" @done="next" />
        <HomeAiIdeasScene v-else-if="active === 'ideas'" @done="next" />
        <HomeAiSortScene v-else @done="next" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* On a phone the row of tabs scrolls sideways, out to the screen's edges */
.tabs-scroll {
  margin: 0 calc(-1 * var(--a2-gutter));
  overflow-x: auto;
  padding: 0 var(--a2-gutter) 0.25rem;
  scrollbar-width: none;
}

.tabs {
  display: inline-flex;
  gap: 0.25rem;
  border: 1px solid var(--a2-line);
  border-radius: 999px;
  background: var(--a2-surface);
  padding: 0.3rem;
}

.tab {
  display: inline-flex;
  min-height: 2.5rem;
  flex-shrink: 0;
  cursor: pointer;
  align-items: center;
  gap: 0.45rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  padding: 0 1rem;
  color: var(--a2-ink-2);
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 500;
  white-space: nowrap;
}

.tab:hover {
  background: var(--a2-bg);
  color: var(--a2-ink);
}

.tab.is-on {
  background: var(--a2-ink);
  color: #fff;
}

.caption {
  max-width: 46rem;
  margin: 1.25rem 0 1.5rem;
  color: var(--a2-ink-2);
  font-size: 1rem;
}

.stage {
  padding: clamp(0.5rem, 1.2vw, 1rem);
}

.stage-box {
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: var(--a2-radius-s);
}
</style>
