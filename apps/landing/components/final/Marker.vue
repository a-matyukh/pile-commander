<!-- A block's number pinned on the app window, above the place in the app it
     talks about. A link to its block; under the pointer it lights its place
     and its line in the legend (the shared state lf-active). The legend under
     the window is the keyboard's way in, so the markers stay out of the tab
     order. -->
<script setup lang="ts">
import { finalIdeas } from "~/utils/finalIdeas";

const props = defineProps<{ n: number }>();

const active = useState<number | null>("lf-active", () => null);
const idea = computed(() => finalIdeas.find(i => i.n === props.n));
</script>

<template>
  <a
    :href="`#${idea?.id}`"
    class="lf-marker mk"
    :class="{ on: active === n }"
    :style="{ '--i': n }"
    tabindex="-1"
    aria-hidden="true"
    @mouseenter="active = n"
    @mouseleave="active = null"
  >{{ n }}</a>
</template>

<style scoped>
/* Above its place, at the page's own size whatever the window's scale */
.mk {
  position: absolute;
  bottom: calc(100% + 0.35rem);
  left: 50%;
  z-index: 2;
  width: 1.375rem;
  height: 1.375rem;
  font-size: 0.6875rem;
  translate: -50% 0;
  box-shadow: 0 0 0 2px #fff;
  transition: scale 0.15s ease;
}

.mk.on {
  scale: 1.2;
}

/* The pins come in one by one */
@media (prefers-reduced-motion: no-preference) {
  .mk {
    animation: mk-in 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.35) both;
    animation-delay: calc(0.35s + var(--i) * 0.09s);
  }
}

@keyframes mk-in {
  from {
    opacity: 0;
    scale: 0.3;
  }
}
</style>
