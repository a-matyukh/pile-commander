<script setup lang="ts">
const { clientUrl, desktopAppLink } = useAppLinks();

useSeoMeta({
  title: "Pricing",
  description:
    "Local use is free forever. Cloud Free is 100 MB, files up to 25 MB, invites, unlisted links, and Hub for up to 3 workspaces. Paid plans will sit next to Free later.",
  ogTitle: "Pricing — Pile Commander",
  ogDescription:
    "Work on your computer for free. Cloud Free is a lasting plan — paid tiers open after beta.",
  ogImage: "/app-icon.png",
  twitterCard: "summary",
});

const localFeatures = [
  "Everything the app can do without the cloud",
  "No account required",
  "Your files stay on your computer",
];

const cloudFeatures = [
  "100 MB in the cloud (workspaces, desktop files, and trash)",
  "Files up to 25 MB",
  "Your own cloud workspaces",
  "Invite people and join other workspaces",
  "Unlisted public live link",
  "Hub — up to 3 workspaces",
];

const notes = [
  {
    icon: "i-lucide-user-check",
    title: "The owner pays",
    body: "The person who owns the workspace pays. Invited people do not need their own plan.",
  },
  {
    icon: "i-lucide-shield-check",
    title: "Nothing gets locked",
    body: "Paid plans will open after this beta and sit next to Free. We will not silently lock or delete what you uploaded.",
  },
  {
    icon: "i-lucide-infinity",
    title: "Free stays",
    body: "Free is a lasting plan, not a beta trial. 100 MB across workspaces, desktops, and trash; one original up to 25 MB.",
  },
];
</script>

<template>
  <div>
    <section class="relative overflow-hidden px-5 pt-16 pb-12 md:pt-24">
      <div
        class="pointer-events-none absolute -top-32 left-1/2 size-[32rem] -translate-x-1/2 rounded-full bg-pc-400/20 blur-3xl"
        aria-hidden="true"
      />
      <div class="relative mx-auto max-w-3xl text-center">
        <p
          class="mb-5 inline-flex items-center gap-2 rounded-full border border-pc-200 bg-white/80 px-3 py-1 text-xs font-medium text-pc-700"
        >
          <span class="size-1.5 rounded-full bg-pc-500" />
          Local and Cloud Free stay free after beta
        </p>
        <h1 class="text-4xl tracking-tight text-slate-900 md:text-5xl">
          Free on your computer. Cloud when you need it.
        </h1>
        <p class="mx-auto mt-5 max-w-xl text-base leading-relaxed text-slate-600 md:text-lg">
          Work on your computer without an account, or sign in for a free
          cloud plan. Paid plans will sit next to them after beta — we are
          not quoting their prices yet.
        </p>
      </div>
    </section>

    <section class="px-5 pb-16">
      <div class="mx-auto grid max-w-4xl gap-5 md:grid-cols-2">
        <article class="flex flex-col rounded-2xl border border-[var(--pc-gray-border)] bg-white p-7">
          <div class="flex size-10 items-center justify-center rounded-xl bg-slate-100">
            <UIcon name="i-lucide-laptop" class="size-5 text-slate-700" />
          </div>
          <p class="mt-5 text-sm font-semibold text-slate-500">On your computer or browser</p>
          <p class="mt-2 text-4xl font-semibold tracking-tight text-slate-900">Free</p>
          <p class="mt-1 text-sm text-slate-500">Always, no account</p>
          <ul class="mt-6 flex-1 space-y-3 border-t border-[var(--pc-gray-border)] pt-6 text-sm leading-relaxed text-slate-600">
            <li v-for="item in localFeatures" :key="item" class="flex gap-2.5">
              <UIcon name="i-lucide-check" class="mt-0.5 size-4 shrink-0 text-pc-500" />
              <span>{{ item }}</span>
            </li>
          </ul>
          <div class="mt-8 grid gap-2.5">
            <UButton
              v-bind="desktopAppLink"
              color="primary"
              size="lg"
              icon="i-lucide-download"
              block
            >
              Download desktop app
            </UButton>
            <UButton
              :href="clientUrl"
              target="_blank"
              rel="noopener noreferrer"
              color="neutral"
              variant="outline"
              size="lg"
              block
            >
              Open web app
            </UButton>
          </div>
        </article>

        <article
          class="flex flex-col rounded-2xl border border-[var(--pc-gray-border)] bg-white p-7"
        >
          <div class="flex size-10 items-center justify-center rounded-xl bg-pc-50">
            <UIcon name="i-lucide-cloud" class="size-5 text-pc-600" />
          </div>
          <p class="mt-5 text-sm font-semibold text-pc-600">Cloud Free</p>
          <p class="mt-2 text-4xl font-semibold tracking-tight text-slate-900">Free</p>
          <p class="mt-1 text-sm text-slate-500">A lasting plan, not a trial</p>
          <ul class="mt-6 flex-1 space-y-3 border-t border-[var(--pc-gray-border)] pt-6 text-sm leading-relaxed text-slate-600">
            <li v-for="item in cloudFeatures" :key="item" class="flex gap-2.5">
              <UIcon name="i-lucide-check" class="mt-0.5 size-4 shrink-0 text-pc-500" />
              <span>{{ item }}</span>
            </li>
          </ul>
          <UButton
            class="mt-8"
            :href="clientUrl"
            target="_blank"
            rel="noopener noreferrer"
            color="primary"
            size="lg"
            block
          >
            Open web app
          </UButton>
        </article>

        <article
          class="grid gap-8 rounded-2xl border border-dashed border-slate-300 bg-[var(--pc-gray-muted)] p-7 md:col-span-2 md:grid-cols-[1fr_minmax(0,22rem)] md:items-center md:gap-12 md:p-9"
        >
          <div class="flex gap-5">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white">
              <UIcon name="i-lucide-sparkles" class="size-5 text-slate-500" />
            </div>
            <div>
              <div class="flex flex-wrap items-center gap-3">
                <h2 class="text-xl font-semibold tracking-tight text-slate-900">Paid plans</h2>
                <span class="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                  After beta
                </span>
              </div>
              <p class="mt-2 max-w-md text-sm leading-relaxed text-slate-600">
                We will announce them after beta. Leave your email and we will
                write when they are ready — nothing else.
              </p>
            </div>
          </div>
          <PricingNotifyForm />
        </article>
      </div>
    </section>

    <section class="px-5 pb-20">
      <div class="mx-auto grid max-w-4xl gap-4 md:grid-cols-3">
        <div
          v-for="note in notes"
          :key="note.title"
          class="rounded-2xl border border-[var(--pc-gray-border)] bg-white p-6"
        >
          <UIcon :name="note.icon" class="size-5 text-pc-500" />
          <h3 class="mt-3 text-base font-semibold text-slate-900">{{ note.title }}</h3>
          <p class="mt-1.5 text-sm leading-relaxed text-slate-600">{{ note.body }}</p>
        </div>
      </div>
    </section>
  </div>
</template>
