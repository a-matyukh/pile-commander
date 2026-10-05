<script setup lang="ts">
const places = [
  {
    icon: "i-lucide-hard-drive",
    name: "Local",
    where: "Desktop app",
    price: "Free, no account",
    points: [
      "Real folders on your disk",
      "Export and import .pile archives",
      "Copy to cloud when you want to share",
    ],
  },
  {
    icon: "i-lucide-globe",
    name: "Browser",
    where: "Any browser",
    price: "Free, no account",
    points: [
      "Desktops saved in this browser",
      "A demo workspace to try everything",
      "Nothing to install",
    ],
  },
  {
    icon: "i-lucide-cloud",
    name: "Cloud",
    where: "Desktop app or browser",
    price: "Free plan: 100 MB",
    points: [
      "The same desktops on every device",
      "Invites, live editing, publishing, the Hub",
      "Trash that keeps things for 30 days",
    ],
    highlight: true,
  },
];
</script>

<template>
  <FeatureSection
    eyebrow="Where it lives"
    title="On your disk, in your browser, or in the cloud."
    lede="Pick per desktop. You only need an account for the cloud."
  >
    <div class="grid gap-4 md:grid-cols-3">
      <article
        v-for="place in places"
        :key="place.name"
        class="flex flex-col rounded-2xl border p-6"
        :class="place.highlight ? 'border-pc-200 bg-pc-50/50' : 'border-[var(--pc-gray-border)] bg-[var(--pc-gray-surface)]'"
      >
        <div class="flex items-center gap-3">
          <span class="flex size-10 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-[var(--pc-gray-border)]">
            <UIcon :name="place.icon" class="size-5 text-pc-500" />
          </span>
          <div>
            <h3 class="text-lg font-semibold text-slate-900">{{ place.name }}</h3>
            <p class="text-xs text-slate-500">{{ place.where }}</p>
          </div>
        </div>
        <p class="mt-5 text-sm font-semibold text-pc-700">{{ place.price }}</p>
        <ul class="mt-3 flex-1 list-none space-y-2 p-0 text-sm leading-relaxed text-slate-600">
          <li v-for="p in place.points" :key="p" class="flex gap-2">
            <UIcon name="i-lucide-check" class="mt-1 size-3.5 shrink-0 text-pc-500" />
            {{ p }}
          </li>
        </ul>
        <p v-if="place.highlight" class="mt-5 text-xs leading-relaxed text-slate-500">
          Files up to 25 MB, up to 3 workspaces on the Hub.
          <NuxtLink to="/pricing" class="font-medium text-pc-600 no-underline hover:underline">See pricing</NuxtLink>
        </p>
      </article>
    </div>

    <div class="mt-6 flex gap-4 rounded-2xl border border-[var(--pc-gray-border)] bg-white p-6">
      <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
        <UIcon name="i-lucide-lock" class="size-5" />
      </span>
      <div>
        <h3 class="text-base font-semibold text-slate-900">Media in the cloud stays private</h3>
        <p class="mt-1.5 max-w-3xl text-sm leading-relaxed text-slate-600">
          Uploaded files sit in a private bucket, encrypted at rest with AES-256.
          The app opens them through short-lived signed links, and anonymous
          visitors to a public workspace see thumbnails and poster frames rather
          than your originals. Files that stay on
          your computer never go there.
          <a
            href="https://www.backblaze.com/blog/backblaze-b2-to-encrypt-new-uploads-by-default/"
            target="_blank"
            rel="noopener noreferrer"
            class="font-medium text-pc-600 no-underline hover:underline"
          >
            How Backblaze encrypts files at rest
          </a>
        </p>
      </div>
    </div>
  </FeatureSection>
</template>
