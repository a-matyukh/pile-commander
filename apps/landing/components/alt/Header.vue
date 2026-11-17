<script setup lang="ts">
const { demoUrl } = useAppLinks();
const { os } = useVisitorPlatform();

const githubUrl = "https://github.com/a-matyukh/pile-commander";
</script>

<template>
  <header class="bar">
    <div class="alt-wrap bar-in">
      <NuxtLink to="/alt" class="brand" aria-label="Pile Commander Beta">
        <img src="/app-icon.png" alt="" width="32" height="32" class="brand-icon">
        <span class="brand-name">Pile Commander</span>
        <span class="beta">Beta</span>
      </NuxtLink>

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
          class="alt-btn alt-btn-sm alt-btn-primary"
        >
          Try the demo
        </a>
        <NuxtLink v-else to="/download" class="alt-btn alt-btn-sm alt-btn-primary">
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
  border-bottom: 1px solid var(--alt-line);
  background: color-mix(in oklab, var(--alt-paper) 88%, transparent);
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
  color: var(--alt-ink);
  text-decoration: none;
}

.brand-icon {
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--alt-line);
  border-radius: var(--alt-radius-s);
}

.brand-name {
  display: none;
  font-family: var(--alt-font-display);
  font-size: 1.0625rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}

@media (min-width: 480px) {
  .brand-name {
    display: inline;
  }
}

.beta {
  border: 1px solid var(--alt-line);
  border-radius: 999px;
  padding: 0.1rem 0.5rem;
  color: var(--alt-ink-3);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.4;
}

.nav {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.nav-link {
  border-radius: 999px;
  padding: 0.4rem 0.8rem;
  color: var(--alt-ink-2);
  font-size: 0.9375rem;
  font-weight: 500;
  text-decoration: none;
}

.nav-link:hover,
.nav-icon:hover {
  background: var(--alt-wash);
  color: var(--alt-ink);
}

.nav-icon {
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  margin-right: 0.5rem;
  place-items: center;
  border-radius: 999px;
  color: var(--alt-ink-2);
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
