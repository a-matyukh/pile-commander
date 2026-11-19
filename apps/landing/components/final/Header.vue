<!-- Not sticky: the page gives the whole screen to the content. One row on
     a wide screen: the app's icon on the desktop (as far from the OS bar as
     from the page's edge), the tagline over the window, the ways in
     (download and the browser). Narrower, the tagline takes a row of its own. A phone cannot run the desktop
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

      <h1 class="lf-h1 tag">File manager. <span class="em">Creative space.</span></h1>

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
  display: grid;
  grid-template-areas:
    "brand nav"
    "tag tag";
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 0 1rem;
  /* The icon's top is a gutter under the OS bar (the name's box adds 0.25rem) */
  padding-top: calc(var(--lf-gutter) - 0.25rem);
}

/* A desktop icon: the icon, the name under it */
.brand {
  grid-area: brand;
  justify-self: start;
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

/* Rounded like an app icon on the desktop */
.brand-icon {
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 22.5%;
  filter: drop-shadow(0 2px 4px rgb(0 0 0 / 0.18));
}

.brand-name {
  border-radius: 4px;
  padding: 0 0.25rem;
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.3;
  text-align: center;
  white-space: nowrap;
}

.brand:hover .brand-name {
  background: rgb(0 0 0 / 0.08);
}

/* Buttons: their middle on the icon's (2rem down the name's box) */
.nav {
  grid-area: nav;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.625rem;
  margin-top: 0.875rem;
}

.tag {
  grid-area: tag;
  margin-top: 1rem;
  font-size: clamp(2rem, 7vw, 2.75rem);
  text-align: center;
}

.em {
  color: var(--lf-accent);
}

/* Wide: one row; the tagline starts where the window does, over it */
@media (min-width: 1100px) {
  .bar-in {
    height: calc(var(--lf-header-h) - var(--lf-os-h));
    box-sizing: border-box;
    grid-template-areas: "brand tag nav";
    grid-template-columns: calc(var(--lf-nav) + var(--lf-nav-gap) - 1.5rem) minmax(0, 1fr) auto;
    gap: 0 1.5rem;
  }

  .tag {
    margin-top: calc(2rem - var(--lf-tag-size) * 0.51);
    font-size: var(--lf-tag-size);
    text-align: left;
    white-space: nowrap;
  }
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

/* The tagline needs the room: the repository keeps its icon */
@media (max-width: 1400px) {
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
