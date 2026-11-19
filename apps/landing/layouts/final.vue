<!-- The final landing: its own tokens (assets/css/final.css, scoped under .lf),
     a header that scrolls away with the page and a footer. -->
<script setup lang="ts">
import "~/assets/css/final.css";
</script>

<template>
  <div class="lf flex min-h-dvh flex-col">
    <FinalHeader />
    <main class="flex-1">
      <slot />
    </main>
    <FinalFooter />
    <FinalReviewSwitch />
  </div>
</template>
