<!-- The end of the page: a white panel. The app icon's five shapes stand in
     a row (as on /alt), then calmly come together into the icon and part
     again: from a heap to something made. Then the name and the tagline,
     and the ways in with Pricing.
     The shapes are drawn in the icon's own geometry (public/app-icon.png,
     1024 × 1024), each around its own centre, and two transforms per shape
     place it: upright in the row, or turned into its place in the icon. CSS
     moves between them. With reduced motion nothing moves on its own: a
     click on the shapes plays it once. -->
<script setup lang="ts">
const { demoUrl } = useAppLinks();
const { os, downloadLabel } = useDownloadCta();
const external = { target: "_blank", rel: "noopener noreferrer" };

/** In the row: upright, each about 400 units, evenly spaced. In the icon:
 *  its place (the icon sits in the middle of the 3000-wide drawing) */
const shapes = [
  { key: "line", row: "translate(300px, 550px) scale(0.36)", icon: "translate(1414px, 485px) rotate(-38.6deg)" },
  { key: "rect", row: "translate(900px, 550px) scale(1.45)", icon: "translate(1495px, 215px) rotate(-23.7deg)" },
  { key: "square", row: "translate(1500px, 550px) scale(1.4)", icon: "translate(1188px, 573px) rotate(-10.7deg)" },
  { key: "circle", row: "translate(2100px, 550px) scale(1.3)", icon: "translate(1780px, 473px)" },
  { key: "arc", row: "translate(2700px, 520px) scale(0.75)", icon: "translate(1457px, 763px) rotate(-21deg)" },
] as const;

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
          <svg viewBox="0 0 3000 1100" aria-hidden="true" focusable="false">
            <g v-for="s in shapes" :key="s.key" class="sh" :style="{ transform: together ? s.icon : s.row }">
              <line v-if="s.key === 'line'" x1="0" y1="-554" x2="0" y2="554" stroke="#2194f8" stroke-width="32" />
              <rect v-else-if="s.key === 'rect'" x="-138" y="-83.5" width="276" height="167" fill="#6044d9" />
              <rect v-else-if="s.key === 'square'" x="-128.5" y="-109.5" width="257" height="219" fill="#21f885" />
              <circle v-else-if="s.key === 'circle'" r="143" fill="#f82194" />
              <path v-else d="M -274 0 C -210 95, 150 110, 274 0" fill="none" stroke="#f5ef24" stroke-width="70" />
            </g>
          </svg>
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
  align-items: flex-start;
  gap: clamp(1.5rem, 3vw, 2.25rem);
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

.art svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.sh {
  transition: transform 1.6s cubic-bezier(0.45, 0, 0.25, 1);
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
  gap: 0.75rem;
}
</style>
