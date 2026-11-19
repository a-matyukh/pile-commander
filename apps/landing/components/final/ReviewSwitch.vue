<!-- Temporary: lets the owner compare the tagline options on the live page
     (?tag=1|2|3). Removed with utils/finalTaglines.ts once one is chosen. -->
<script setup lang="ts">
import { finalTaglines, useFinalTagline } from "~/utils/finalTaglines";

const route = useRoute();
const tagline = useFinalTagline();
</script>

<template>
  <nav class="switch" aria-label="Review options">
    <span class="t">Tagline</span>
    <NuxtLink
      v-for="option in finalTaglines"
      :key="option.id"
      :to="{ query: { ...route.query, tag: option.id }, hash: route.hash }"
      class="opt"
      :aria-current="tagline.id === option.id ? 'true' : undefined"
      :title="`${option.lead} ${option.accent}`"
    >
      {{ option.id }}
    </NuxtLink>
  </nav>
</template>

<style scoped>
.switch {
  position: fixed;
  bottom: 1rem;
  left: 1rem;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 1.25rem;
  background: #111214;
  padding: 0.3rem;
  box-shadow: 0 10px 30px -10px rgb(0 0 0 / 0.5);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 0.8125rem;
  line-height: 1;
}

.t {
  padding: 0 0.4rem 0 0.6rem;
  color: rgb(255 255 255 / 0.55);
}

.opt {
  display: inline-grid;
  min-width: 2rem;
  min-height: 2rem;
  place-items: center;
  border-radius: 999px;
  color: rgb(255 255 255 / 0.8);
  text-decoration: none;
}

.opt:hover {
  color: #fff;
}

.opt[aria-current="true"] {
  background: #fff;
  color: #111214;
}
</style>
