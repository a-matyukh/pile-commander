<script setup lang="ts">
const desktops = [
  { label: "Studio", icon: "i-lucide-hard-drive", active: true },
  { label: "Archive", icon: "i-lucide-hard-drive" },
  { label: "Team", icon: "i-lucide-cloud" },
];

const shortcuts = [
  { keys: ["⌘", "N"], label: "New window" },
  { keys: ["⌘", "B"], label: "Toggle sidebar" },
  { keys: ["⌘", "←"], label: "Back" },
  { keys: ["⌘", "D"], label: "Duplicate" },
  { keys: ["⌘", "C", "⌘", "V"], label: "Copy between windows" },
  { keys: ["Double-click"], label: "New note" },
  { keys: ["⇧", "Double-click"], label: "New folder" },
  { keys: ["⇧", "Arrows"], label: "Nudge by a grid step" },
];
</script>

<template>
  <FeatureSection
    eyebrow="Desks and windows"
    title="Desks, windows, a taskbar — in one app."
    badge="Experimental feature"
    lede="Keep several desktops side by side — on your disk in the desktop app, in the browser on the web, and in the cloud to follow you between devices. Each desktop is itself a board, with its own background and its own windows."
  >
    <div
      class="overflow-hidden rounded-2xl border border-[var(--pc-gray-border)] bg-white shadow-[0_24px_60px_-28px_rgba(15,23,42,0.28)]"
      aria-hidden="true"
    >
      <!-- Desktop tabs -->
      <div class="flex items-center gap-1 border-b border-[var(--pc-gray-border)] bg-[var(--pc-gray-header)] px-2 py-1.5">
        <span
          v-for="d in desktops"
          :key="d.label"
          class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs"
          :class="d.active ? 'bg-white font-medium text-slate-800 shadow-sm ring-1 ring-[var(--pc-gray-border)]' : 'text-slate-500'"
        >
          <UIcon :name="d.icon" class="size-3.5" />
          {{ d.label }}
        </span>
        <span class="inline-flex size-6 items-center justify-center rounded-md text-slate-400">
          <UIcon name="i-lucide-plus" class="size-3.5" />
        </span>
      </div>

      <!-- Desktop surface -->
      <div class="relative h-[22rem] bg-[linear-gradient(135deg,hsl(215_45%_93%)_0%,hsl(200_45%_90%)_100%)] md:h-[26rem]">
        <!-- desktop icons -->
        <div class="absolute top-4 left-4 flex flex-col gap-4">
          <span
            v-for="name in ['Research', 'Client work', 'Notes']"
            :key="name"
            class="flex w-16 flex-col items-center gap-1 text-center text-[10px] text-slate-700"
          >
            <span class="flex size-10 items-center justify-center rounded-xl bg-white/80 shadow-sm">
              <UIcon name="i-lucide-folder" class="size-5 text-pc-500" />
            </span>
            {{ name }}
          </span>
        </div>

        <!-- window 1 -->
        <div
          class="absolute top-[8%] left-[18%] w-[70%] overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-slate-900/10 sm:w-[56%]"
        >
          <div class="flex items-center gap-1.5 border-b border-[var(--pc-gray-border)] bg-[var(--pc-gray-header)] px-2.5 py-1.5">
            <span class="size-2 rounded-full bg-red-300" />
            <span class="size-2 rounded-full bg-amber-300" />
            <span class="size-2 rounded-full bg-emerald-300" />
            <span class="ml-2 text-[11px] font-medium text-slate-600">Research</span>
          </div>
          <div class="flex h-48 md:h-56">
            <div class="hidden w-28 shrink-0 border-r border-[var(--pc-gray-border)] bg-[var(--pc-gray-surface)] p-2 text-[10px] text-slate-600 sm:block">
              <p class="flex items-center gap-1 font-medium"><UIcon name="i-lucide-chevron-down" class="size-3" />Research</p>
              <p class="mt-1 flex items-center gap-1 pl-3"><UIcon name="i-lucide-folder" class="size-3 text-pc-500" />References</p>
              <p class="mt-1 flex items-center gap-1 pl-3"><UIcon name="i-lucide-folder" class="size-3 text-pc-500" />Stills</p>
              <p class="mt-1 flex items-center gap-1 pl-3 text-slate-400"><UIcon name="i-lucide-file-text" class="size-3" />Welcome.txt</p>
            </div>
            <div class="relative flex-1 bg-[linear-gradient(160deg,hsl(215_40%_98%)_0%,hsl(210_36%_95%)_100%)]">
              <div class="absolute top-3 left-3 w-[42%] -rotate-2 rounded-md border border-amber-200/80 bg-[#fff7d6] p-2 text-[10px] leading-snug text-amber-950/80 shadow-sm">
                Warm light, quiet room.
              </div>
              <div class="absolute top-4 right-3 w-[40%] overflow-hidden rounded-lg border border-[var(--pc-gray-border)] bg-white shadow-sm">
                <div class="h-10 bg-[linear-gradient(180deg,#bae6fd_0%,#7dd3fc_45%,#2182f8_100%)]" />
                <p class="px-1.5 py-1 text-[10px] text-slate-600">Harbor morning</p>
              </div>
              <div class="absolute bottom-3 left-[30%] w-[36%] rounded-lg border border-[var(--pc-gray-border)] bg-white p-2 text-[10px] text-slate-600 shadow-sm">
                <UIcon name="i-lucide-folder" class="mr-1 size-3 align-[-2px] text-pc-500" />References
              </div>
            </div>
          </div>
        </div>

        <!-- window 2 -->
        <div
          class="absolute right-[4%] bottom-[16%] hidden w-[38%] overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-900/10 sm:block"
        >
          <div class="flex items-center gap-1.5 border-b border-[var(--pc-gray-border)] bg-[var(--pc-gray-header)] px-2.5 py-1.5">
            <span class="size-2 rounded-full bg-red-300" />
            <span class="size-2 rounded-full bg-amber-300" />
            <span class="size-2 rounded-full bg-emerald-300" />
            <span class="ml-2 text-[11px] font-medium text-slate-600">Client work</span>
            <span class="ml-auto inline-flex items-center gap-1 text-[10px] text-slate-400">
              <UIcon name="i-lucide-layout-grid" class="size-3" />Grid
            </span>
          </div>
          <div class="grid grid-cols-4 gap-2 p-3">
            <span v-for="n in 8" :key="n" class="flex flex-col items-center gap-1">
              <span class="h-8 w-7 rounded-sm bg-white shadow-sm ring-1 ring-[var(--pc-gray-border)]" :class="n % 3 === 0 ? 'bg-pc-100' : ''" />
              <span class="h-1 w-8 rounded-full bg-slate-200" />
            </span>
          </div>
        </div>

        <!-- taskbar -->
        <div class="absolute inset-x-0 bottom-0 flex items-center gap-1.5 border-t border-white/60 bg-white/75 px-2 py-1.5 backdrop-blur">
          <span class="inline-flex items-center gap-1.5 rounded-md bg-pc-500 px-2.5 py-1 text-[11px] font-semibold text-white">
            <UIcon name="i-lucide-house" class="size-3.5" />
            Start
          </span>
          <span class="rounded-md bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 shadow-sm ring-1 ring-pc-200">Research</span>
          <span class="rounded-md px-2.5 py-1 text-[11px] text-slate-500">Client work</span>
        </div>
      </div>
    </div>

    <div class="mt-10 grid gap-8 lg:grid-cols-[1fr_1.6fr]">
      <div class="space-y-4 text-sm leading-relaxed text-slate-600">
        <p>
          <span class="font-semibold text-slate-900">Start</span> opens every
          workspace you have — Local, Cloud, Bookmarks, and Last opened — plus
          the ones shared with you and the ones you found on the Hub.
        </p>
        <p>
          <span class="font-semibold text-slate-900">On a phone</span> a workspace
          opens full screen and the folder tree slides in as a drawer.
        </p>
      </div>
      <ul class="grid list-none grid-cols-1 gap-x-6 gap-y-2.5 p-0 sm:grid-cols-2">
        <li v-for="s in shortcuts" :key="s.label" class="flex items-center gap-3 text-sm text-slate-600">
          <span class="flex shrink-0 items-center gap-1">
            <kbd
              v-for="(k, i) in s.keys"
              :key="i"
              class="rounded-md border border-[var(--pc-gray-border)] border-b-2 bg-white px-1.5 py-0.5 font-sans text-xs font-medium text-slate-700"
            >
              {{ k }}
            </kbd>
          </span>
          {{ s.label }}
        </li>
      </ul>
    </div>
    <p class="mt-4 text-xs text-slate-400">⌘ on macOS. Alt for new window, sidebar and back elsewhere; Ctrl for copy, paste and duplicate.</p>
  </FeatureSection>
</template>
