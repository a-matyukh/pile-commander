<!-- A section of the /alt2 page: its number and word (the same number as on
     the hero's map), the headline on the left, the paragraph on the right,
     then the scene, three short facts and an optional note. -->
<script setup lang="ts">
defineProps<{
  id: string;
  n: number;
  label: string;
  title: string;
  lede?: string;
  facts?: { title: string; text: string }[];
  note?: string;
  /** The other background, to tell neighbouring sections apart */
  alt?: boolean;
}>();
</script>

<template>
  <section :id="id" class="sec" :class="{ alt }" :data-n="n" :aria-labelledby="`${id}-title`">
    <div class="a2-wrap">
      <header class="top">
        <div>
          <p class="a2-label">
            <span class="a2-marker" :data-n="n" aria-hidden="true">{{ n }}</span>
            {{ label }}
          </p>
          <h2 :id="`${id}-title`" class="a2-h2">{{ title }}</h2>
        </div>
        <p v-if="lede" class="a2-lede">{{ lede }}</p>
      </header>

      <div v-if="$slots.default" class="content">
        <slot />
      </div>

      <ul v-if="facts?.length" class="facts">
        <li v-for="fact in facts" :key="fact.title" class="fact">
          <h3 class="a2-h3">{{ fact.title }}</h3>
          <p>{{ fact.text }}</p>
        </li>
      </ul>

      <p v-if="note" class="a2-small note">{{ note }}</p>
    </div>
  </section>
</template>

<style scoped>
.sec {
  padding: var(--a2-section) 0;
}

.alt {
  background: var(--a2-bg-alt);
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

.a2-h2 {
  margin-top: 1rem;
}

.content {
  margin-top: clamp(2rem, 4vw, 3.5rem);
}

.facts {
  display: grid;
  gap: 1.5rem;
  margin: clamp(2rem, 4vw, 3rem) 0 0;
  padding: 0;
  list-style: none;
}

@media (min-width: 900px) {
  .facts {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 2.5rem;
  }
}

.fact {
  border-top: 1px solid var(--a2-line);
  padding-top: 1rem;
}

.fact p {
  margin: 0.375rem 0 0;
  font-size: 1rem;
  line-height: 1.55;
}

.note {
  margin-top: 1.5rem;
}
</style>
