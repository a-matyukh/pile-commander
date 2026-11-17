<script setup lang="ts">
const { demoUrl } = useAppLinks();
const { os, downloadLabel } = useDownloadCta();

const external = { target: "_blank", rel: "noopener noreferrer" };
</script>

<template>
  <section class="hero">
    <div class="a2-wrap">
      <!-- Two lines on a computer -->
      <h1 class="a2-h1">
        A file manager.<br>
        <em class="next">The next generation.</em>
      </h1>

      <div class="below">
        <!-- The six ideas in the page's order, one short sentence each -->
        <p class="a2-lede">
          Nine ways to see a folder. AI with your own model or agent. A cloud
          copy of any folder, to share, link or publish. On a computer, a
          tablet or a phone. And on your disk, files stay ordinary files.
        </p>

        <div class="cta">
          <!-- A phone cannot run the desktop app: the web demo leads there -->
          <div v-if="os === 'mobile'" class="actions">
            <a :href="demoUrl" v-bind="external" class="a2-btn a2-btn-primary">
              Try it in the browser
            </a>
            <NuxtLink to="/download" class="a2-btn a2-btn-secondary">
              Get the desktop app
            </NuxtLink>
          </div>
          <div v-else class="actions">
            <NuxtLink to="/download" class="a2-btn a2-btn-primary">
              <UIcon name="i-lucide-download" class="size-[1.1em]" />
              {{ downloadLabel }}
            </NuxtLink>
            <a :href="demoUrl" v-bind="external" class="a2-btn a2-btn-secondary">
              Try it in the browser
            </a>
          </div>

          <p class="a2-small">
            Free on your computer · No account · macOS, Windows, Linux and the web
          </p>
        </div>
      </div>

      <Alt2MapScene class="map" />
    </div>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  overflow-x: clip;
  padding: clamp(2.5rem, 5.5vw, 5rem) 0 var(--a2-section);
}

/* The blueprint's grid, fading out under the headline */
.hero::before {
  position: absolute;
  inset: 0 0 auto;
  height: 46rem;
  background-image:
    linear-gradient(var(--a2-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--a2-grid) 1px, transparent 1px);
  background-position: center top;
  background-size: 2rem 2rem;
  content: "";
  mask-image: linear-gradient(#000 30%, transparent);
  pointer-events: none;
}

.a2-wrap {
  position: relative;
}

.next {
  color: var(--a2-h1-em-color);
  font-style: var(--a2-h1-em-style);
}

.below {
  display: grid;
  gap: 1.75rem;
  margin-top: clamp(1.5rem, 3vw, 2.5rem);
}

@media (min-width: 1000px) {
  .below {
    grid-template-columns: minmax(0, 6fr) minmax(0, 5fr);
    gap: 4rem;
    align-items: end;
  }

  .cta {
    justify-self: end;
  }
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.map {
  margin-top: clamp(2.5rem, 5vw, 4rem);
}
</style>
