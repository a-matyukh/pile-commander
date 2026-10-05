<script setup lang="ts">
const { clientUrl, demoUrl, desktopAppLink } = useAppLinks();
const route = useRoute();

const links = [
  { label: "Home", to: "/" },
  { label: "Vision", to: "/vision" },
  { label: "Pricing", to: "/pricing" },
  { label: "Feedback", to: "/feedback" },
];

const githubUrl = "https://github.com/a-matyukh/pile-commander";
</script>

<template>
  <header
    class="sticky top-0 z-40 border-b border-[var(--pc-gray-border)] bg-[color-mix(in_oklab,var(--pc-gray-header)_88%,transparent)] backdrop-blur-md"
  >
    <div class="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
      <NuxtLink to="/" class="flex items-center gap-2.5 no-underline" aria-label="Pile Commander Beta">
        <img src="/app-icon.png" alt="" width="28" height="28" class="size-7 rounded-lg" />
        <span class="flex items-center gap-1.5">
          <span class="hidden text-[15px] font-semibold tracking-tight text-slate-900 sm:inline">
            Pile Commander
          </span>
          <span
            class="rounded-md bg-pc-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-pc-700 uppercase"
          >
            Beta
          </span>
        </span>
      </NuxtLink>

      <nav class="flex items-center gap-0.5 sm:gap-1" aria-label="Primary">
        <NuxtLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="rounded-lg px-2 py-1.5 text-sm no-underline transition-colors sm:px-3"
          :class="
            route.path === link.to
              ? 'font-semibold text-slate-900'
              : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
          "
        >
          {{ link.label }}
        </NuxtLink>
      </nav>

      <div class="flex shrink-0 items-center gap-2">
        <UButton
          :href="githubUrl"
          target="_blank"
          rel="noopener noreferrer"
          color="neutral"
          variant="ghost"
          icon="bytesize:github"
          aria-label="Pile Commander on GitHub"
        />
        <UButton
          v-bind="desktopAppLink"
          color="neutral"
          variant="outline"
          size="sm"
          aria-label="Download desktop app"
        >
          <span class="sm:hidden">Desktop app</span>
          <span class="hidden sm:inline">Download desktop app</span>
        </UButton>
        <UButton
          :href="clientUrl"
          target="_blank"
          rel="noopener noreferrer"
          color="primary"
          size="sm"
          aria-label="Open web app"
        >
          <span class="sm:hidden">Web app</span>
          <span class="hidden sm:inline">Open web app</span>
        </UButton>
        <UButton
          :href="demoUrl"
          target="_blank"
          rel="noopener noreferrer"
          color="neutral"
          variant="outline"
          size="sm"
          aria-label="Try a web demo"
        >
          <span class="sm:hidden">Web demo</span>
          <span class="hidden sm:inline">Try a web demo</span>
        </UButton>
      </div>
    </div>
  </header>
</template>
