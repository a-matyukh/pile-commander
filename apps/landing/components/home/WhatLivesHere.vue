<script setup lang="ts">
const formats = {
  notes: [".txt", ".md"],
  images: [".png", ".jpg", ".gif", ".webp", ".avif", ".bmp"],
  video: [".mp4", ".webm", ".mov", ".mkv", ".ogv"],
  audio: [".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac"],
  models: [".glb", ".gltf"],
  shapes: [".svg"],
};

// Fixed heights so the waveform renders the same on server and client.
const bars = [30, 55, 40, 75, 90, 60, 35, 70, 95, 65, 45, 80, 50, 30, 60, 85, 55, 40, 70, 45, 25, 50];

// One clip per card. All point at the shared demo until each feature has its own.
// Served from apps/landing/public/. Bound as a string so Vite does not import the file.
const videos = {
  notes: "/clips/notes.mp4",
  models: "/clips/3d.mp4",
  images: "/clips/images.mp4",
  video: "/clips/video.mp4",
  audio: "/clips/audio.mp4",
  shapes: "/clips/shapes.mp4",
  folders: "/clips/folder_preview.mp4",
  combine: "/clips/combine.mp4",
  other: "/clips/open_file.mp4",
};

const demoOpen = ref(false);
const demoTitle = ref("Demo");
const demoSrc = ref(videos.notes);
const demoVideo = useTemplateRef<HTMLVideoElement>("demoVideo");

function openDemo(src: string, title: string) {
  demoTitle.value = title;
  demoSrc.value = src;
  demoOpen.value = true;
}

function playDemo() {
  demoVideo.value?.play().catch(() => {});
}

function stopDemo() {
  const video = demoVideo.value;
  if (!video) return;
  video.pause();
  video.currentTime = 0;
}
</script>

<template>
  <FeatureSection
    eyebrow="What lives on it"
    title="Notes, media, models, shapes — and other folders."
    lede="Drop things in and they show up as themselves, not as a row of filenames."
    muted
  >
    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <!-- Notes -->
      <article class="home-tile lg:col-span-2">
        <div class="home-visual flex items-center justify-center gap-2 bg-[#fffbeb] px-3 sm:gap-4" aria-hidden="true">
          <div class="w-[45%] max-w-44 min-w-0 -rotate-2 rounded-lg border border-amber-200/80 bg-[#fff7d6] p-3 shadow-sm">
            <p class="font-mono text-[11px] leading-relaxed text-amber-950/70">
              # Mood<br>- warm light<br>- a **quiet** room
            </p>
          </div>
          <UIcon name="i-lucide-arrow-right" class="size-4 shrink-0 text-amber-500" />
          <div class="w-[45%] max-w-44 min-w-0 rotate-1 rounded-lg border border-[var(--pc-gray-border)] bg-white p-3 shadow-sm">
            <p class="text-sm font-semibold text-slate-900">Mood</p>
            <p class="mt-1 text-[11px] leading-relaxed text-slate-600">• warm light<br>• a <b>quiet</b> room</p>
          </div>
        </div>
        <h3 class="home-title">Notes that are files</h3>
        <p class="home-body">
          Double-click the board to write. Markdown renders in place;
          <kbd class="home-kbd">⌘B</kbd> and <kbd class="home-kbd">⌘I</kbd> wrap bold and italic.
        </p>
        <div class="home-foot">
          <p class="home-chips"><span v-for="f in formats.notes" :key="f">{{ f }}</span></p>
          <UButton color="neutral" variant="outline" size="xs" icon="i-lucide-play" class="shrink-0" @click="openDemo(videos.notes, 'Notes that are files')">
            See in action
          </UButton>
        </div>
      </article>

      <!-- 3D -->
      <article class="home-tile lg:col-span-2">
        <div
          class="home-visual flex items-center justify-center bg-[radial-gradient(circle_at_50%_45%,#fff_0%,hsl(205_70%_93%)_100%)]"
          aria-hidden="true"
        >
          <HomeCube class="text-[22px]" />
        </div>
        <h3 class="home-title">3D models</h3>
        <p class="home-body">Orbit around a model right on the board. The angle you leave it at is the angle it keeps.</p>
        <div class="home-foot">
          <p class="home-chips"><span v-for="f in formats.models" :key="f">{{ f }}</span></p>
          <UButton color="neutral" variant="outline" size="xs" icon="i-lucide-play" class="shrink-0" @click="openDemo(videos.models, '3D models')">
            See in action
          </UButton>
        </div>
      </article>

      <!-- Images -->
      <article class="home-tile">
        <div class="home-visual relative overflow-hidden bg-[linear-gradient(180deg,#bae6fd_0%,#7dd3fc_45%,#2182f8_100%)]" aria-hidden="true">
          <span class="absolute top-[20%] right-[22%] size-8 rounded-full bg-amber-200/90" />
          <svg class="absolute inset-x-0 bottom-0 h-1/2 w-full" viewBox="0 0 100 40" preserveAspectRatio="none">
            <path d="M0 22 Q 20 14 40 22 T 80 20 T 100 18 V40 H0 Z" fill="#1553aa" opacity=".55" />
            <path d="M0 30 Q 25 24 50 30 T 100 28 V40 H0 Z" fill="#0c2b5c" opacity=".7" />
          </svg>
        </div>
        <h3 class="home-title">Images</h3>
        <p class="home-body">The picture, not its filename.</p>
        <div class="home-foot">
          <p class="home-chips"><span v-for="f in formats.images" :key="f">{{ f }}</span></p>
          <UButton color="neutral" variant="outline" size="xs" icon="i-lucide-play" class="shrink-0" @click="openDemo(videos.images, 'Images')">
            See in action
          </UButton>
        </div>
      </article>

      <!-- Video -->
      <article class="home-tile">
        <div class="home-visual relative flex items-center justify-center bg-slate-900" aria-hidden="true">
          <div class="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,#f59e0b40,transparent_60%)]" />
          <span class="relative flex size-11 items-center justify-center rounded-full bg-white/90">
            <UIcon name="i-lucide-play" class="ml-0.5 size-5 text-slate-900" />
          </span>
          <span class="absolute right-4 bottom-3 left-4 h-1 rounded-full bg-white/20">
            <span class="home-progress block h-full rounded-full bg-white/80" />
          </span>
        </div>
        <h3 class="home-title">Video</h3>
        <p class="home-body">Plays in place with the native player.</p>
        <div class="home-foot">
          <p class="home-chips"><span v-for="f in formats.video" :key="f">{{ f }}</span></p>
          <UButton color="neutral" variant="outline" size="xs" icon="i-lucide-play" class="shrink-0" @click="openDemo(videos.video, 'Video')">
            See in action
          </UButton>
        </div>
      </article>

      <!-- Audio -->
      <article class="home-tile">
        <div class="home-visual flex items-center justify-center gap-[3px] bg-violet-50 px-5" aria-hidden="true">
          <span
            v-for="(h, i) in bars"
            :key="i"
            class="home-bar w-1 rounded-full bg-violet-400"
            :style="{ height: `${h * 0.55}%`, animationDelay: `${i * 70}ms` }"
          />
        </div>
        <h3 class="home-title">Audio</h3>
        <p class="home-body">Voice memos and tracks next to the notes about them.</p>
        <div class="home-foot">
          <p class="home-chips"><span v-for="f in formats.audio" :key="f">{{ f }}</span></p>
          <UButton color="neutral" variant="outline" size="xs" icon="i-lucide-play" class="shrink-0" @click="openDemo(videos.audio, 'Audio')">
            See in action
          </UButton>
        </div>
      </article>

      <!-- Shapes -->
      <article class="home-tile">
        <div class="home-visual flex items-center justify-center bg-indigo-50" aria-hidden="true">
          <svg viewBox="0 0 150 40" class="h-12 w-auto text-indigo-500" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="6" width="26" height="26" rx="2" fill="#e0e7ff" />
            <circle cx="47" cy="19" r="13" fill="#e0e7ff" />
            <path d="M66 32 L79 6 L92 32 Z" fill="#e0e7ff" stroke-linejoin="round" />
            <path d="M110 5 L123 19 L110 33 L97 19 Z" fill="#e0e7ff" stroke-linejoin="round" />
            <path d="M128 30 L146 8 M146 8 L138 9 M146 8 L145 16" stroke-linecap="round" />
          </svg>
        </div>
        <h3 class="home-title">Shapes and arrows</h3>
        <p class="home-body">
          Saved as real .svg files. Press <kbd class="home-kbd">L</kbd> or <kbd class="home-kbd">A</kbd> and drag to draw a line or arrow.
        </p>
        <div class="home-foot">
          <p class="home-chips"><span v-for="f in formats.shapes" :key="f">{{ f }}</span></p>
          <UButton color="neutral" variant="outline" size="xs" icon="i-lucide-play" class="shrink-0" @click="openDemo(videos.shapes, 'Shapes and arrows')">
            See in action
          </UButton>
        </div>
      </article>

      <!-- Folder preview -->
      <article class="home-tile lg:col-span-2">
        <div class="home-visual flex items-center justify-center bg-pc-50/60 px-6" aria-hidden="true">
          <div class="w-full max-w-sm rounded-xl border border-[var(--pc-gray-border)] bg-white p-3 shadow-sm">
            <div class="flex items-center gap-2 text-xs font-medium text-slate-700">
              <UIcon name="i-lucide-folder" class="size-4 text-pc-500" />
              References
              <span class="ml-auto text-[10px] font-normal text-slate-400">Masonry</span>
            </div>
            <div class="mt-2 grid grid-cols-4 grid-rows-2 gap-1.5">
              <span class="col-span-2 row-span-2 h-16 rounded-md bg-rose-100" />
              <span class="h-7 rounded-md bg-sky-100" />
              <span class="h-7 rounded-md bg-amber-100" />
              <span class="col-span-2 h-7 rounded-md bg-emerald-100" />
            </div>
          </div>
        </div>
        <h3 class="home-title">Folders inside folders — live</h3>
        <p class="home-body">
          Turn on Preview and a sub-folder shows its contents, in its own view, right inside the parent.
        </p>
        <div class="home-foot">
          <UButton color="neutral" variant="outline" size="xs" icon="i-lucide-play" class="shrink-0" @click="openDemo(videos.folders, 'Folders inside folders — live')">
            See in action
          </UButton>
        </div>
      </article>

      <!-- Combine -->
      <article class="home-tile">
        <div class="home-visual relative flex items-center justify-center bg-[var(--pc-gray-header)]" aria-hidden="true">
          <div class="home-combine relative size-20">
            <span class="home-card absolute size-12 rounded-lg border border-amber-200 bg-[#fff7d6] shadow-sm" style="--dx: -26px; --dy: -8px; --r: -8deg" />
            <span class="home-card absolute size-12 rounded-lg border border-sky-200 bg-sky-100 shadow-sm" style="--dx: 22px; --dy: -12px; --r: 6deg" />
            <span class="home-card absolute size-12 rounded-lg border border-violet-200 bg-violet-100 shadow-sm" style="--dx: 0px; --dy: 14px; --r: 2deg" />
          </div>
        </div>
        <h3 class="home-title">Combine into a pile</h3>
        <p class="home-body">Select a few things and Combine selected — they become one folder. Uncombine puts them back.</p>
        <div class="home-foot">
          <UButton color="neutral" variant="outline" size="xs" icon="i-lucide-play" class="shrink-0" @click="openDemo(videos.combine, 'Combine into a pile')">
            See in action
          </UButton>
        </div>
      </article>

      <!-- Anything else -->
      <article class="home-tile">
        <div class="home-visual flex items-center justify-center gap-2 bg-white" aria-hidden="true">
          <span
            v-for="ext in ['pdf', 'zip', 'psd']"
            :key="ext"
            class="relative flex h-16 w-12 items-end justify-center rounded-md bg-white pb-1.5 text-[10px] font-semibold tracking-wide text-slate-400 uppercase shadow-sm ring-1 ring-[var(--pc-gray-border)]"
          >
            <span class="absolute top-0 right-0 size-3 rounded-bl-md bg-[var(--pc-gray-header)]" />
            {{ ext }}
          </span>
        </div>
        <h3 class="home-title">Everything else</h3>
        <p class="home-body">Any other file sits on the board as a tile and opens in its usual app.</p>
        <div class="home-foot">
          <UButton color="neutral" variant="outline" size="xs" icon="i-lucide-play" class="shrink-0" @click="openDemo(videos.other, 'Everything else')">
            See in action
          </UButton>
        </div>
      </article>
    </div>

    <UModal
      v-model:open="demoOpen"
      :title="demoTitle"
      :ui="{ content: 'max-w-3xl' }"
      @after:enter="playDemo"
      @after:leave="stopDemo"
    >
      <template #body>
        <video
          ref="demoVideo"
          :key="demoSrc"
          class="aspect-video w-full rounded-lg bg-black"
          controls
          playsinline
          preload="metadata"
          :src="demoSrc"
        />
      </template>
    </UModal>
  </FeatureSection>
</template>

<style scoped>
@reference "../../assets/css/main.css";

.home-tile {
  @apply flex flex-col rounded-2xl border border-[var(--pc-gray-border)] bg-white p-3 pb-5;
}

.home-visual {
  @apply h-36 rounded-xl;
}

.home-title {
  @apply mt-4 px-2 text-base font-semibold text-slate-900;
}

.home-body {
  @apply mt-1.5 px-2 text-sm leading-relaxed text-slate-600;
}

.home-foot {
  @apply mt-auto flex flex-wrap items-center justify-end gap-2 px-2 pt-3;
}

.home-chips {
  @apply mr-auto flex flex-wrap gap-1;
}

.home-chips span {
  @apply rounded-md bg-[var(--pc-gray-header)] px-1.5 py-0.5 font-mono text-[11px] text-slate-500;
}

.home-kbd {
  @apply rounded border border-[var(--pc-gray-border)] bg-[var(--pc-gray-header)] px-1 py-px font-sans text-xs text-slate-700;
}

.home-card {
  top: 16px;
  left: 16px;
  transform: translate(var(--dx), var(--dy)) rotate(var(--r));
}

@media (prefers-reduced-motion: no-preference) {
  .home-card {
    animation: home-combine 4s ease-in-out infinite;
  }

  .home-bar {
    animation: home-bar 1.2s ease-in-out infinite alternate;
    transform-origin: center;
  }

  .home-progress {
    animation: home-progress 6s linear infinite;
  }
}

.home-progress {
  width: 38%;
}

@keyframes home-combine {
  0%, 20% {
    transform: translate(var(--dx), var(--dy)) rotate(var(--r));
  }
  45%, 70% {
    transform: translate(0, 0) rotate(calc(var(--r) / 3));
  }
  95%, 100% {
    transform: translate(var(--dx), var(--dy)) rotate(var(--r));
  }
}

@keyframes home-bar {
  from {
    transform: scaleY(0.45);
  }
  to {
    transform: scaleY(1);
  }
}

@keyframes home-progress {
  from {
    width: 0%;
  }
  to {
    width: 100%;
  }
}
</style>
