<!-- Files stay files, and where they live. The facts repeat the home page's
     FilesStayFiles and WhereItLives. -->
<script setup lang="ts">
const facts = [
  {
    title: "Ordinary files",
    body: "A note is a .txt or .md. A shape is an .svg. Any other app can still open them.",
  },
  {
    title: "Layout rides along",
    body: "Position, size, view and background are kept in the files' extended attributes. Nothing to import or export.",
  },
  {
    title: "Watches the disk",
    body: "Rename or add something in Finder or Explorer, and it shows up on the board.",
  },
];

const places = [
  {
    icon: "i-lucide-hard-drive",
    name: "On your disk",
    price: "Free, no account",
    body: "Real folders, opened in the desktop app.",
  },
  {
    icon: "i-lucide-globe",
    name: "In your browser",
    price: "Free, no account",
    body: "A demo to try everything, with nothing to install.",
  },
  {
    icon: "i-lucide-cloud",
    name: "In the cloud",
    price: "Free plan: 100 MB",
    body: "The same on every device. Invite people, edit together, publish a link.",
  },
];

// Served from apps/landing/public/. Bound as a string so Vite does not import the file.
const compareSrc = "/side-by-side.mp4";
const comparePoster = "/side-by-side-poster.jpg";
</script>

<template>
  <AltSection
    label="Files"
    shape="square"
    title="It's still just a folder."
    lede="In the desktop app you open a real folder on your disk. There is no library to import into and no database to get locked into."
  >
    <div class="split">
      <figure class="compare">
        <div class="alt-frame">
          <video
            class="video"
            controls
            playsinline
            preload="none"
            :poster="comparePoster"
            :src="compareSrc"
            aria-label="The same folder in a classic file manager and in Pile Commander"
          />
        </div>
        <figcaption class="alt-small">
          The same folder, side by side: a classic file manager on the left,
          Pile Commander on the right.
        </figcaption>
      </figure>

      <ul class="facts">
        <li v-for="fact in facts" :key="fact.title">
          <h3 class="alt-h3">{{ fact.title }}</h3>
          <p class="fact-body">{{ fact.body }}</p>
        </li>
      </ul>
    </div>

    <ul class="places">
      <li v-for="place in places" :key="place.name" class="place">
        <UIcon :name="place.icon" class="size-5 shrink-0" />
        <div>
          <h3 class="alt-h3">{{ place.name }}</h3>
          <p class="place-price">{{ place.price }}</p>
          <p class="fact-body">{{ place.body }}</p>
        </div>
      </li>
    </ul>

    <p class="alt-small foot">
      Opening folders from your disk needs the desktop app. You only need an
      account for the cloud.
      <NuxtLink to="/pricing" class="alt-link">See pricing</NuxtLink>
    </p>
  </AltSection>
</template>

<style scoped>
.split {
  display: grid;
  gap: 2.5rem;
}

@media (min-width: 900px) {
  .split {
    grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
    gap: 3.5rem;
    align-items: start;
  }
}

.compare {
  margin: 0;
}

.video {
  display: block;
  width: 100%;
  aspect-ratio: 960 / 623;
  background: var(--alt-wash);
  object-fit: cover;
}

.compare figcaption {
  margin-top: 0.875rem;
}

.facts {
  display: grid;
  gap: 1.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.fact-body {
  margin: 0.4rem 0 0;
  font-size: 1rem;
  line-height: 1.55;
}

.places {
  display: grid;
  gap: 1.75rem;
  margin: clamp(2.5rem, 5vw, 4rem) 0 0;
  border-top: 1px solid var(--alt-line);
  padding: 2rem 0 0;
  list-style: none;
}

@media (min-width: 768px) {
  .places {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 2.5rem;
  }
}

.place {
  display: flex;
  gap: 0.875rem;
}

.place .iconify {
  margin-top: 0.3rem;
  color: var(--alt-ink);
}

.place-price {
  margin: 0.25rem 0 0;
  color: var(--alt-ink-3);
  font-size: 0.875rem;
  font-weight: 500;
}

.foot {
  margin-top: 2rem;
}
</style>
