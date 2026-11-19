<!-- The blocks 1–6 as a plain list, like a repository's feature list: the
     number (the window's marker), a name and a short line. On a wide screen it
     is pinned on the left, level with the top of the intro's window, and a click glides to the
     block; the pointer on a line lights its place in the window (lf-active).
     The block on screen is marked. Narrower, the intro shows the same list
     under the window instead (Legend.vue). -->
<script setup lang="ts">
import { finalIdeas } from "~/utils/finalIdeas";

const active = useState<number | null>("lf-active", () => null);
/** The block on screen, if any */
const current = ref<string | null>(null);

onMounted(() => {
  const sections = finalIdeas
    .map(i => document.getElementById(i.id))
    .filter((el): el is HTMLElement => !!el);
  if (!sections.length) return;
  const seen = new Map<string, boolean>();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) seen.set(e.target.id, e.isIntersecting);
    current.value = finalIdeas.find(i => seen.get(i.id))?.id ?? null;
  }, { rootMargin: "-40% 0px -55% 0px" });
  sections.forEach(s => io.observe(s));
  onBeforeUnmount(() => io.disconnect());
});
</script>

<template>
  <nav class="nav" aria-label="What Pile Commander does">
    <ol class="list">
      <li v-for="idea in finalIdeas" :key="idea.n">
        <a
          :href="`#${idea.id}`"
          class="it"
          :class="{ on: active === idea.n }"
          :aria-current="current === idea.id ? 'true' : undefined"
          @mouseenter="active = idea.n"
          @mouseleave="active = null"
          @focus="active = idea.n"
          @blur="active = null"
        >
          <span class="lf-marker" aria-hidden="true">{{ idea.n }}</span>
          <span class="tx">
            <span class="ti">{{ idea.title }}</span>
            <span class="hi">{{ idea.hint }}</span>
          </span>
        </a>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.nav {
  display: none;
}

@media (min-width: 1100px) {
  .nav {
    position: fixed;
    /* Level with the top of the intro's window (Intro.vue), close under
       the desktop icon. It stays there while the page scrolls */
    top: calc(var(--lf-header-h) + var(--lf-intro-top));
    /* The header's left edge: the wrap is centred */
    left: max(var(--lf-gutter), calc((100vw - var(--lf-wrap) - var(--lf-nav) - var(--lf-nav-gap)) / 2 + var(--lf-gutter)));
    z-index: 2;
    display: block;
    width: var(--lf-nav);
  }
}

.list {
  display: grid;
  gap: 0.125rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.it {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  border-radius: 8px;
  margin-left: -0.5rem;
  padding: 0.5rem;
  color: var(--lf-ink-2);
  text-decoration: none;
  transition: background-color 0.15s ease;
}

.it:hover,
.it.on {
  background: rgb(36 83 255 / 0.08);
}

.it[aria-current="true"] .ti {
  color: var(--lf-accent);
}

.tx {
  display: grid;
  gap: 0.125rem;
}

.ti {
  color: var(--lf-ink);
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.3;
}

.hi {
  color: var(--lf-ink-3);
  font-size: 0.8125rem;
  line-height: 1.4;
}
</style>
