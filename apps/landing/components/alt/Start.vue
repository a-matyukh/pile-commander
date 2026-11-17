<!-- The end of the page: the one action again, and the icon's five shapes
     standing in a row. The heap from the hero, in order. -->
<script setup lang="ts">
const { demoUrl } = useAppLinks();
const { os } = useVisitorPlatform();

const osNames: Record<string, string> = { mac: "macOS", windows: "Windows", linux: "Linux" };
const downloadLabel = computed(() => {
  const name = osNames[os.value];
  return name ? `Download for ${name}` : "Download desktop app";
});

const shapes = ["line", "rect", "square", "circle", "arc"] as const;
const external = { target: "_blank", rel: "noopener noreferrer" };
</script>

<template>
  <section class="start">
    <div class="alt-wrap">
      <div class="panel">
        <div class="row" aria-hidden="true">
          <AltShape v-for="shape in shapes" :key="shape" :kind="shape" tidy />
        </div>

        <h2 class="alt-h2">Start with a folder.</h2>
        <p class="alt-lede">
          Everything on your computer is free and needs no account. Open a
          folder you already have, or look around the demo first.
        </p>

        <div v-if="os === 'mobile'" class="actions">
          <a :href="demoUrl" v-bind="external" class="alt-btn alt-btn-light">
            Try it in the browser
          </a>
          <NuxtLink to="/download" class="alt-btn alt-btn-ghost">
            Get the desktop app
          </NuxtLink>
        </div>
        <div v-else class="actions">
          <NuxtLink to="/download" class="alt-btn alt-btn-light">
            <UIcon name="i-lucide-download" class="size-[1.1em]" />
            {{ downloadLabel }}
          </NuxtLink>
          <a :href="demoUrl" v-bind="external" class="alt-btn alt-btn-ghost">
            Try it in the browser
          </a>
        </div>

        <p class="platforms">macOS (Apple silicon and Intel) · Windows · Linux · any modern browser</p>

        <p class="tour">
          This page is the short version.
          <NuxtLink to="/" class="tour-link">
            See everything it can do
            <UIcon name="i-lucide-arrow-right" class="size-4 align-[-0.15em]" />
          </NuxtLink>
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.start {
  padding: 0 0 var(--alt-section);
}

.panel {
  border-radius: var(--alt-radius-l);
  background: var(--alt-ink);
  padding: clamp(2rem, 6vw, 5rem);
  color: rgb(255 255 255 / 0.78);
}

/* Upright, evenly spaced, on one line */
.row {
  display: flex;
  align-items: center;
  gap: clamp(0.75rem, 2.4vw, 1.75rem);
  margin-bottom: clamp(2rem, 4vw, 3rem);
  font-size: clamp(2.25rem, 6vw, 4rem);
}

.alt-h2 {
  color: #fff;
}

.alt-lede {
  margin-top: 1.25rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin: 2rem 0 1.25rem;
}

.platforms {
  margin: 0;
  color: rgb(255 255 255 / 0.62);
  font-size: 0.875rem;
  line-height: 1.5;
}

.tour {
  margin: clamp(2rem, 4vw, 3rem) 0 0;
  border-top: 1px solid rgb(255 255 255 / 0.16);
  padding-top: 1.5rem;
  font-size: 1rem;
}

.tour-link {
  color: #fff;
  font-weight: 500;
  text-decoration: underline;
  text-decoration-color: rgb(255 255 255 / 0.4);
  text-underline-offset: 0.25em;
}

.tour-link:hover {
  text-decoration-color: #fff;
}

/* On the ink panel the focus ring is white */
.panel :is(a, button):focus-visible {
  outline-color: #fff;
}
</style>
