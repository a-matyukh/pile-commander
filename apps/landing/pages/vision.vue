<script setup lang="ts">
useSeoMeta({
  title: "Vision",
  description:
    "Long-term directions for Pile Commander: a 3D view of a folder, AI tools, local folders that stay in sync, and a desktop environment for Linux.",
  ogTitle: "Vision — Pile Commander",
  ogDescription:
    "Where the pile is going: a 3D view, AI tools, synced local folders, and a Linux desktop.",
  ogImage: "/app-icon.png",
  twitterCard: "summary",
});

const directions = [
  {
    scene: "space",
    title: "A 3D view of a folder",
    body: "Look through a folder in space. The same files — another view.",
  },
  {
    scene: "ai",
    title: "AI tools",
    body: "Ask a folder for ideas and get them back as cards on the board. Sorting, naming and summaries come next — help that works on the pile you already have.",
  },
  {
    scene: "sync",
    title: "Local folders that stay in sync",
    body: "Turn on sync for a workspace folder and work in it right on your computer — the way desktop cloud drives do. Changes travel both ways on their own, and on either side the folder is still a board or a canvas, not just a list of files.",
  },
  {
    scene: "desktop",
    title: "A desktop for Linux",
    body: "A desktop environment for Linux, in the spirit of COSMIC and Omarchy: the desktop itself is a board, workspaces are your piles, and folders open as tiled windows right next to the terminal.",
  },
];
</script>

<template>
  <div>
    <section class="px-5 pb-10 pt-10">
      <div class="mx-auto max-w-3xl text-center">
        <p class="mx-auto mt-5 max-w-xl text-base leading-relaxed text-slate-600 md:text-lg">
			Highlights and milestones of roadmap
        </p>
      </div>
    </section>

    <section class="px-5 pb-10">
      <ul class="mx-auto flex max-w-5xl list-none flex-col gap-5 p-0">
        <li
          v-for="item in directions"
          :key="item.title"
          class="rounded-2xl border border-[var(--pc-gray-border)] bg-white p-3 sm:p-4"
        >
          <div class="aspect-[16/9] overflow-hidden rounded-xl">
            <VisionSpace v-if="item.scene === 'space'" />
            <VisionAi v-else-if="item.scene === 'ai'" />
            <VisionSync v-else-if="item.scene === 'sync'" />
            <VisionDesktop v-else />
          </div>
          <h2 class="mt-4 px-2 text-lg font-semibold text-slate-900 sm:px-3">{{ item.title }}</h2>
          <p class="mt-2 px-2 pb-2 text-sm leading-relaxed text-slate-600 sm:px-3">{{ item.body }}</p>
        </li>
      </ul>
    </section>

    <section class="px-5 pb-20">
      <p class="mx-auto max-w-5xl text-center text-sm leading-relaxed text-slate-500">
        No date is specified here. 
		When a particular milestone becomes available, 
		information about it will appear on the homepage and be mentioned in the newsletter.
      </p>
    </section>
  </div>
</template>
