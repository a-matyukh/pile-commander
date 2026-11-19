<!-- A neutral desktop wallpaper behind the first screen: soft light, no
     subject, so the window stays the picture. It fades into the page at the
     bottom. Drawn in CSS: no image to load. -->
<template>
  <div class="wall" aria-hidden="true" />
</template>

<style scoped>
.wall {
  position: absolute;
  inset: 0 0 auto;
  z-index: 0;
  height: calc(var(--lf-screen) + 4rem);
  background:
    radial-gradient(60% 70% at 18% 12%, rgb(255 255 255 / 0.55), transparent 70%),
    radial-gradient(55% 65% at 92% 8%, #c9d3df, transparent 70%),
    radial-gradient(70% 60% at 75% 85%, #cdd5de, transparent 70%),
    radial-gradient(55% 55% at 15% 90%, #e2dbd2, transparent 70%),
    linear-gradient(165deg, #e4e8ed, #d6dde5 55%, #e1ddd7);
  mask-image: linear-gradient(#000 calc(100% - 7rem), transparent);
  pointer-events: none;
}
</style>
