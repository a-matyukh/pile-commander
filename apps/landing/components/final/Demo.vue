<!-- Before the closing panel: an invitation to the web demo. It opens in the
     browser with no account, and nothing a visitor does there is saved, so
     they can play with it freely. The folders come from piles/ (the demo
     pack, `bun run demo:pack`): Use cases (19 folders) and Features. Each
     use case opens straight in its folder (/demo/<folders>, publicRoute.ts in
     apps/client). The pictures are shots of the web demo, the same ones as
     /old's TryDemos.vue and /alt's Make.vue. -->
<script setup lang="ts">
const { demoUrl } = useAppLinks();
const external = { target: "_blank", rel: "noopener noreferrer" };

const folderUrl = (...names: string[]) => `${demoUrl}/${names.map(encodeURIComponent).join("/")}`;

/** The use cases, as the folders are named in piles/Use cases */
const cases = [
  "Moodboard", "Trip planner", "Roadmap", "Study", "Kanban", "Recipes", "Portfolio",
  "Wedding", "Renovation", "Family trip", "Habit tracker", "Brainstorm", "Startup launch",
  "System design", "UX prototype", "Interactive article", "Animation storyboard",
  "Screenplay", "Poems",
];

const shots = [
  { name: "Moodboard", image: "/landing-alt/moodboard.jpg" },
  { name: "Trip planner", image: "/landing-alt/trip-planner.jpg" },
  { name: "Roadmap", image: "/landing-alt/roadmap.jpg" },
  { name: "Study", image: "/landing-alt/study.jpg" },
];
</script>

<template>
  <section id="demo" class="sec" aria-labelledby="demo-title">
    <div class="lf-wrap">
      <header class="head">
        <h2 id="demo-title" class="title">Play with the demo</h2>
        <p class="lede">
          It opens right in your browser: nothing to install, no account. Move,
          draw, rename, delete — nothing is saved, so play as much as you like.
        </p>
      </header>

      <div class="cards">
        <!-- The use cases: four of them as pictures, all of them by name -->
        <article class="card cases">
          <div class="shots">
            <a
              v-for="s in shots"
              :key="s.name"
              :href="folderUrl('Use cases', s.name)"
              v-bind="external"
              class="shot"
            >
              <img :src="s.image" :alt="`${s.name} in the demo`" loading="lazy">
              <span class="sname">{{ s.name }}</span>
            </a>
          </div>
          <div class="body">
            <h3 class="ct"><span class="num">{{ cases.length }}</span> use cases</h3>
            <p class="cx">From a moodboard and a trip planner to a wedding, a screenplay and a system design. Each one is an ordinary folder, set up the way people really work.</p>
            <ul class="chips" aria-label="The use cases">
              <li v-for="c in cases" :key="c">
                <a :href="folderUrl('Use cases', c)" v-bind="external" class="chip">{{ c }}</a>
              </li>
            </ul>
            <a :href="folderUrl('Use cases')" v-bind="external" class="lf-btn lf-btn-primary go">
              Open the use cases
              <UIcon name="i-tabler-arrow-up-right" class="size-[1.1em]" />
            </a>
          </div>
        </article>

        <!-- Features: one folder per view, file type and tool -->
        <article class="card feats">
          <a :href="folderUrl('Features')" v-bind="external" class="shot wide">
            <img src="/features-screenshot.png" alt="The Features folder in the demo" loading="lazy">
          </a>
          <div class="body">
            <h3 class="ct">Features</h3>
            <p class="cx">A tour of every view, file type and canvas tool: notes, media, shapes and arrows, layers, covers and backgrounds, one folder each.</p>
            <a :href="folderUrl('Features')" v-bind="external" class="lf-btn lf-btn-secondary go">
              Open the features
              <UIcon name="i-tabler-arrow-up-right" class="size-[1.1em]" />
            </a>
          </div>
        </article>
      </div>

      <!-- For the desktop app: the same folders as files to keep -->
      <p class="keep">
        <UIcon name="i-tabler-file-zip" class="ki" />
        <span>
          Want to keep one? Download it as a <code>.pile</code> and open it in the desktop app:
          <a href="/demos/use-cases.pile" download class="lf-link">Use cases</a>,
          <a href="/demos/features.pile" download class="lf-link">Features</a>.
        </span>
      </p>
    </div>
  </section>
</template>

<style scoped>
/* Block 8 above already leaves a section's room */
.sec {
  padding: 0 0 var(--lf-section);
  scroll-margin-top: 1rem;
}

.head {
  max-width: 46rem;
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
  margin: 0.625rem 0 0;
  color: var(--lf-ink-2);
  font-size: 1.0625rem;
  line-height: 1.5;
}

.cards {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 1.5rem;
}

@media (max-width: 900px) {
  .cards {
    grid-template-columns: minmax(0, 1fr);
  }
}

.card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--lf-line-strong);
  border-radius: 12px;
  background: var(--lf-surface);
}

/* Four use cases in a 2 × 2, each a way into its folder */
.shots {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  padding: 0.5rem 0.5rem 0;
}

.shot {
  position: relative;
  display: block;
  overflow: hidden;
  border: 1px solid var(--lf-line);
  border-radius: 8px;
  background: var(--lf-bg);
}

.shot img {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  object-position: top left;
  transition: transform 0.4s ease;
}

.shot:hover img {
  transform: scale(1.03);
}

.shot.wide {
  margin: 0.5rem 0.5rem 0;
}

.shot.wide img {
  aspect-ratio: 16 / 9.5;
}

/* The folder's name on its picture, as a small label */
.sname {
  position: absolute;
  bottom: 0.4rem;
  left: 0.4rem;
  border-radius: 6px;
  background: rgb(255 255 255 / 0.92);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
  padding: 0.15rem 0.5rem;
  color: var(--lf-ink);
  font-size: 0.8125rem;
  font-weight: 600;
}

.body {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 1.25rem 1.5rem 1.5rem;
}

.ct {
  margin: 0;
  font-size: 1.3rem;
  font-weight: 700;
  letter-spacing: -0.015em;
}

.num {
  color: var(--lf-accent);
}

.cx {
  margin: 0;
  color: var(--lf-ink-2);
  line-height: 1.5;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0.25rem 0 0;
  padding: 0;
  list-style: none;
}

.chip {
  display: inline-block;
  border: 1px solid var(--lf-line);
  border-radius: 99em;
  background: var(--lf-bg);
  padding: 0.2rem 0.65rem;
  color: var(--lf-ink-2);
  font-size: 0.8125rem;
  text-decoration: none;
  transition: border-color 0.15s ease, color 0.15s ease, background-color 0.15s ease;
}

.chip:hover {
  border-color: rgb(36 83 255 / 0.35);
  background: var(--lf-surface);
  color: var(--lf-accent);
}

.go {
  margin-top: auto;
}

.cases .go {
  margin-top: 0.5rem;
}

.keep {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  margin: 1.5rem 0 0;
  color: var(--lf-ink-2);
  font-size: 0.9375rem;
  line-height: 1.5;
}

.keep code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
}

.ki {
  width: 1.15rem;
  height: 1.15rem;
  flex: none;
  margin-top: 0.15rem;
  color: var(--lf-ink-3);
}
</style>
