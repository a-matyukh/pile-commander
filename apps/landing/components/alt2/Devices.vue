<!-- ⑤ Any screen. The desktop app on three systems; tablets and phones use
     the web app (no native mobile app). Drawer below 640px, pinch to zoom
     in Canvas and 3D. -->
<script setup lang="ts">
const facts = [
  { title: "Desktop", text: "macOS, Windows and Linux. Folders on your disk and sync live here." },
  { title: "Tablet and phone", text: "The web app in any browser, with your cloud folders." },
  { title: "Made for touch", text: "On a phone the sidebar slides in from the edge, menus fit the screen, and you pinch to zoom a canvas." },
];

const scene = useTemplateRef<{ play: () => void }>("scene");
</script>

<template>
  <Alt2Section
    id="devices"
    :n="5"
    label="Any screen"
    title="On a desk, a tablet or a phone."
    lede="The desktop app runs on macOS, Windows and Linux. On a tablet or a phone your cloud folders open in the browser, and a change made on one screen shows up on the others."
    :facts="facts"
    alt
  >
    <div class="caption-row">
      <p class="caption">
        A note added with + on the phone shows up on the tablet and the
        monitor. The board keeps its places at every size; a phone shows part
        of it and scrolls.
      </p>
      <button type="button" class="play" @click="scene?.play()">
        <UIcon name="i-lucide-play" class="size-4" />
        Play
      </button>
    </div>

    <Alt2DevicesScene ref="scene" />
  </Alt2Section>
</template>

<style scoped>
.caption-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1.5rem;
  margin-bottom: 2rem;
}

.caption {
  max-width: 46rem;
  margin: 0;
  color: var(--a2-ink-2);
  font-size: 1rem;
}

.play {
  display: inline-flex;
  height: 2.25rem;
  cursor: pointer;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid var(--a2-line);
  border-radius: 999px;
  background: var(--a2-surface);
  padding: 0 0.9rem 0 0.75rem;
  color: var(--a2-ink);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 600;
}

.play:hover {
  border-color: var(--a2-ink-3);
}
</style>
