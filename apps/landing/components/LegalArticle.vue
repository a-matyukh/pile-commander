<!-- Terms, Privacy and Support: the final landing's page (layouts/final.vue,
     assets/css/final.css) with a column of text on a white card. The pages
     themselves stay plain markup; their headings, lists and links are
     styled here. -->
<script setup lang="ts">
defineProps<{
  title: string
  updated: string
  /** Short line under the date */
  note?: string
}>()
</script>

<template>
  <div class="lf-page">
    <div class="lf-wrap">
      <header class="lf-page-head">
        <p class="lf-eyebrow">Legal</p>
        <h1 class="lf-page-title">{{ title }}</h1>
        <p class="lf-small meta">Last updated {{ updated }}</p>
        <p v-if="note" class="lf-small">{{ note }}</p>
      </header>
      <article class="lf-card prose">
        <slot />
      </article>
    </div>
  </div>
</template>

<style scoped>
.meta {
  margin-top: 1rem;
}

.prose {
  max-width: 46rem;
  margin-inline: auto;
  padding: clamp(1.5rem, 4vw, 3rem);
  color: var(--lf-ink-2);
  font-size: 1.0625rem;
  line-height: 1.65;
}

.prose :deep(> * + *) {
  margin-top: 1.1em;
}

.prose :deep(h2) {
  margin-top: 2em;
  color: var(--lf-ink);
  font-size: 1.3rem;
  font-weight: 700;
  letter-spacing: -0.015em;
  line-height: 1.25;
}

.prose :deep(h2:first-child) {
  margin-top: 0;
}

.prose :deep(p),
.prose :deep(ul) {
  margin-bottom: 0;
}

.prose :deep(ul) {
  padding-left: 1.25rem;
  list-style: disc;
}

.prose :deep(li + li) {
  margin-top: 0.4em;
}

.prose :deep(li::marker) {
  color: var(--lf-ink-3);
}

.prose :deep(a) {
  color: var(--lf-accent);
  text-decoration: underline;
  text-decoration-color: rgb(36 83 255 / 0.35);
  text-underline-offset: 0.2em;
}

.prose :deep(a:hover) {
  text-decoration-color: currentColor;
}

.prose :deep(strong),
.prose :deep(b) {
  color: var(--lf-ink);
}

.prose :deep(code) {
  border-radius: 4px;
  background: var(--lf-bg);
  padding: 0.1em 0.35em;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.875em;
}
</style>
