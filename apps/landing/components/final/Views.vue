<!-- Block 1, nine views. The same window and folder as the intro, its view
     menu open as the app draws it. The views go by on their own while the
     block is on screen; a click in the menu picks one, as in the app, and
     the visitor drives from then on. Pause stops the tour (an auto-changing
     picture needs a way to stop it). -->
<script setup lang="ts">
import { FOLDER_VIEWS, homeBookmarks, homeTree, viewMeta, type ViewId } from "~/utils/finalFolder";
import type { Crumb } from "./AppWindow.vue";

const crumbs: Crumb[] = [{ glyph: "home" }, { name: "Pictures" }];

const view = ref<ViewId>("board");
const meta = computed(() => viewMeta(view.value));
/** Board and Canvas have layers: their header has one more button */
const spatial = computed(() => view.value === "board" || view.value === "canvas");

/** The tour runs until the visitor picks a view or pauses it */
const playing = ref(true);

function pick(id: ViewId) {
  playing.value = false;
  view.value = id;
}

function next() {
  const i = FOLDER_VIEWS.findIndex(v => v.id === view.value);
  view.value = FOLDER_VIEWS[(i + 1) % FOLDER_VIEWS.length]!.id;
}

function toggle() {
  playing.value = !playing.value;
  if (playing.value) next();
}

const root = useTemplateRef<HTMLElement>("root");

onMounted(() => {
  let visible = false;
  const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; }, { threshold: 0.35 });
  if (root.value) io.observe(root.value);
  const timer = window.setInterval(() => {
    if (visible && playing.value) next();
  }, 3200);
  onBeforeUnmount(() => {
    io.disconnect();
    window.clearInterval(timer);
  });
});
</script>

<template>
  <section id="views" ref="root" class="sec" aria-labelledby="views-title">
    <div class="lf-wrap">
      <header class="head">
        <span class="lf-marker" aria-hidden="true">1</span>
        <h2 id="views-title" class="title">Nine views</h2>
        <p class="lede">One folder, nine ways to see it. Each folder keeps its own view, and switching never moves a file.</p>
      </header>

      <FinalAppWindow
        class="shot"
        :crumbs="crumbs"
        title="Harbor moodboard"
        :bookmarks="homeBookmarks(view)"
        :tree="homeTree(view)"
        :view-icon="meta.icon"
        :view-color="meta.color ?? '#5f5e5a'"
        :spatial="spatial"
        :markers="[1]"
        view-open
        interactive
      >
        <FinalFolderViews :view="view" />
        <template #over>
          <FinalViewMenu
            class="menu"
            :style="{ right: `${1.25 + (spatial ? 6 : 5) * 2.6}em` }"
            :current="view"
            @pick="pick"
          />
        </template>
      </FinalAppWindow>

      <div class="foot">
        <p class="caption" aria-live="polite">
          <span class="cname">{{ meta.label }}.</span> {{ meta.caption }}
        </p>
        <button type="button" class="play" :aria-pressed="playing" @click="toggle">
          <UIcon :name="playing ? 'i-tabler-player-pause' : 'i-tabler-player-play'" class="pi" />
          {{ playing ? "Pause" : "Play" }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sec {
  padding: var(--lf-section) 0 0;
  scroll-margin-top: 1rem;
}

.head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.25rem 0.75rem;
  margin-bottom: 1.75rem;
}

.title {
  margin: 0;
  font-size: clamp(1.75rem, 2.6vw, 2.25rem);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.15;
}

.lede {
  grid-column: 2;
  margin: 0;
  max-width: 40rem;
  color: var(--lf-ink-2);
  font-size: 1.0625rem;
  line-height: 1.5;
}

/* The menu under the view button, its right edge on the button's */
.menu {
  position: absolute;
  top: 3.25em;
  z-index: 3;
}

.foot {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 1rem;
}

.caption {
  margin: 0;
  color: var(--lf-ink-2);
  font-size: 0.9375rem;
  line-height: 1.5;
}

.cname {
  color: var(--lf-ink);
  font-weight: 600;
}

.play {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.375rem;
  border: 1px solid var(--lf-line-strong);
  border-radius: 999px;
  background: var(--lf-surface);
  padding: 0.375rem 0.875rem;
  color: var(--lf-ink);
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
}

.play:hover {
  border-color: rgb(0 0 0 / 0.3);
}

.pi {
  width: 1rem;
  height: 1rem;
}
</style>
