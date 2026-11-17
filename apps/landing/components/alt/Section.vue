<!-- A section of the /alt page: its label (one icon shape and a word), the
     headline on the left, the paragraph on the right, then the content. -->
<script setup lang="ts">
defineProps<{
  label: string;
  shape: "line" | "rect" | "square" | "circle" | "arc";
  title: string;
  lede?: string;
  /** The quieter background, to tell neighbouring sections apart */
  wash?: boolean;
}>();
</script>

<template>
  <section class="section" :class="{ wash }">
    <div class="alt-wrap">
      <header class="top">
        <div>
          <p class="alt-label">
            <AltShape :kind="shape" class="mark" />
            {{ label }}
          </p>
          <h2 class="alt-h2">{{ title }}</h2>
        </div>
        <p v-if="lede" class="alt-lede">{{ lede }}</p>
      </header>

      <div class="content">
        <slot />
      </div>
    </div>
  </section>
</template>

<style scoped>
.section {
  padding: var(--alt-section) 0;
}

.wash {
  background: var(--alt-wash);
}

.top {
  display: grid;
  gap: 1.25rem;
}

@media (min-width: 900px) {
  .top {
    grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
    gap: 3.5rem;
    align-items: end;
  }
}

.mark {
  font-size: 1.125rem;
}

.alt-h2 {
  margin-top: 1rem;
}

.content {
  margin-top: clamp(2rem, 4vw, 3.5rem);
}
</style>
