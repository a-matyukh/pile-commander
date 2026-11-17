<!-- The /alt landing: its own fonts, tokens, header and footer (DESIGN.md).
     The styles load only with this layout and are scoped under .alt. -->
<script setup lang="ts">
import "@fontsource-variable/geologica/wght.css";
import "@fontsource-variable/onest/wght.css";
import "~/assets/css/alt.css";
</script>

<template>
  <div class="alt flex min-h-dvh flex-col">
    <AltHeader />
    <main class="flex-1">
      <slot />
    </main>
    <AltFooter />
  </div>
</template>
