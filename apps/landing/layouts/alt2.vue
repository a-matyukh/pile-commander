<!-- The /alt2 landing: its own fonts, tokens, header and footer (DESIGN-alt2.md).
     The styles load only with this layout and are scoped under .alt2.
     While the owner reviews the page, ReviewSwitch picks two options:
     ?accent=blue|logo, how the six ideas are coloured, and
     ?font=inter|manrope|geologica, the blueprint's Inter Tight, the dark
     showcase's Manrope, or /alt's Geologica and Onest. A browser downloads
     only the faces in use. -->
<script setup lang="ts">
import "@fontsource-variable/inter-tight/wght.css";
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/manrope/wght.css";
import "@fontsource-variable/geologica/wght.css";
import "@fontsource-variable/onest/wght.css";
import "~/assets/css/alt2.css";

const route = useRoute();
const accent = computed(() => (route.query.accent === "logo" ? "logo" : "blue"));
const font = computed(() => {
  const f = String(route.query.font ?? "");
  return f === "manrope" || f === "geologica" ? f : "inter";
});
</script>

<template>
  <div class="alt2 flex min-h-dvh flex-col" :data-accent="accent" :data-font="font">
    <Alt2Header />
    <main class="flex-1">
      <slot />
    </main>
    <Alt2Footer />
    <Alt2ReviewSwitch :accent="accent" :font="font" />
  </div>
</template>
