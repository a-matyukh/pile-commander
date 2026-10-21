<script setup lang="ts">
const notes = [
  {
    icon: "i-lucide-plug",
    title: "Your own model",
    body: "OpenAI, OpenRouter or any OpenAI-compatible address. In the desktop app also Ollama or LM Studio on your computer, and the key stays in the system's password storage.",
  },
  {
    icon: "i-lucide-list-checks",
    title: "Nothing changes without Accept",
    body: "Names come as a list of old and new, each with a checkbox. A summary comes as a preview. What you accept is ordinary renames and a note.",
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
    title="AI that tidies the pile you already have."
    lede="Select files on the board and ask a model to name them: it reads notes, looks at images and lists what a folder holds. Summarize turns a board into a short note next to it. Generating ideas and sorting into folders are coming next."
    muted
  >
    <div class="rounded-2xl border border-[var(--pc-gray-border)] bg-white p-3 sm:p-4">
      <div class="aspect-[16/9] overflow-hidden rounded-xl">
        <HomeAiNamingScene />
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
