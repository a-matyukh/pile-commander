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
      <!-- the model the scene loads: a plant in a clay pot, standing on the table -->
      <div class="plant">
        <span class="leaf leaf-1" />
        <span class="leaf leaf-2" />
        <span class="leaf leaf-3" />
        <span class="leaf leaf-4" />
        <span class="leaf leaf-5" />
        <span class="pot" />
        <span class="plant-shadow" />
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

/* the app's table: white, a fine neutral grid, a light edge */
.space-floor {
  position: absolute;
  inset: 0;
  border: 1px solid #e7e5df;
  border-radius: 1.1rem;
  background-color: #fff;
  background-image:
    linear-gradient(to right, rgb(15 23 42 / 0.07) 1px, transparent 1px),
    linear-gradient(to bottom, rgb(15 23 42 / 0.07) 1px, transparent 1px);
  background-size: 5% 8.7%;
  box-shadow:
    0 0.35rem 0 #e7e5df,
    0 1.6rem 2.2rem rgb(15 23 42 / 0.1);
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

.plant {
  position: absolute;
  top: 17%;
  right: 15%;
  width: 4.4em;
  height: 5.4em;
  font-size: clamp(12px, 2.2cqw, 24px);
}

.pot {
  position: absolute;
  bottom: 0;
  left: 26%;
  width: 48%;
  height: 34%;
  background: linear-gradient(to right, #c04e28, #d85a30 40%, #b44822);
  clip-path: polygon(0 0, 100% 0, 88% 100%, 12% 100%);
}

.pot::before {
  content: "";
  position: absolute;
  inset: 0 -4% auto;
  height: 16%;
  background: #c04e28;
}

.leaf {
  position: absolute;
  bottom: 28%;
  left: 50%;
  width: 1.05em;
  height: 2.9em;
  margin-left: -0.525em;
  border-radius: 50%;
  background: linear-gradient(to right, #178a64, #2fb37f);
  transform-origin: 50% 100%;
}

.leaf-1 { transform: rotate(-52deg) scale(0.86); }
.leaf-2 { transform: rotate(-24deg); background: #1d9e75; }
.leaf-3 { transform: rotate(4deg) scale(1.08); }
.leaf-4 { transform: rotate(30deg); background: #178a64; }
.leaf-5 { transform: rotate(56deg) scale(0.84); background: #2fb37f; }

.plant-shadow {
  position: absolute;
  bottom: -0.35em;
  left: 12%;
  width: 76%;
  height: 0.8em;
  border-radius: 50%;
  background: radial-gradient(rgb(15 23 42 / 0.22), transparent 70%);
  z-index: -1;
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
