<!-- The end of the page: a white panel. The app icon's five shapes stand in
     a row (as on /alt), then calmly come together into the icon and part
     again: from a heap to something made. Then the name and the tagline,
     and the ways in with Pricing.
     The shapes are Shapes.vue. With reduced motion nothing moves on its own: a
     click on the shapes plays it once. -->
<script setup lang="ts">
const { demoUrl } = useAppLinks();
const { os, downloadLabel } = useDownloadCta();
const external = { target: "_blank", rel: "noopener noreferrer" };

const together = ref(false);
const root = useTemplateRef<HTMLElement>("root");

function play() {
  together.value = true;
  window.setTimeout(() => { together.value = false; }, 4200);
}

onMounted(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let visible = false;
  const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; }, { threshold: 0.4 });
  if (root.value) io.observe(root.value);
  // Row for a while, then the icon for a while, and again
  const timer = window.setInterval(() => {
    if (visible) together.value = !together.value;
  }, 3600);
  onBeforeUnmount(() => {
    io.disconnect();
    window.clearInterval(timer);
  });
});
</script>

<template>
  <section ref="root" class="sec" aria-labelledby="finale-title">
    <div class="lf-wrap">
      <div class="panel">
        <button type="button" class="art" :class="{ together }" aria-label="The app icon's shapes coming together" @click="play">
          <FinalShapes :together="together" />
        </button>

        <h2 id="finale-title" class="title">
          <span class="pc">Pile Commander.</span> File manager. <span class="em">Creative space.</span>
        </h2>

        <div class="actions">
          <a v-if="os === 'mobile'" :href="demoUrl" v-bind="external" class="lf-btn lf-btn-primary">Try in the browser</a>
          <template v-else>
            <NuxtLink to="/download" class="lf-btn lf-btn-primary">
              <UIcon name="i-lucide-download" class="size-[1.1em]" />
              {{ downloadLabel }}
            </NuxtLink>
            <a :href="demoUrl" v-bind="external" class="lf-btn lf-btn-secondary">Try in the browser</a>
          </template>
          <NuxtLink to="/pricing" class="lf-btn lf-btn-outline">Pricing</NuxtLink>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sec {
  padding: 0 0 var(--lf-section);
}

.panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(1.5rem, 3vw, 2.25rem);
  text-align: center;
  border: 1px solid var(--lf-line);
  border-radius: 24px;
  background: var(--lf-surface);
  padding: clamp(2rem, 5vw, 4rem);
}

/* The shapes: the row and the icon share one drawing */
.art {
  display: block;
  width: min(26rem, 100%);
  border: 0;
  background: none;
  padding: 0;
  cursor: pointer;
}

.title {
  margin: 0;
  font-size: clamp(1.75rem, 3.2vw, 2.75rem);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.1;
  text-wrap: balance;
}

.pc,
.em {
  color: var(--lf-accent);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.75rem;
}
</style>
