<template>
  <div class="space" aria-hidden="true">
    <div class="space-view">
      <div class="space-rig">
        <div class="space-floor" />

        <div class="obj obj-note">
          <span class="obj-shadow" />
          <div class="card card-note">
            <p class="card-title">Mood</p>
            <p class="card-copy">warm light<br />quiet room</p>
          </div>
        </div>

        <div class="obj obj-image">
          <span class="obj-shadow" />
          <div class="card card-image">
            <div class="thumb" />
            <p class="card-title">Harbor</p>
          </div>
        </div>

      </div>
      <div class="cube-float">
        <HomeCube />
      </div>
    </div>
  </div>
</template>

<style scoped>
.space {
  position: relative;
  height: 100%;
  overflow: hidden;
  background: radial-gradient(circle at 50% 38%, #fff 0%, hsl(205 70% 94%) 52%, hsl(214 42% 86%) 100%);
}

.space-view {
  position: absolute;
  inset: 0;
  perspective: 68cqw;
}

.space-rig {
  position: absolute;
  left: 14%;
  right: 12%;
  top: 24%;
  height: 52%;
  transform-style: preserve-3d;
  transform: rotateX(52deg) rotateZ(-14deg);
  transform-origin: 50% 78%;
}

.space-floor {
  position: absolute;
  inset: 0;
  border: 1px solid rgb(255 255 255 / 0.9);
  border-radius: 1.1rem;
  background-color: rgb(255 255 255 / 0.58);
  background-image:
    linear-gradient(to right, rgb(33 130 248 / 0.16) 1px, transparent 1px),
    linear-gradient(to bottom, rgb(33 130 248 / 0.16) 1px, transparent 1px);
  background-size: 12.5% 22%;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.85),
    0 1.4rem 2rem rgb(15 23 42 / 0.06);
}


.obj {
  position: absolute;
  transform-style: preserve-3d;
}

.obj-note {
  left: 6%;
  top: 8%;
  width: 30%;
  --z: 5cqw;
  --r: -2.5deg;
}

.obj-image {
  left: 38%;
  top: 30%;
  width: 28%;
  --z: 8.5cqw;
  --r: 1.5deg;
}

.obj-shadow {
  position: absolute;
  right: 8%;
  bottom: -14%;
  left: 8%;
  height: 22%;
  border-radius: 50%;
  background: radial-gradient(rgb(15 23 42 / 0.2), transparent 70%);
  transform: translateZ(2px);
}

.cube-float {
  position: absolute;
  top: 14%;
  right: 14%;
  font-size: clamp(16px, 2.8cqw, 28px);
}

.card {
  position: relative;
  border-radius: 0.75em;
  padding: 0.7em;
  font-size: clamp(10px, 1.45cqw, 15px);
  line-height: 1.35;
  box-shadow: 0 0.8em 1.4em rgb(15 23 42 / 0.12);
  transform: translateZ(var(--z)) rotateZ(var(--r));
}

.card-note {
  border: 1px solid rgb(252 211 77 / 0.95);
  background: #fff7d6;
  color: rgb(120 53 15 / 0.78);
}

.card-image {
  border: 1px solid var(--pc-gray-border);
  background: white;
  color: #334155;
}

.card-title {
  margin: 0;
  font-weight: 600;
}

.card-copy {
  margin: 0.28em 0 0;
}

.thumb {
  height: 4.6em;
  margin-bottom: 0.45em;
  border-radius: 0.45em;
  background:
    radial-gradient(circle at 78% 28%, #fde68a 0 0.55em, transparent 0.6em),
    linear-gradient(160deg, #bae6fd 0%, #7dd3fc 42%, #2182f8 100%);
}

@media (prefers-reduced-motion: no-preference) {
  .card {
    animation: space-rise 5.6s ease-in-out infinite;
  }

  .obj-image .card {
    animation-delay: -1.8s;
  }

  .obj-shadow {
    animation: space-shade 5.6s ease-in-out infinite;
  }

  .obj-image .obj-shadow {
    animation-delay: -1.8s;
  }

  .cube-float {
    animation: cube-bob 5.6s ease-in-out infinite;
  }
}

@keyframes space-rise {
  0%,
  100% {
    transform: translateZ(var(--z)) rotateZ(var(--r, 0deg));
  }

  50% {
    transform: translateZ(calc(var(--z) + 3.2cqw)) rotateZ(var(--r, 0deg));
  }
}

@keyframes cube-bob {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-0.7em);
  }
}

@keyframes space-shade {
  0%,
  100% {
    opacity: 0.95;
    transform: translateZ(2px) scale(1);
  }

  50% {
    opacity: 0.4;
    transform: translateZ(2px) scale(0.82);
  }
}
</style>
