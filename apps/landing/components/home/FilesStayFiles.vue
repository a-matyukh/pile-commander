<script setup lang="ts">
const files = [
  { name: "References", kind: "Folder", icon: "i-lucide-folder", tint: "text-pc-500" },
  { name: "Harbor morning.svg", kind: "SVG image", icon: "i-lucide-image", tint: "text-emerald-600" },
  { name: "Mood.md", kind: "Markdown", icon: "i-lucide-file-type", tint: "text-slate-500" },
  { name: "Welcome.txt", kind: "Plain text", icon: "i-lucide-file-text", tint: "text-amber-600" },
  { name: "chair.glb", kind: "3D model", icon: "i-lucide-box", tint: "text-sky-600" },
  { name: "clip.mp4", kind: "MPEG-4 movie", icon: "i-lucide-film", tint: "text-orange-600" },
];

const facts = [
  {
    icon: "i-lucide-file",
    title: "Ordinary files",
    body: "A note is a .txt or .md. A shape is an .svg. Any other app can still open them.",
  },
  {
    icon: "i-lucide-tag",
    title: "Layout rides along",
    body: "Position, size, view and background are kept in the files' extended attributes. Nothing to import or export.",
  },
  {
    icon: "i-lucide-folder-dot",
    title: "Ink in .pile/",
    body: "Drawings and connectors sit in a small .pile folder next to your files.",
  },
  {
    icon: "i-lucide-eye",
    title: "Watches the disk",
    body: "Rename or add something in Finder or Explorer — it shows up on the board.",
  },
];

// Served from apps/landing/public/. Bound as a string so Vite does not import the file.
const compareSrc = "/side-by-side.mp4";
const comparePoster = "/side-by-side-poster.jpg";
const compareOpen = ref(false);
const compareVideo = useTemplateRef<HTMLVideoElement>("compareVideo");

function playCompare() {
  compareVideo.value?.play().catch(() => {});
}

function stopCompare() {
  const video = compareVideo.value;
  if (!video) return;
  video.pause();
  video.currentTime = 0;
}
</script>

<template>
  <FeatureSection
    eyebrow="Files stay files"
    title="Your board is a folder. Your folder is a board."
    lede="In the desktop app you open a real folder on your disk. There is no library to import into and no database to get locked into."
  >
    <div class="grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1fr]">
      <!-- The folder, as the OS sees it -->
      <div
        class="overflow-hidden rounded-2xl border border-[var(--pc-gray-border)] bg-white shadow-sm"
        aria-hidden="true"
      >
        <div class="flex items-center gap-2 border-b border-[var(--pc-gray-border)] bg-[var(--pc-gray-header)] px-3 py-2.5">
          <span class="size-2 rounded-full bg-slate-300" />
          <span class="size-2 rounded-full bg-slate-300" />
          <span class="size-2 rounded-full bg-slate-300" />
          <span class="ml-2 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <UIcon name="i-lucide-hard-drive" class="size-3.5" />
            ~/Projects/Research
          </span>
        </div>
        <div class="px-3 py-2 text-[13px]">
          <div class="flex border-b border-[var(--pc-gray-border)] px-2 pb-1.5 text-xs text-slate-400">
            <span>Name</span>
            <span class="ml-auto">Kind</span>
          </div>
          <div
            v-for="file in files"
            :key="file.name"
            class="flex items-center gap-2.5 rounded-md px-2 py-1.5 odd:bg-[var(--pc-gray-surface)]"
          >
            <UIcon :name="file.icon" class="size-4 shrink-0" :class="file.tint" />
            <span class="truncate text-slate-800">{{ file.name }}</span>
            <span class="ml-auto shrink-0 text-xs text-slate-400">{{ file.kind }}</span>
          </div>
          <div class="flex items-center gap-2.5 px-2 py-1.5 text-slate-400">
            <UIcon name="i-lucide-folder" class="size-4 shrink-0 opacity-60" />
            <span class="font-mono text-xs">.pile/</span>
            <span class="font-mono text-[11px]">strokes.json · connections.json</span>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-center text-pc-500" aria-hidden="true">
        <span class="flex size-10 items-center justify-center rounded-full border border-pc-200 bg-pc-50">
          <UIcon name="i-lucide-arrow-left-right" class="size-4 max-lg:rotate-90" />
        </span>
      </div>

      <!-- The same folder, as a board -->
      <div
        class="relative min-h-72 overflow-hidden rounded-2xl border border-[var(--pc-gray-border)] bg-[linear-gradient(160deg,hsl(215_40%_97%)_0%,hsl(210_36%_94%)_100%)] shadow-sm"
        aria-hidden="true"
      >
        <div class="absolute top-[8%] left-[6%] w-[36%] -rotate-2 rounded-lg border border-amber-200/80 bg-[#fff7d6] p-3 shadow-sm">
          <p class="text-[11px] leading-snug text-amber-950/80">Welcome to the demo workspace.</p>
        </div>
        <div class="absolute top-[7%] right-[6%] w-[42%] overflow-hidden rounded-xl border border-[var(--pc-gray-border)] bg-white shadow-sm">
          <div class="h-16 bg-[linear-gradient(180deg,#bae6fd_0%,#7dd3fc_45%,#2182f8_100%)]" />
          <p class="px-2.5 py-1.5 text-[11px] font-medium text-slate-700">Harbor morning</p>
        </div>
        <div class="absolute bottom-[10%] left-[8%] w-[34%] rounded-xl border border-[var(--pc-gray-border)] bg-white p-2.5 shadow-sm">
          <p class="text-xs font-semibold text-slate-900">Mood</p>
          <p class="mt-1 text-[11px] text-slate-500">• warm light<br>• a quiet room</p>
        </div>
        <div class="absolute right-[10%] bottom-[12%] flex w-[26%] flex-col items-center rounded-xl border border-[var(--pc-gray-border)] bg-white p-2.5 shadow-sm">
          <HomeCube class="text-[11px]" />
          <p class="mt-1 text-[11px] text-slate-500">chair.glb</p>
        </div>
        <div class="absolute top-[46%] left-[44%] rounded-lg bg-white px-2 py-1 text-[11px] text-slate-600 shadow-sm ring-1 ring-[var(--pc-gray-border)]">
          <UIcon name="i-lucide-folder" class="mr-1 size-3 align-[-2px] text-pc-500" />References
        </div>
      </div>
    </div>

    <ul class="mt-10 grid list-none gap-6 p-0 sm:grid-cols-2 lg:grid-cols-4">
      <li v-for="fact in facts" :key="fact.title">
        <UIcon :name="fact.icon" class="size-5 text-pc-500" />
        <h3 class="mt-3 text-base font-semibold text-slate-900">{{ fact.title }}</h3>
        <p class="mt-1.5 text-sm leading-relaxed text-slate-600">{{ fact.body }}</p>
      </li>
    </ul>

    <div class="mt-10 flex flex-col gap-4 rounded-2xl border border-[var(--pc-gray-border)] bg-white p-3 sm:flex-row sm:items-center sm:gap-6">
      <button
        type="button"
        class="group relative shrink-0 cursor-pointer overflow-hidden rounded-xl ring-1 ring-[var(--pc-gray-border)] sm:w-64"
        aria-label="Watch the comparison"
        @click="compareOpen = true"
      >
        <img
          :src="comparePoster"
          alt=""
          width="960"
          height="623"
          loading="lazy"
          class="aspect-[960/623] w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        >
        <span class="absolute inset-0 flex items-center justify-center bg-slate-900/10 transition-colors group-hover:bg-slate-900/20">
          <span class="flex size-11 items-center justify-center rounded-full bg-white/95 text-pc-500 shadow-md">
            <UIcon name="i-lucide-play" class="ml-0.5 size-5" />
          </span>
        </span>
      </button>
      <div class="px-1 pb-1 sm:p-0">
        <h3 class="text-base font-semibold text-slate-900">A classic file manager vs Pile Commander</h3>
        <p class="mt-1.5 text-sm leading-relaxed text-slate-600">
          The same folder, side by side: a classic file manager on the left, Pile Commander on the right.
        </p>
        <UButton color="neutral" variant="outline" size="xs" icon="i-lucide-play" class="mt-3" @click="compareOpen = true">
          Watch the comparison
        </UButton>
      </div>
    </div>

    <p class="mt-4 inline-flex items-start gap-2 rounded-lg bg-[var(--pc-gray-header)] px-3 py-2 text-sm text-slate-600">
      <UIcon name="i-lucide-monitor-down" class="mt-0.5 size-4 shrink-0 text-pc-500" />
      Opening folders from your disk needs the desktop app. In the browser you get a demo and browser desktops.
    </p>

    <UModal
      v-model:open="compareOpen"
      title="Classic file manager vs Pile Commander"
      :ui="{ content: 'max-w-3xl' }"
      @after:enter="playCompare"
      @after:leave="stopCompare"
    >
      <template #body>
        <video
          ref="compareVideo"
          class="aspect-video w-full rounded-lg bg-black"
          controls
          playsinline
          preload="metadata"
          :poster="comparePoster"
          :src="compareSrc"
        />
      </template>
    </UModal>
  </FeatureSection>
</template>
