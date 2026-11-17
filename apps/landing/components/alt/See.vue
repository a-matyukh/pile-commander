<!-- The home page's view switcher, unchanged. Only its tabs and caption are
     restyled from here, so the page has one kind of tabs (see Tidy.vue). -->
<template>
  <AltSection
    class="see"
    label="See"
    shape="line"
    title="See what's in it."
    lede="One folder, eight ways to look at it. Every folder remembers its own view. Switch whenever the work changes: the files stay put, only the way of looking moves."
    wash
  >
    <HomeViewSwitcher />
  </AltSection>
</template>

<style scoped>
.see :deep([role="tablist"]) {
  gap: 0.25rem;
  border: 1px solid var(--alt-line);
  border-radius: 999px;
  background: var(--alt-paper);
  padding: 0.25rem;
  box-shadow: none;
}

.see :deep([role="tab"]) {
  height: 2.5rem;
  gap: 0.45rem;
  border-radius: 999px;
  padding: 0 1rem;
  color: var(--alt-ink-2);
  font-size: 0.9375rem;
  font-weight: 500;
}

.see :deep([role="tab"]:hover) {
  background: var(--alt-wash);
  color: var(--alt-ink);
}

.see :deep([role="tab"][aria-selected="true"]) {
  background: var(--alt-ink);
  color: #fff;
}

.see :deep([role="tab"]:focus-visible) {
  outline: 2px solid var(--alt-link);
  outline-offset: 3px;
}

/* The line that says what the chosen view is */
.see :deep(p[aria-live]) {
  color: var(--alt-ink-2);
  font-size: 0.9375rem;
  line-height: 1.5;
}

.see :deep(p[aria-live] span) {
  color: var(--alt-ink);
}
</style>
