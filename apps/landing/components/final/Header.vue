<!-- Not sticky: the page gives the whole screen to the content. -->
<script setup lang="ts">
const { demoUrl } = useAppLinks();
const { os } = useDownloadCta();

const githubUrl = "https://github.com/a-matyukh/pile-commander";
</script>

<template>
  <header class="bar">
    <div class="lf-wrap bar-in">
      <NuxtLink to="/final" class="brand" aria-label="Pile Commander">
        <img src="/app-icon.png" alt="" width="32" height="32" class="brand-icon">
        <span class="brand-name">Pile Commander</span>
      </NuxtLink>

      <nav class="nav" aria-label="Primary">
        <NuxtLink to="/pricing" class="nav-link">Pricing</NuxtLink>
        <a :href="githubUrl" target="_blank" rel="noopener noreferrer" class="nav-icon" aria-label="Pile Commander on GitHub">
          <UIcon name="i-tabler-brand-github" class="size-5" />
        </a>
        <!-- A phone cannot run the desktop app: its one action is the web demo -->
        <a v-if="os === 'mobile'" :href="demoUrl" target="_blank" rel="noopener noreferrer" class="lf-btn lf-btn-sm lf-btn-primary">
          Try the demo
        </a>
        <NuxtLink v-else to="/download" class="lf-btn lf-btn-sm lf-btn-primary">
          Download
        </NuxtLink>
      </nav>
    </div>
  </header>
</template>

<style scoped>
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
  color: var(--lf-ink);
  text-decoration: none;
}

.brand-icon {
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
}

.brand-name {
  font-size: 1rem;
  font-weight: 600;
  white-space: nowrap;
}

.nav {
  display: flex;
  align-items: center;
  gap: 1.25rem;
}

.nav-link,
.nav-icon {
  display: inline-flex;
  color: var(--lf-ink-2);
  font-size: 0.9375rem;
  text-decoration: none;
}

.nav-link:hover,
.nav-icon:hover {
  color: var(--lf-ink);
}

@media (max-width: 480px) {
  .nav-link {
    display: none;
  }
}
</style>
