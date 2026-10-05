<script setup lang="ts">
const allowIndexing = useRuntimeConfig().public.allowIndexing === true;

useHead({
  titleTemplate: (title?: string) =>
    title ? `${title} — Pile Commander` : "Pile Commander",
  meta: [
    {
      name: "description",
      content:
        "A visual workspace for files, notes, and ideas. Keep them on your computer, or share a live link.",
    },
    ...(!allowIndexing
      ? [{ name: "robots", content: "noindex, nofollow" }]
      : []),
  ],
});
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
