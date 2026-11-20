<!-- The blocks 1–6 under the intro's window, numbered as the markers on it. -->
<script setup lang="ts">
import { finalIdeas } from "~/utils/finalIdeas";

const active = useState<number | null>("lf-active", () => null);
</script>

<template>
  <ol class="legend">
    <li v-for="idea in finalIdeas" :key="idea.n">
      <a
        :href="`#${idea.id}`"
        class="lg"
        :class="{ on: active === idea.n }"
        @mouseenter="active = idea.n"
        @mouseleave="active = null"
        @focus="active = idea.n"
        @blur="active = null"
      >
        <span class="lf-marker" aria-hidden="true">{{ idea.n }}</span>
        <span class="lg-text">
          <span class="lg-title">{{ idea.title }}</span>
          <span class="lg-hint">{{ idea.hint }}</span>
        </span>
      </a>
    </li>
  </ol>
</template>

<style scoped>
.legend {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.25rem 1rem;
  margin: 0.75rem 0 0;
  padding: 0;
  list-style: none;
}

@media (min-width: 640px) {
  .legend {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (min-width: 1100px) {
  .legend {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}

.lg {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  border-radius: 8px;
  padding: 0.625rem 0.5rem;
  color: var(--lf-ink-2);
  text-decoration: none;
  transition: background-color 0.15s ease;
}

.lg:hover,
.lg.on {
  background: rgb(36 83 255 / 0.08);
}

.lg-text {
  display: grid;
  gap: 0.125rem;
}

.lg-title {
  color: var(--lf-ink);
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.3;
}

.lg-hint {
  color: var(--lf-ink-3);
  font-size: 0.8125rem;
  line-height: 1.4;
}
</style>
