<script setup lang="ts">
const notes = [
  {
    icon: "i-lucide-move-3d",
    title: "Same places, plus height",
    body: "Cards stand where they stand on the board and the canvas. Hold ⌥ (Alt) and drag to raise one; one undo puts it back.",
  },
  {
    icon: "i-lucide-box",
    title: "Models are objects",
    body: ".glb and .gltf files stand on the table in their real shape. Fly up close and walk around them.",
  },
  {
    icon: "i-lucide-infinity",
    title: "A table or an endless floor",
    body: "Each folder keeps its own floor. A folder of hundreds of files opens at its first rows, as the board does.",
  },
];
</script>

<template>
  <FeatureSection
    eyebrow="3D view"
    badge="New"
    title="Your board, in space."
    lede="Switch any folder to 3D and its board becomes a table you can walk around. Cards keep their places — move one here and it moves on the board too — and can float at a height of their own. 3D models stand on the table as real objects."
  >
    <div class="rounded-2xl border border-[var(--pc-gray-border)] bg-[var(--pc-gray-surface)] p-3 sm:p-4">
      <div class="aspect-[16/9] overflow-hidden rounded-xl">
        <HomeSpaceScene />
      </div>
    </div>

    <ul class="mt-6 grid list-none gap-4 p-0 md:grid-cols-3">
      <li
        v-for="note in notes"
        :key="note.title"
        class="flex gap-3 rounded-2xl border border-[var(--pc-gray-border)] bg-[var(--pc-gray-surface)] p-5"
      >
        <span class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-[var(--pc-gray-border)]">
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
