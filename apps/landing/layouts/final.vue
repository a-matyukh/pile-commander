<!-- The final landing: its own tokens (assets/css/final.css, scoped under .lf),
     a header that scrolls away with the page, the pinned menu of the blocks
     (wide screens) and a footer. The first block is a desktop: a
     wallpaper, the OS bar, the app's icon and its window. -->
<script setup lang="ts">
import "~/assets/css/final.css";
</script>

<template>
  <div class="lf relative flex min-h-dvh flex-col">
    <FinalWallpaper />
    <FinalOsBar />
    <FinalHeader />
    <FinalNav />
    <main class="flex-1">
      <slot />
    </main>
    <FinalFooter />
  </div>
</template>
