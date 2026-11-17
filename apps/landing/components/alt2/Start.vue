<!-- The end of the page: the one action again, on a panel in the page's
     colours turned around. -->
<script setup lang="ts">
const { demoUrl } = useAppLinks();
const { os, downloadLabel } = useDownloadCta();

const external = { target: "_blank", rel: "noopener noreferrer" };
</script>

<template>
  <section id="start" class="start" aria-labelledby="start-title">
    <div class="a2-wrap">
      <div class="panel">
        <h2 id="start-title" class="a2-h2">Try the next generation.</h2>
        <p class="a2-lede">
          Everything on your computer is free and needs no account. Open a
          folder you already have, or look around the demo first.
        </p>

        <div v-if="os === 'mobile'" class="actions">
          <a :href="demoUrl" v-bind="external" class="a2-btn a2-btn-inverse">
            Try it in the browser
          </a>
          <NuxtLink to="/download" class="a2-btn a2-btn-inverse-ghost">
            Get the desktop app
          </NuxtLink>
        </div>
        <div v-else class="actions">
          <NuxtLink to="/download" class="a2-btn a2-btn-inverse">
            <UIcon name="i-lucide-download" class="size-[1.1em]" />
            {{ downloadLabel }}
          </NuxtLink>
          <a :href="demoUrl" v-bind="external" class="a2-btn a2-btn-inverse-ghost">
            Try it in the browser
          </a>
        </div>

        <p class="platforms">macOS (Apple silicon and Intel) · Windows · Linux · any modern browser</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* The section above already ends with its own padding */
.start {
  padding: 0 0 var(--a2-section);
}

.panel {
  border-radius: var(--a2-radius-l);
  background: var(--a2-panel-bg);
  padding: clamp(2rem, 6vw, 5rem);
  color: var(--a2-panel-fg-2);
}

.a2-h2 {
  color: var(--a2-panel-fg);
}

.a2-lede {
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
  font-size: 0.875rem;
  line-height: 1.5;
  opacity: 0.85;
}

.panel :is(a, button):focus-visible {
  outline-color: var(--a2-panel-fg);
}
</style>
