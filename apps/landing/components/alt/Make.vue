<!-- Four folders from the demo's Use cases, as they look in the app. The
     pictures in public/landing-alt/ are shots of the web demo (piles/); each
     card opens the live folder. The folder must not be named public/alt/: it
     would share the page's address, and the server then redirects /alt. -->
<script setup lang="ts">
const { demoUrl } = useAppLinks();

const cases = [
  {
    name: "Moodboard",
    image: "/landing-alt/moodboard.jpg",
    body: "Pictures at the size and in the place you give them, with the palette and the notes beside them.",
  },
  {
    name: "Trip planner",
    image: "/landing-alt/trip-planner.jpg",
    body: "Days as folders joined by arrows, a packing list with checkboxes and a budget table.",
  },
  {
    name: "Roadmap",
    image: "/landing-alt/roadmap.jpg",
    body: "Quarters, milestones and a folder for every feature, coloured by where it stands.",
  },
  {
    name: "Study",
    image: "/landing-alt/study.jpg",
    body: "A mind map, flashcards as slides and the lectures folder, all on one board.",
  },
];

const casesUrl = `${demoUrl}/${encodeURIComponent("Use cases")}`;
const external = { target: "_blank", rel: "noopener noreferrer" };
</script>

<template>
  <AltSection
    label="Make"
    shape="circle"
    title="Then make something of it."
    lede="A tidy folder is a place to work in. These four are ordinary folders from the demo: open any of them in the browser and move things around."
    wash
  >
    <ul class="cases">
      <li v-for="(item, i) in cases" :key="item.name">
        <!-- Named by its title and described by its line, so a screen reader
             does not read the card as one run of words -->
        <a
          :href="`${casesUrl}/${encodeURIComponent(item.name)}`"
          v-bind="external"
          class="case"
          :aria-labelledby="`alt-case-${i}`"
          :aria-describedby="`alt-case-${i}-body`"
        >
          <span class="alt-frame shot">
            <img :src="item.image" alt="" width="1400" height="1032" loading="lazy">
          </span>
          <span class="case-text">
            <span :id="`alt-case-${i}`" class="alt-h3 case-name">{{ item.name }}</span>
            <span :id="`alt-case-${i}-body`" class="case-body">{{ item.body }}</span>
            <span class="case-open">
              Open it in the browser
              <UIcon name="i-lucide-arrow-up-right" class="size-4" />
            </span>
          </span>
        </a>
      </li>
    </ul>

    <p class="more">
      <a :href="casesUrl" v-bind="external" class="alt-link">
        See the rest of the use cases in the demo
        <UIcon name="i-lucide-arrow-up-right" class="size-4 align-[-0.15em]" />
      </a>
    </p>
  </AltSection>
</template>

<style scoped>
.cases {
  display: grid;
  gap: 2.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

@media (min-width: 768px) {
  .cases {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 3.5rem 2.5rem;
  }
}

.case {
  display: block;
  color: inherit;
  text-decoration: none;
}

.shot {
  display: block;
  aspect-ratio: 1400 / 1032;
  transition: translate 0.25s ease;
}

.shot img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

@media (prefers-reduced-motion: no-preference) {
  .case:hover .shot {
    translate: 0 -4px;
  }
}

.case-text {
  display: grid;
  gap: 0.4rem;
  margin-top: 1.25rem;
}

.case-name {
  display: block;
}

.case-body {
  max-width: 34rem;
  font-size: 1rem;
  line-height: 1.55;
}

.case-open {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-top: 0.25rem;
  color: var(--alt-link);
  font-size: 0.9375rem;
  font-weight: 500;
}

.case:hover .case-open {
  text-decoration: underline;
  text-underline-offset: 0.2em;
}

.more {
  margin: clamp(2rem, 4vw, 3rem) 0 0;
}
</style>
