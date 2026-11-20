<!-- The blocks 1–8 as a plain list, like a repository's feature list: the
     number (the window's marker), a name and a short line. On a wide screen it
     is pinned on the left: level with the top of the intro's window at first,
     then sticky near the top of the browser; a click glides to the
     block; the pointer on a line lights its place in the window (lf-active).
     The block on screen is marked. Narrower, the intro shows the same list
     under the window instead (Legend.vue). -->
<script setup lang="ts">
import { finalBlocks as finalIdeas } from "~/utils/finalIdeas";

const active = useState<number | null>("lf-active", () => null);
/** The block on screen, if any */
const current = ref<string | null>(null);

const nav = useTemplateRef<HTMLElement>("nav");
/** Where it stands on screen: under the intro window's top bar at first,
 *  then, as the page scrolls, it rises and sticks as far from the top of
 *  the browser as it is from its left edge */
const top = ref<string | null>(null);

onMounted(() => {
  const bar = document.querySelector<HTMLElement>(".intro .topbar");
  if (bar) {
    /** The line under the window's top bar, in page coordinates */
    let start = 0;
    const place = () => {
      const left = nav.value?.getBoundingClientRect().left ?? 0;
      top.value = `${Math.round(Math.max(left, start - window.scrollY))}px`;
    };
    const measure = () => {
      start = bar.getBoundingClientRect().bottom + window.scrollY;
      place();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", measure);
    onBeforeUnmount(() => {
      ro.disconnect();
      window.removeEventListener("scroll", place);
      window.removeEventListener("resize", measure);
    });
  }

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
  <nav ref="nav" class="nav" aria-label="What Pile Commander does" :style="top ? { '--nav-top': top } : undefined">
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
          <span class="lf-marker" aria-hidden="true">
            <UIcon v-if="'icon' in idea" :name="idea.icon" class="mi" />
            <template v-else>{{ idea.n }}</template>
          </span>
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

/* A low screen: names only, the second lines go */
@media (min-width: 1100px) and (max-height: 760px) {
  .hi {
    display: none;
  }
}

@media (min-width: 1100px) {
  .nav {
    position: fixed;
    /* Level with the line under the window's top bar (Intro.vue) at first,
       then sticky near the top as the page scrolls (measured in the script);
       before that, about there */
    top: var(--nav-top, calc(var(--lf-header-h) + var(--lf-intro-top) + 2.5rem));
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

/* The demo is not a numbered block: Play on its marker instead */
.mi {
  width: 0.75rem;
  height: 0.75rem;
}
</style>
