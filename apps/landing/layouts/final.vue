<!-- The final landing: its own tokens (assets/css/final.css, scoped under .lf),
     a header that scrolls away with the page, the pinned menu of the blocks
     (wide screens) and a footer. The first block is a desktop: the
     OS bar, the app's icon and its window.
     The pages in the footer (pricing, download, the legal ones) use it too:
     a page with `blocks: true` in its meta (the landing itself) gets the
     OS bar, the menu of the blocks and the tagline as its h1; the others
     get the icon and the name, their own title as the h1 and the full
     width. -->
<script setup lang="ts">
import "~/assets/css/final.css";

const route = useRoute();
const blocks = computed(() => route.meta.blocks === true);
</script>

<template>
  <div class="lf relative flex min-h-dvh flex-col" :class="{ 'lf-blocks': blocks }">
    <FinalOsBar v-if="blocks" />
    <FinalHeader :main="blocks" />
    <FinalNav v-if="blocks" />
    <main class="flex-1">
      <slot />
    </main>
    <FinalFooter />
  </div>
</template>
