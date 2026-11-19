<!-- Not sticky: the page gives the whole screen to the content. It sits on
     the desktop's wallpaper. The ways in
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
      <!-- The logo is the app's icon on the desktop, its name under it -->
      <NuxtLink to="/final" class="brand" aria-label="Pile Commander">
        <img src="/app-icon.png" alt="" width="64" height="64" class="brand-icon">
        <span class="brand-name">Pile Commander</span>
      </NuxtLink>

      <nav class="nav" aria-label="Primary">
        <NuxtLink to="/pricing" class="nav-link">Pricing</NuxtLink>
        <a :href="githubUrl" v-bind="external" class="lf-btn lf-btn-sm lf-btn-outline repo" aria-label="Pile Commander on GitHub: a-matyukh/pile-commander">
          <UIcon name="i-tabler-brand-github" class="size-[1.15em]" />
          <span class="repo-name">a-matyukh/pile-commander</span>
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
  height: var(--lf-header-h);
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding-top: 0.875rem;
}

/* A desktop icon: the icon, the name under it */
.brand {
  display: flex;
  width: 6.25rem;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  /* The icon lines up with the page's edge; the name may reach past it */
  margin-left: calc(-1 * min(1.375rem, var(--lf-gutter) - 0.25rem));
  border-radius: 8px;
  padding: 0.25rem 0;
  color: var(--lf-ink);
  text-decoration: none;
}

.brand-icon {
  width: 3.5rem;
  height: 3.5rem;
  filter: drop-shadow(0 2px 4px rgb(0 0 0 / 0.18));
}

.brand-name {
  border-radius: 4px;
  padding: 0 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.3;
  text-align: center;
  text-shadow: 0 1px 2px rgb(255 255 255 / 0.6);
  white-space: nowrap;
}

.brand:hover .brand-name {
  background: rgb(0 0 0 / 0.08);
}

.nav {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  margin-top: 0.875rem;
}

.nav-link {
  display: inline-flex;
  margin-right: 0.5rem;
  color: var(--lf-ink-2);
  font-size: 0.9375rem;
  text-decoration: none;
}

.nav-link:hover {
  color: var(--lf-ink);
}

/* The repository's name, as GitHub writes it */
.repo-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8125rem;
  font-weight: 500;
}

@media (max-width: 1000px) {
  .repo-name {
    display: none;
  }

  .repo {
    padding: 0 0.625rem;
  }
}

@media (max-width: 720px) {
  .nav-link {
    display: none;
  }
}


</style>
