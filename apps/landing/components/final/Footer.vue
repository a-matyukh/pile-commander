<!-- The same links as the site's footer (components/SiteFooter.vue), and the
     company behind the app with the year. -->
<script setup lang="ts">
const { clientUrl } = useAppLinks();
const year = new Date().getFullYear();

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
      <div class="who">
        <p class="name">Pile Commander</p>
        <p class="copy">© {{ year }} <a href="https://www.kmcn-lab.com/" target="_blank" rel="noopener noreferrer" class="co">KMCN Lab LLC</a></p>
      </div>
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

.who {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.name {
  margin: 0;
  font-weight: 600;
}

.copy {
  margin: 0;
  color: var(--lf-ink-3);
  font-size: 0.8125rem;
}

.co {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: rgb(0 0 0 / 0.2);
  text-underline-offset: 0.2em;
}

.co:hover {
  color: var(--lf-ink);
  text-decoration-color: currentColor;
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
