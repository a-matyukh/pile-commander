<script setup lang="ts">
import { alt2Ideas as ideas } from "~/utils/alt2Ideas";

const { demoUrl } = useAppLinks();
const { os } = useDownloadCta();
const route = useRoute();

const githubUrl = "https://github.com/a-matyukh/pile-commander";
</script>

<template>
  <header class="bar">
    <div class="a2-wrap bar-in">
      <!-- Keeps ?d= while the directions are being compared -->
      <NuxtLink :to="{ path: '/alt2', query: route.query }" class="brand" aria-label="Pile Commander Beta">
        <img src="/app-icon.png" alt="" width="32" height="32" class="brand-icon">
        <span class="brand-name">Pile Commander</span>
        <span class="beta">Beta</span>
      </NuxtLink>

      <nav class="ideas" aria-label="On this page">
        <a v-for="idea in ideas" :key="idea.id" :href="`#${idea.id}`" class="idea">
          {{ idea.short }}
        </a>
      </nav>

      <nav class="nav" aria-label="Primary">
        <NuxtLink to="/pricing" class="nav-link">Pricing</NuxtLink>
        <a
          :href="githubUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="nav-icon"
          aria-label="Pile Commander on GitHub"
        >
          <UIcon name="i-tabler-brand-github" class="size-5" />
        </a>
        <!-- A phone cannot run the desktop app: its one action is the web demo -->
        <a
          v-if="os === 'mobile'"
          :href="demoUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="a2-btn a2-btn-sm a2-btn-primary"
        >
          Try the demo
        </a>
        <NuxtLink v-else to="/download" class="a2-btn a2-btn-sm a2-btn-primary">
          Download
        </NuxtLink>
      </nav>
    </div>
  </header>
</template>

<style scoped>
.bar {
  position: sticky;
  top: 0;
  z-index: 40;
  border-bottom: 1px solid var(--a2-line);
  background: var(--a2-header-bg);
  backdrop-filter: blur(12px);
}

.bar-in {
  display: flex;
  min-height: 4rem;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  color: var(--a2-ink);
  text-decoration: none;
}

.brand-icon {
  width: 2rem;
  height: 2rem;
  border-radius: var(--a2-radius-s);
  background: #fff;
  box-shadow: 0 0 0 1px var(--a2-line);
}

.brand-name {
  display: none;
  font-family: var(--a2-font-display);
  font-size: 1.0625rem;
  font-weight: var(--a2-display-weight);
  letter-spacing: -0.02em;
}

@media (min-width: 480px) {
  .brand-name {
    display: inline;
  }
}

.beta {
  border: 1px solid var(--a2-line);
  border-radius: 999px;
  padding: 0.1rem 0.5rem;
  color: var(--a2-ink-3);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.4;
}

/* The six ideas, on screens wide enough to hold them */
.ideas {
  display: none;
}

@media (min-width: 1100px) {
  .ideas {
    display: flex;
    gap: 0.125rem;
  }
}

.idea {
  border-radius: var(--a2-radius-s);
  padding: 0.375rem 0.625rem;
  color: var(--a2-ink-3);
  font-size: 0.875rem;
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
}

.idea:hover {
  color: var(--a2-ink);
}

.nav {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.nav-link {
  border-radius: var(--a2-radius-s);
  padding: 0.4rem 0.8rem;
  color: var(--a2-ink-2);
  font-size: 0.9375rem;
  font-weight: 500;
  text-decoration: none;
}

.nav-link:hover,
.nav-icon:hover {
  color: var(--a2-ink);
}

.nav-icon {
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  margin-right: 0.5rem;
  place-items: center;
  border-radius: 999px;
  color: var(--a2-ink-2);
}

/* The narrowest phones: the logo, Pricing and the one action */
@media (max-width: 419px) {
  .nav-icon {
    display: none;
  }

  .nav-link {
    margin-right: 0.25rem;
  }
}

@media (max-width: 359px) {
  .beta {
    display: none;
  }
}
</style>
