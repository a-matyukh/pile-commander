<script setup lang="ts">
const notes = [
  {
    icon: "i-lucide-arrow-left-right",
    title: "Both ways, on their own",
    body: "Edits, new files, renames and deletes made on either side reach the other within seconds.",
  },
  {
    icon: "i-lucide-spline",
    title: "Still a board on both sides",
    body: "Cards, ink and connections stay where you put them — on your disk and in the cloud.",
  },
  {
    icon: "i-lucide-copy",
    title: "Nothing is lost",
    body: "Changed on both sides? The cloud version keeps the name, and yours sits beside it as a copy.",
  },
];
</script>

<template>
  <FeatureSection
    eyebrow="Folder sync"
    badge="New"
    title="Local folders that stay in sync."
    lede="Turn on Auto-sync for a workspace folder, or sync a cloud workspace to a folder on your computer, and work in it right on your disk — the way desktop cloud drives do. Changes travel both ways while the desktop app is open, and on either side the folder is still a board or a canvas, not just a list of files."
    muted
  >
    <div class="rounded-2xl border border-[var(--pc-gray-border)] bg-white p-3 sm:p-4">
      <div class="aspect-[16/9] overflow-hidden rounded-xl">
        <VisionSync />
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
