<script setup lang="ts">
const { clientUrl, desktopAppLink } = useAppLinks();
</script>

<template>
  <footer class="border-t border-[var(--pc-gray-border)] bg-[var(--pc-gray-header)]">
    <div
      class="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-5 py-8 sm:flex-row sm:items-center"
    >
      <p class="text-sm font-semibold text-slate-800">Pile Commander</p>
      <nav class="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" aria-label="Footer">
        <NuxtLink to="/" class="text-slate-600 no-underline hover:text-slate-900">
          Home
        </NuxtLink>
        <NuxtLink to="/vision" class="text-slate-600 no-underline hover:text-slate-900">
          Vision
        </NuxtLink>
        <NuxtLink to="/pricing" class="text-slate-600 no-underline hover:text-slate-900">
          Pricing
        </NuxtLink>
        <NuxtLink to="/feedback" class="text-slate-600 no-underline hover:text-slate-900">
          Feedback
        </NuxtLink>
        <NuxtLink to="/terms" class="text-slate-600 no-underline hover:text-slate-900">
          Terms
        </NuxtLink>
        <NuxtLink to="/privacy" class="text-slate-600 no-underline hover:text-slate-900">
          Privacy
        </NuxtLink>
        <NuxtLink to="/support" class="text-slate-600 no-underline hover:text-slate-900">
          Support
        </NuxtLink>
        <a
          v-bind="desktopAppLink"
          class="text-slate-600 no-underline hover:text-slate-900"
        >
          Download desktop app
        </a>
        <a
          :href="clientUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="text-slate-600 no-underline hover:text-slate-900"
        >
          Open web app
        </a>
      </nav>
    </div>
  </footer>
</template>
