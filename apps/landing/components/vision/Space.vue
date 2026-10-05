<!-- The 3D-view card: the CSS poster renders on the server and stays as the
     fallback; on the client a three.js scene loads once the card nears the
     viewport and fades in over it. -->
<script setup lang="ts">
import type { SpaceScene } from "~/scene/space";

const root = ref<HTMLElement>();
const stage = ref<HTMLElement>();
const ready = ref(false);
const away = ref(false);
const hint = ref("");

let scene: SpaceScene | null = null;
let loading = false;
let visible = false;
let unmounted = false;
let observer: IntersectionObserver | undefined;

function sync() {
  if (!scene) return;
  if (visible && !document.hidden) scene.start();
  else scene.stop();
}

async function load() {
  if (loading || scene || !stage.value) return;
  loading = true;
  try {
    const { createSpaceScene } = await import("~/scene/space");
    if (unmounted || !stage.value) return;
    scene = createSpaceScene(stage.value, {
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      onAwayChange: (value) => (away.value = value),
      onHint: (text) => (hint.value = text),
      onReady: () => (ready.value = true),
    });
    sync();
  } catch (error) {
    // No WebGL (or the chunk failed): the poster stays.
    console.warn("[vision] 3D scene unavailable", error);
  }
}

function resetView() {
  scene?.resetView();
}

function onVisibilityChange() {
  sync();
}

onMounted(() => {
  observer = new IntersectionObserver(
    ([entry]) => {
      visible = !!entry?.isIntersecting;
      if (visible) load();
      sync();
    },
    { rootMargin: "200px" },
  );
  if (root.value) observer.observe(root.value);
  document.addEventListener("visibilitychange", onVisibilityChange);
});

onBeforeUnmount(() => {
  unmounted = true;
  observer?.disconnect();
  document.removeEventListener("visibilitychange", onVisibilityChange);
  scene?.dispose();
  scene = null;
});
</script>

<template>
  <div ref="root" class="relative h-full">
    <VisionSpacePoster class="poster" :class="{ 'poster-hidden': ready }" />

    <div
      ref="stage"
      class="stage absolute inset-0"
      :class="{ 'stage-ready': ready }"
    />

    <Transition name="hint">
      <p
        v-if="hint"
        class="pointer-events-none absolute bottom-3 left-1/2 m-0 -translate-x-1/2 rounded-full bg-slate-900/75 px-3 py-1.5 text-xs font-medium whitespace-nowrap text-white"
        role="status"
      >
        {{ hint }}
      </p>
    </Transition>

    <Transition name="hint">
      <UButton
        v-if="ready && away"
        class="absolute top-3 right-3"
        color="neutral"
        variant="outline"
        size="xs"
        icon="i-lucide-rotate-ccw"
        @click="resetView"
      >
        Reset view
      </UButton>
    </Transition>
  </div>
</template>

<style scoped>
.poster {
  transition:
    opacity 0.5s ease,
    visibility 0s linear 0s;
}

.poster-hidden {
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 0.5s ease,
    visibility 0s linear 0.5s;
}

.stage {
  opacity: 0;
  transition: opacity 0.5s ease;
  /* The gradient stays in CSS; the canvas is transparent. */
  background: radial-gradient(circle at 50% 38%, #fff 0%, hsl(205 70% 94%) 52%, hsl(214 42% 86%) 100%);
}

.stage-ready {
  opacity: 1;
}

.hint-enter-active,
.hint-leave-active {
  transition: opacity 0.2s ease;
}

.hint-enter-from,
.hint-leave-to {
  opacity: 0;
}
</style>
