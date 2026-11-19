<!-- The desktop's wallpaper behind the first block (the OS bar, the header
     and the intro); the page below is the plain gray. A photo of a fjord by
     Alexey Topolyanskiy (Unsplash License, https://unsplash.com/photos/-oWyJoSqBRM).
     On a computer it fills the first screen (--lf-screen), as the intro
     does; narrower it ends a little under the window, measured after load,
     so the list under the window sits on the plain page. -->
<script setup lang="ts">
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
  <div class="wall" aria-hidden="true" :style="height ? { height } : undefined" />
</template>

<style scoped>
.wall {
  position: absolute;
  inset: 0 0 auto;
  z-index: 0;
  height: var(--lf-screen);
  background: #9fb7cc url("/landing-final/fjord.jpg") center 35% / cover no-repeat;
  pointer-events: none;
}
</style>
