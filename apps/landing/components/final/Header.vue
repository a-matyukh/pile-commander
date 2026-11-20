<!-- Not sticky: the page gives the whole screen to the content. One row on
     a wide screen: the app's icon on the desktop (as far from the OS bar as
     from the page's edge), the tagline beside it, the ways in (download and
     the browser). Narrower, the tagline takes a row of its own. A phone cannot run the desktop
     app, so there the browser comes first and the download leaves. -->
<script setup lang="ts">
/** The landing's own header: the tagline is the page's h1. On the other
 *  pages it is a line, and the page's title is the h1 */
const props = defineProps<{ main?: boolean }>();
const { demoUrl } = useAppLinks();
const { os, downloadLabel } = useDownloadCta();

const githubUrl = "https://github.com/a-matyukh/pile-commander";
const external = { target: "_blank", rel: "noopener noreferrer" };
</script>

<template>
  <header class="bar">
    <div class="lf-wrap bar-in">
      <!-- The logo is the app's icon on the desktop; the tagline names it -->
      <NuxtLink to="/" class="brand" :class="{ named: !props.main }" aria-label="Pile Commander">
        <img src="/app-icon.png" alt="" width="64" height="64" class="brand-icon">
        <!-- The footer's pages: the name alone beside the icon -->
        <span v-if="!props.main" class="bname" aria-hidden="true">Pile Commander</span>
      </NuxtLink>

      <!-- The landing: the name and what it is, in one rhythm -->
      <h1 v-if="props.main" class="lf-h1 tag"><span class="pc">Pile Commander.</span> File manager. <span class="em">Creative space.</span></h1>

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
  /* The icon's top is a gutter under the OS bar */
  padding-top: var(--lf-gutter);
}

.brand {
  grid-area: brand;
  justify-self: start;
  display: block;
  border-radius: 22.5%;
}

/* The footer's pages: the icon and the name, a link home */
.brand.named {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  border-radius: 0;
  color: var(--lf-accent);
  text-decoration: none;
}

.bname {
  font-size: clamp(1.25rem, 2vw, 1.625rem);
  font-weight: 700;
  letter-spacing: -0.025em;
  white-space: nowrap;
}

/* A phone: the buttons need the row, the icon names the app */
@media (max-width: 520px) {
  .bname {
    display: none;
  }
}

/* Rounded like an app icon on the desktop */
.brand-icon {
  display: block;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 22.5%;
  filter: drop-shadow(0 2px 4px rgb(0 0 0 / 0.18));
}

/* Buttons: their middle on the icon's */
.nav {
  grid-area: nav;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.625rem;
  margin-top: 0.625rem;
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

/* The name in the page's blue, as «Creative space.» */
.pc {
  color: var(--lf-accent);
}

/* Wide: one row, the tagline right beside the icon */
@media (min-width: 1100px) {
  .bar-in {
    height: calc(var(--lf-header-h) - var(--lf-os-h));
    box-sizing: border-box;
    grid-template-areas: "brand tag nav";
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 0 1.25rem;
  }

  .tag {
    margin-top: calc(1.75rem - var(--lf-tag-size) * 0.51);
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
@media (max-width: 1360px) {
  .repo-name {
    display: none;
  }

  .repo {
    padding: 0 0.625rem;
  }
}

/* Pricing is in the footer too: it gives way first */
@media (max-width: 1240px) {
  .nav-link {
    display: none;
  }
}


</style>
