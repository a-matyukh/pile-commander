<!-- The desktop's wallpaper behind the first block (the OS bar, the header
     and the intro); the page below is the plain gray. An aerial photo of a reef
     with a boat by Ishan @seefromthesky, Vaavu Atoll, Maldives (Unsplash
     License, https://unsplash.com/photos/BMJWpck6eQA).
     On a computer it fills the first screen (--lf-screen), as the intro
     does; narrower it ends a little under the window, measured after load,
     so the list under the window sits on the plain page.
     Under review (?wall=photo|css, the switch at the bottom left): the photo,
     or its colours drawn in CSS — a lagoon from sand-white shallows to deep
     turquoise. The switch goes once one is chosen. -->
<script setup lang="ts">
const route = useRoute();
const kind = computed(() => (route.query.wall === "css" ? "css" : "photo"));
const options = [
  { value: "photo", name: "Photo" },
  { value: "css", name: "CSS" },
];

const height = ref<string | null>(null);

onMounted(() => {
  const shot = document.querySelector<HTMLElement>(".intro .shot");
  if (!shot) return;
  // A computer: the intro fills the first screen, and so does the wallpaper
  const fills = window.matchMedia("(min-width: 1100px) and (min-height: 560px)");
  const measure = () => {
    height.value = fills.matches
      ? null
      : `${Math.round(shot.getBoundingClientRect().bottom + window.scrollY + 24)}px`;
  };
  measure();
  const ro = new ResizeObserver(measure);
  ro.observe(document.documentElement);
  fills.addEventListener("change", measure);
  onBeforeUnmount(() => {
    ro.disconnect();
    fills.removeEventListener("change", measure);
  });
});
</script>

<template>
  <div class="wall" :class="kind" aria-hidden="true" :style="height ? { height } : undefined" />
  <nav class="rv" aria-label="Review options">
    <span class="t">Wallpaper</span>
    <NuxtLink
      v-for="o in options"
      :key="o.value"
      :to="{ query: { ...route.query, wall: o.value }, hash: route.hash }"
      class="opt"
      :aria-current="kind === o.value ? 'true' : undefined"
    >{{ o.name }}</NuxtLink>
  </nav>
</template>

<style scoped>
.wall {
  position: absolute;
  inset: 0 0 auto;
  z-index: 0;
  height: var(--lf-screen);
  pointer-events: none;
}

.wall.photo {
  background: #2fb6c4 url("/landing-final/reef.jpg") center / cover no-repeat;
}

/* The photo's colours: pale sand shallows at the top right, clear turquoise,
   deep teal at the bottom left. Light where the header's text sits */
.wall.css {
  background:
    radial-gradient(45% 55% at 88% 12%, rgb(236 246 238 / 0.95), transparent 70%),
    radial-gradient(40% 50% at 62% 30%, rgb(176 232 224 / 0.8), transparent 70%),
    radial-gradient(55% 60% at 12% 95%, #0b6f86, transparent 72%),
    radial-gradient(45% 50% at 85% 90%, #1d9fb3, transparent 70%),
    linear-gradient(160deg, #bfeae4 0%, #5cc9cc 38%, #22a3b7 68%, #12819a 100%);
}

/* Temporary: the review switch */
.rv {
  position: fixed;
  bottom: 1rem;
  left: 1rem;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 1.25rem;
  background: #111214;
  padding: 0.3rem;
  box-shadow: 0 10px 30px -10px rgb(0 0 0 / 0.5);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 0.8125rem;
  line-height: 1;
}

.t {
  padding: 0 0.4rem 0 0.6rem;
  color: rgb(255 255 255 / 0.55);
}

.opt {
  display: inline-flex;
  min-height: 2rem;
  align-items: center;
  border-radius: 999px;
  padding: 0 0.75rem;
  color: rgb(255 255 255 / 0.8);
  text-decoration: none;
}

.opt[aria-current="true"] {
  background: #fff;
  color: #111214;
}
</style>
