<script setup lang="ts">
const notes = [
  {
    icon: "i-lucide-radio",
    title: "Members see it in realtime",
    body: "Editors and viewers you invite get every edit as it happens.",
  },
  {
    icon: "i-lucide-globe",
    title: "Visitors see what is there",
    body: "A public link shows the workspace as it is when someone opens it — not a copy you have to re-export.",
  },
  {
    icon: "i-lucide-git-fork",
    title: "Forks, if you allow them",
    body: "A signed-in visitor can copy your workspace into their own account, or download it as a .pile.",
  },
];
</script>

<template>
  <FeatureSection
    eyebrow="Share and publish"
    title="Invite a person. Publish a link. List it on the Hub."
    lede="A cloud workspace can be shared three ways, and you choose each one separately."
    muted
  >
    <ol class="grid list-none gap-4 p-0 lg:grid-cols-3" aria-label="Sharing steps">
      <!-- Share -->
      <li class="relative flex flex-col">
        <p class="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span class="flex size-6 items-center justify-center rounded-full bg-pc-500 text-xs text-white">1</span>
          Share workspace
        </p>
        <div class="flex-1 rounded-2xl border border-[var(--pc-gray-border)] bg-white p-4 shadow-sm" aria-hidden="true">
          <div class="flex gap-2">
            <span class="flex-1 truncate rounded-lg border border-[var(--pc-gray-border)] px-2.5 py-1.5 text-xs text-slate-700">maya@studio.com</span>
            <span class="inline-flex items-center gap-1 rounded-lg border border-[var(--pc-gray-border)] px-2 py-1.5 text-xs text-slate-700">
              Editor <UIcon name="i-lucide-chevron-down" class="size-3" />
            </span>
            <span class="rounded-lg bg-pc-500 px-2.5 py-1.5 text-xs font-medium text-white">Invite</span>
          </div>
          <p class="mt-4 text-[11px] font-medium tracking-wide text-slate-400 uppercase">People</p>
          <div class="mt-2 space-y-2 text-xs">
            <p class="flex items-center gap-2 text-slate-700">
              <span class="flex size-6 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-semibold text-emerald-700">S</span>
              sam@studio.com
              <span class="ml-auto rounded bg-[var(--pc-gray-header)] px-1.5 py-0.5 text-[10px] text-slate-500">Viewer</span>
            </p>
            <p class="flex items-center gap-2 text-slate-700">
              <span class="flex size-6 items-center justify-center rounded-full bg-violet-100 text-[10px] font-semibold text-violet-700">J</span>
              jo@studio.com
              <span class="ml-auto rounded bg-[var(--pc-gray-header)] px-1.5 py-0.5 text-[10px] text-slate-500">Editor</span>
            </p>
          </div>
          <p class="mt-4 text-[11px] font-medium tracking-wide text-slate-400 uppercase">Invited, waiting</p>
          <p class="mt-2 flex items-center gap-2 text-xs text-slate-500">
            <UIcon name="i-lucide-mail" class="size-3.5" />
            lee@studio.com
            <span class="ml-auto text-pc-600">Resend</span>
          </p>
        </div>
      </li>

      <!-- Publish -->
      <li class="relative flex flex-col">
        <p class="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span class="flex size-6 items-center justify-center rounded-full bg-pc-500 text-xs text-white">2</span>
          Publish
        </p>
        <div class="flex-1 rounded-2xl border border-[var(--pc-gray-border)] bg-white p-4 shadow-sm" aria-hidden="true">
          <p class="flex items-center gap-1 rounded-lg bg-[var(--pc-gray-header)] px-2.5 py-1.5 font-mono text-xs text-slate-600">
            <UIcon name="i-lucide-link" class="size-3.5 text-pc-500" />
            /alex/<span class="text-slate-900">harbor-mood</span>
            <span class="ml-auto font-sans text-pc-600">Copy link</span>
          </p>
          <div class="mt-4 space-y-3 text-xs text-slate-700">
            <p v-for="t in ['Make public', 'Allow forks and downloads as .pile', 'List on Hub']" :key="t" class="flex items-center gap-2">
              <span class="flex h-4 w-7 items-center justify-end rounded-full bg-pc-500 p-0.5">
                <span class="size-3 rounded-full bg-white" />
              </span>
              {{ t }}
            </p>
          </div>
          <p class="mt-4 text-[11px] font-medium tracking-wide text-slate-400 uppercase">Tags</p>
          <p class="mt-2 flex flex-wrap gap-1 text-[11px] text-slate-600">
            <span v-for="t in ['moodboard', 'film', 'harbor']" :key="t" class="rounded-md bg-pc-50 px-1.5 py-0.5 text-pc-700">#{{ t }}</span>
          </p>
        </div>
      </li>

      <!-- Hub -->
      <li class="relative flex flex-col">
        <p class="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span class="flex size-6 items-center justify-center rounded-full bg-pc-500 text-xs text-white">3</span>
          Found on the Hub
        </p>
        <div class="flex-1 rounded-2xl border border-[var(--pc-gray-border)] bg-white p-4 shadow-sm" aria-hidden="true">
          <div class="flex gap-1 text-[11px]">
            <span class="rounded-md bg-slate-900 px-2 py-1 font-medium text-white">Workspaces</span>
            <span class="rounded-md px-2 py-1 text-slate-500">Authors</span>
            <span class="rounded-md px-2 py-1 text-slate-500">Tags</span>
          </div>
          <div class="mt-3 overflow-hidden rounded-xl border border-[var(--pc-gray-border)]">
            <div class="relative h-24 bg-[linear-gradient(180deg,#bae6fd_0%,#7dd3fc_45%,#2182f8_100%)]">
              <svg class="absolute inset-x-0 bottom-0 h-1/2 w-full" viewBox="0 0 100 40" preserveAspectRatio="none">
                <path d="M0 22 Q 20 14 40 22 T 80 20 T 100 18 V40 H0 Z" fill="#1553aa" opacity=".55" />
                <path d="M0 30 Q 25 24 50 30 T 100 28 V40 H0 Z" fill="#0c2b5c" opacity=".7" />
              </svg>
            </div>
            <div class="p-3">
              <p class="text-sm font-semibold text-slate-900">Harbor mood</p>
              <p class="text-[11px] text-slate-500">by @alex</p>
              <div class="mt-2 flex items-center gap-1 text-[10px] text-slate-500">
                <span class="rounded bg-[var(--pc-gray-header)] px-1.5 py-0.5">#moodboard</span>
                <span class="rounded bg-[var(--pc-gray-header)] px-1.5 py-0.5">#film</span>
                <span class="ml-auto inline-flex items-center gap-1 rounded-md border border-[var(--pc-gray-border)] px-1.5 py-0.5 font-medium text-slate-700">
                  <UIcon name="i-lucide-git-fork" class="size-3" />Fork (12)
                </span>
              </div>
            </div>
          </div>
        </div>
      </li>
    </ol>

    <ul class="mt-10 grid list-none gap-6 p-0 md:grid-cols-3">
      <li v-for="n in notes" :key="n.title" class="flex gap-3">
        <UIcon :name="n.icon" class="mt-0.5 size-5 shrink-0 text-pc-500" />
        <div>
          <h3 class="text-base font-semibold text-slate-900">{{ n.title }}</h3>
          <p class="mt-1 text-sm leading-relaxed text-slate-600">{{ n.body }}</p>
        </div>
      </li>
    </ul>
  </FeatureSection>
</template>
