<!-- The same links as the site's footer (components/SiteFooter.vue), in this
     page's paper and ink. -->
<script setup lang="ts">
const { clientUrl } = useAppLinks();

const links = [
  { label: "Home", to: "/" },
  { label: "Pricing", to: "/pricing" },
  { label: "Terms", to: "/terms" },
  { label: "Privacy", to: "/privacy" },
  { label: "Support", to: "/support" },
  { label: "Download desktop app", to: "/download" },
];
</script>

<template>
  <footer class="foot">
    <div class="alt-wrap foot-in">
      <p class="name">Pile Commander</p>
      <nav class="links" aria-label="Footer">
        <NuxtLink v-for="link in links" :key="link.to" :to="link.to" class="link">
          {{ link.label }}
        </NuxtLink>
        <a :href="clientUrl" target="_blank" rel="noopener noreferrer" class="link">
          Open web app
        </a>
      </nav>
    </div>
  </footer>
</template>

<style scoped>
.foot {
  border-top: 1px solid var(--alt-line);
  background: var(--alt-paper);
}

.foot-in {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1rem;
  padding-block: 2rem;
}

@media (min-width: 900px) {
  .foot-in {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}

.name {
  margin: 0;
  color: var(--alt-ink);
  font-family: var(--alt-font-display);
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.5rem;
}

/* Tall enough to tap */
.link {
  display: inline-flex;
  min-height: 2.75rem;
  align-items: center;
  color: var(--alt-ink-2);
  font-size: 0.9375rem;
  text-decoration: none;
}

.link:hover {
  color: var(--alt-ink);
  text-decoration: underline;
  text-underline-offset: 0.2em;
}
</style>
