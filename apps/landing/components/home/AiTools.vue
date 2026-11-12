<script setup lang="ts">
type SceneId = "names" | "summary" | "ideas" | "sort";

const scenes: { id: SceneId; label: string; icon: string; caption: string }[] = [
  {
    id: "names",
    label: "Names",
    icon: "i-lucide-tag",
    caption: "Select files and get names from what is inside them: notes are read, images looked at. A list of old and new, each with a checkbox.",
  },
  {
    id: "summary",
    label: "Summary",
    icon: "i-lucide-file-text",
    caption: "Summarize turns a board, or what is selected on it, into a short note right next to it.",
  },
  {
    id: "ideas",
    label: "Ideas",
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
const activeScene = computed(() => scenes.find(scene => scene.id === active.value) ?? scenes[0]!);

/** The tabs play one after another until the person picks one */
const autoplay = ref(true);

function pick(id: SceneId) {
  autoplay.value = false;
  active.value = id;
}

function next() {
  if (!autoplay.value) return;
  const index = scenes.findIndex(scene => scene.id === active.value);
  active.value = scenes[(index + 1) % scenes.length]!.id;
}

const notes = [
  {
    icon: "i-lucide-plug",
    title: "Your own model",
    body: "OpenAI, OpenRouter or any OpenAI-compatible address. In the desktop app also Ollama or LM Studio on your computer, and the key stays in the system's password storage.",
  },
  {
    icon: "i-lucide-list-checks",
    title: "Nothing changes without Accept",
    body: "Names come as a list of old and new, ideas as cards on the board, folders as a plan with checkboxes. What you accept is ordinary files, and one undo takes it back.",
  },
  {
    icon: "i-lucide-shield-check",
    title: "Asks before the cloud",
    body: "A model on your computer sends nothing out. A cloud provider asks once before names and notes go, and again before images.",
  },
];
</script>

<template>
  <FeatureSection
    eyebrow="AI tools"
    badge="New"
    title="AI that tidies the pile you already have."
    lede="Four things a model does with a folder: names files by what is in them, sums up a board in a note, brings ideas as cards on the board, and sorts a pile into folders. You see every change before it happens."
    muted
  >
    <div class="-mx-5 overflow-x-auto px-5 pb-4 sm:mx-0 sm:px-0">
      <div
        role="tablist"
        aria-label="AI tools"
        class="inline-flex gap-1 rounded-xl border border-[var(--pc-gray-border)] bg-white p-1 shadow-sm"
      >
        <button
          v-for="scene in scenes"
          :id="`home-ai-tab-${scene.id}`"
          :key="scene.id"
          type="button"
          role="tab"
          :aria-selected="active === scene.id"
          aria-controls="home-ai-stage"
          class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors"
          :class="
            active === scene.id
              ? 'bg-pc-500 font-semibold text-white'
              : 'text-slate-600 hover:bg-[var(--pc-gray-header)] hover:text-slate-900'
          "
          @click="pick(scene.id)"
        >
          <UIcon :name="scene.icon" class="size-4" />
          {{ scene.label }}
        </button>
      </div>
    </div>

    <p class="text-xs leading-relaxed text-slate-600 sm:text-sm" aria-live="polite">
      <span class="font-semibold text-slate-900">{{ activeScene.label }}</span>
      — {{ activeScene.caption }}
    </p>

    <div
      id="home-ai-stage"
      role="tabpanel"
      :aria-labelledby="`home-ai-tab-${active}`"
      class="mt-5 rounded-2xl border border-[var(--pc-gray-border)] bg-white p-3 sm:p-4"
    >
      <div class="aspect-[16/9] overflow-hidden rounded-xl">
        <HomeAiNamingScene v-if="active === 'names'" key="names" mode="names" @done="next" />
        <HomeAiNamingScene v-else-if="active === 'summary'" key="summary" mode="summary" @done="next" />
        <HomeAiIdeasScene v-else-if="active === 'ideas'" @done="next" />
        <HomeAiSortScene v-else @done="next" />
      </div>
    </div>

    <ul class="mt-6 grid list-none gap-4 p-0 md:grid-cols-3">
      <li
        v-for="note in notes"
        :key="note.title"
        class="flex gap-3 rounded-2xl border border-[var(--pc-gray-border)] bg-white p-5"
      >
        <span class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-pc-50">
          <UIcon :name="note.icon" class="size-4.5 text-pc-600" />
        </span>
        <div>
          <h3 class="text-sm font-semibold text-slate-900">{{ note.title }}</h3>
          <p class="mt-1 text-sm leading-relaxed text-slate-600">{{ note.body }}</p>
        </div>
      </li>
    </ul>
  </FeatureSection>
</template>
