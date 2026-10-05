<script setup lang="ts">
const { demoUrl } = useAppLinks();

type Demo = {
  title: string;
  body: string;
  /** Preview screenshot. Without it the card shows a neutral placeholder. */
  image?: string;
  /** .pile archive on this site (apps/landing/public/demos, made by `bun run demo:pack`). */
  pileUrl: string;
  /** The same folder online: the web app's demo workspace. */
  workspaceUrl: string;
};

// Both archives and the web demo come from piles/ through `bun run demo:pack`.
// An empty URL renders its button disabled rather than pointing at "#".
const demos: Demo[] = [
  {
    title: "Features",
    body: "A tour of every view, file type and canvas tool, one folder each.",
    image: "/features-screenshot.png",
    pileUrl: "/demos/features.pile",
    workspaceUrl: "https://www.pile-commander.app/amatyukh/pile-commander-features",
  },
  {
    title: "Use cases",
    body: "Moodboards, project boards and research piles, set up the way people actually use them.",
	image: "/use-cases-screenshot.png",
    pileUrl: "/demos/use-cases.pile",
    workspaceUrl: "https://www.pile-commander.app/amatyukh/pile-commander-use-cases",
  },
];

const external = { target: "_blank", rel: "noopener noreferrer" };
</script>

<template>
  <FeatureSection
    eyebrow="Try it"
    title="Features & use cases, ready to open."
    lede="Download a demo as a .pile and open it in the desktop app, or look at the same workspace online."
  >
    <ul class="grid list-none gap-6 p-0 md:grid-cols-2">
      <li
        v-for="demo in demos"
        :key="demo.title"
        class="flex flex-col rounded-2xl border border-[var(--pc-gray-border)] bg-white p-3 pb-5"
      >
        <img
          v-if="demo.image"
          :src="demo.image"
          alt=""
          loading="lazy"
          class="aspect-video w-full rounded-xl object-cover"
        >
        <div
          v-else
          class="flex aspect-video items-center justify-center rounded-xl bg-pc-50/60"
          aria-hidden="true"
        >
          <UIcon name="i-lucide-folder" class="size-10 text-pc-300" />
        </div>

        <h3 class="mt-4 px-2 text-base font-semibold text-slate-900">{{ demo.title }}</h3>
        <p class="mt-1.5 px-2 text-sm leading-relaxed text-slate-600">{{ demo.body }}</p>

        <div class="mt-auto flex flex-wrap gap-2 px-2 pt-4">
          <UButton
            v-bind="demo.pileUrl ? { href: demo.pileUrl, download: '', external: true } : {}"
            :disabled="!demo.pileUrl"
            color="primary"
            icon="i-lucide-download"
          >
            Download .pile
          </UButton>
          <UButton
            v-bind="demo.workspaceUrl ? { href: demo.workspaceUrl, ...external } : {}"
            :disabled="!demo.workspaceUrl"
            color="neutral"
            variant="outline"
            trailing-icon="i-lucide-arrow-up-right"
          >
            Open online
          </UButton>
        </div>
      </li>
    </ul>
  </FeatureSection>
</template>
