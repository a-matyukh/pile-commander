<!-- Temporary: lets the owner compare options on the live page. It looks the
     same whatever the page's settings. Removed once the choices are made.
     Accent: one blue for every idea, or the app icon's colours per idea.
     Font: the blueprint's Inter Tight, the dark showcase's Manrope, or /alt's
     Geologica and Onest. -->
<script setup lang="ts">
defineProps<{ accent: string; font: string }>();

const route = useRoute();

const groups = [
  {
    key: "accent",
    title: "Accent",
    options: [
      { value: "blue", name: "Blue" },
      { value: "logo", name: "Logo colours" },
    ],
  },
  {
    key: "font",
    title: "Font",
    options: [
      { value: "inter", name: "Inter Tight" },
      { value: "manrope", name: "Manrope" },
      { value: "geologica", name: "Geologica" },
    ],
  },
] as const;
</script>

<template>
  <nav class="switch" aria-label="Review options">
    <div v-for="group in groups" :key="group.key" class="group">
      <span class="t">{{ group.title }}</span>
      <NuxtLink
        v-for="option in group.options"
        :key="option.value"
        :to="{ query: { ...route.query, [group.key]: option.value }, hash: route.hash }"
        class="opt"
        :aria-current="(group.key === 'accent' ? accent : font) === option.value ? 'true' : undefined"
      >
        {{ option.name }}
      </NuxtLink>
    </div>
  </nav>
</template>

<style scoped>
.switch {
  position: fixed;
  bottom: 1rem;
  left: 1rem;
  z-index: 60;
  display: flex;
  max-width: calc(100vw - 2rem);
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.5rem;
  box-sizing: border-box;
  border-radius: 1.25rem;
  background: #111214;
  padding: 0.3rem;
  box-shadow: 0 10px 30px -10px rgb(0 0 0 / 0.5);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 0.8125rem;
  line-height: 1;
}

.group {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.t {
  padding: 0 0.4rem 0 0.6rem;
  color: rgb(255 255 255 / 0.55);
}

.opt {
  display: inline-flex;
  min-height: 2rem;
  align-items: center;
  border-radius: 999px;
  padding: 0 0.75rem;
  color: rgb(255 255 255 / 0.8);
  text-decoration: none;
  white-space: nowrap;
}

.opt:hover {
  color: #fff;
}

.opt[aria-current="true"] {
  background: #fff;
  color: #111214;
}
</style>
