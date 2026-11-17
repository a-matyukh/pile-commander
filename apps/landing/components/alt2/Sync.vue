<!-- ③ A cloud copy of any folder. Desktop only, both ways, while the app is
     open (LOCAL_SYNC.md). The button is "Sync"; there is no Auto-sync. -->
<script setup lang="ts">
const facts = [
  { title: "Both ways", text: "Edit the folder or its copy. If both sides change one file, you keep both versions." },
  { title: "Clutter stays home", text: ".git, .DS_Store and other dot-files are never uploaded." },
  { title: "Free to start", text: "100 MB in the cloud, files up to 25 MB." },
];

const scene = useTemplateRef<{ play: () => void }>("scene");
</script>

<template>
  <Alt2Section
    id="sync"
    :n="3"
    label="Sync"
    title="Any folder, with a copy in the cloud."
    lede="Press Sync on any folder on your computer. Files, names, layout and drawings then go both ways between the folder and its cloud copy, within seconds. Open the copy on another computer or in a browser."
    :facts="facts"
    note="Sync is part of the desktop app, needs a free account and runs while the app is open."
    alt
  >
    <div class="caption-row">
      <p class="caption">
        A new picture goes up to the cloud; a note edited there comes back down.
        The folder looks the same on both sides, because its view and layout
        travel too.
      </p>
      <button type="button" class="play" @click="scene?.play()">
        <UIcon name="i-lucide-play" class="size-4" />
        Play
      </button>
    </div>

    <div class="a2-frame stage">
      <div class="stage-box">
        <Alt2SyncScene ref="scene" />
      </div>
    </div>
  </Alt2Section>
</template>

<style scoped>
.caption-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1.5rem;
  margin-bottom: 1.5rem;
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

.stage {
  padding: clamp(0.5rem, 1.2vw, 1rem);
}

.stage-box {
  aspect-ratio: 23 / 10;
  overflow: hidden;
  border-radius: var(--a2-radius-s);
}

/* The panes stand one above the other on a phone */
@media (max-width: 639px) {
  .stage-box {
    aspect-ratio: 3 / 4;
  }
}
</style>
