<!-- A small orbiting cube: stands in for a .glb/.gltf shown with orbit controls.
     Sized in em, so the parent's font-size scales it. -->
<template>
  <div class="home-cube-scene" aria-hidden="true">
    <div class="home-cube">
      <span class="home-face bg-sky-300/90" style="transform: rotateY(0deg) translateZ(1.5em)" />
      <span class="home-face bg-sky-500/90" style="transform: rotateY(90deg) translateZ(1.5em)" />
      <span class="home-face bg-sky-300/90" style="transform: rotateY(180deg) translateZ(1.5em)" />
      <span class="home-face bg-sky-500/90" style="transform: rotateY(-90deg) translateZ(1.5em)" />
      <span class="home-face bg-sky-200/95" style="transform: rotateX(90deg) translateZ(1.5em)" />
      <span class="home-face bg-sky-700/90" style="transform: rotateX(-90deg) translateZ(1.5em)" />
    </div>
    <span class="home-shadow" />
  </div>
</template>

<style scoped>
.home-cube-scene {
  position: relative;
  width: 3em;
  height: 4.2em;
  perspective: 16em;
}

.home-cube {
  position: absolute;
  inset: 0 0 auto;
  height: 3em;
  transform-style: preserve-3d;
  transform: rotateX(-24deg) rotateY(35deg);
}

.home-face {
  position: absolute;
  inset: 0;
  border: 1px solid rgb(255 255 255 / 0.6);
  border-radius: 0.2em;
}

.home-shadow {
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 3.2em;
  height: 0.6em;
  translate: -50% 0;
  border-radius: 50%;
  background: radial-gradient(rgb(15 23 42 / 0.18), transparent 70%);
}

@media (prefers-reduced-motion: no-preference) {
  .home-cube {
    animation: home-orbit 9s linear infinite;
  }
}

@keyframes home-orbit {
  from {
    transform: rotateX(-24deg) rotateY(35deg);
  }
  to {
    transform: rotateX(-24deg) rotateY(395deg);
  }
}
</style>
