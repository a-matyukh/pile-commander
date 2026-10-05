<script setup lang="ts">
defineProps<{
  title: string
  updated: string
  /** Short line under the date, e.g. the beta caveat */
  note?: string
}>()
</script>

<template>
  <article class="mx-auto max-w-3xl px-5 py-16">
    <p class="mb-3 text-xs font-semibold tracking-[0.08em] text-pc-600 uppercase">
      Legal
    </p>
    <h1 class="text-4xl tracking-tight text-slate-900">{{ title }}</h1>
    <p class="mt-3 text-sm text-slate-500">Last updated {{ updated }}</p>
    <p v-if="note" class="mt-1 text-sm text-slate-500">{{ note }}</p>
    <!-- Section styling lives here so the pages themselves stay plain markup -->
    <div
      class="mt-10 space-y-6 text-base leading-relaxed text-slate-700 [&_a]:text-pc-600 [&_a]:underline [&_code]:text-sm [&_h2]:pt-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:leading-relaxed [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5"
    >
      <slot />
    </div>
  </article>
</template>
