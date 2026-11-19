<!-- Not sticky: the page gives the whole screen to the content. The ways in
     live here: download and the browser. A phone cannot run the desktop
     app, so there the browser comes first and the download leaves. -->
<script setup lang="ts">
const { demoUrl } = useAppLinks();
const { os, downloadLabel } = useDownloadCta();

const githubUrl = "https://github.com/a-matyukh/pile-commander";
const external = { target: "_blank", rel: "noopener noreferrer" };
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
        <a :href="githubUrl" v-bind="external" class="nav-icon" aria-label="Pile Commander on GitHub">
          <UIcon name="i-tabler-brand-github" class="size-5" />
        </a>
        <a v-if="os === 'mobile'" :href="demoUrl" v-bind="external" class="lf-btn lf-btn-sm lf-btn-primary">
          Try in the browser
        </a>
        <template v-else>
          <a :href="demoUrl" v-bind="external" class="lf-btn lf-btn-sm lf-btn-secondary">Try in the browser</a>
          <NuxtLink to="/download" class="lf-btn lf-btn-sm lf-btn-primary">
            <UIcon name="i-lucide-download" class="size-[1.1em]" />
            {{ downloadLabel }}
          </NuxtLink>
        </template>
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
  gap: 0.625rem;
}

.nav-link,
.nav-icon {
  display: inline-flex;
  margin-right: 0.5rem;
  color: var(--lf-ink-2);
  font-size: 0.9375rem;
  text-decoration: none;
}

.nav-link:hover,
.nav-icon:hover {
  color: var(--lf-ink);
}

@media (max-width: 720px) {
  .nav-link {
    display: none;
  }
}

@media (max-width: 420px) {
  .brand-name {
    display: none;
  }
}
</style>
