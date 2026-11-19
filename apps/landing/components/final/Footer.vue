<!-- The same links as the site's footer (components/SiteFooter.vue). -->
<script setup lang="ts">
const { clientUrl } = useAppLinks();

const links = [
  { label: "Pricing", to: "/pricing" },
  { label: "Terms", to: "/terms" },
  { label: "Privacy", to: "/privacy" },
  { label: "Support", to: "/support" },
  { label: "Download desktop app", to: "/download" },
];
</script>

<template>
  <footer class="foot">
    <div class="lf-wrap foot-in">
      <p class="name">Pile Commander</p>
      <nav class="links" aria-label="Footer">
        <NuxtLink v-for="link in links" :key="link.to" :to="link.to" class="link">
          {{ link.label }}
        </NuxtLink>
        <a :href="clientUrl" target="_blank" rel="noopener noreferrer" class="link">Open web app</a>
      </nav>
    </div>
  </footer>
</template>

<style scoped>
.foot {
  border-top: 1px solid var(--lf-line);
}

.foot-in {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-block: 2rem;
}

.name {
  margin: 0;
  font-weight: 600;
}

.links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.25rem;
}

.link {
  color: var(--lf-ink-2);
  font-size: 0.875rem;
  text-decoration: none;
}

.link:hover {
  color: var(--lf-ink);
}
</style>
