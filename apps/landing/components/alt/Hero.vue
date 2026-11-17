<script setup lang="ts">
const { demoUrl } = useAppLinks();
const { os } = useVisitorPlatform();

const osNames: Record<string, string> = { mac: "macOS", windows: "Windows", linux: "Linux" };
const downloadLabel = computed(() => {
  const name = osNames[os.value];
  return name ? `Download for ${name}` : "Download desktop app";
});

const external = { target: "_blank", rel: "noopener noreferrer" };
</script>

<template>
  <section class="hero">
    <div class="alt-wrap">
      <div class="head">
        <h1 class="alt-h1">Make sense<br>of the pile.</h1>

        <!-- The app icon's five shapes, as they lie in the icon: a heap -->
        <svg class="heap" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
          <path d="M80 12 L772 882" fill="none" stroke="var(--alt-blue)" stroke-width="42" />
          <rect
            x="368.5"
            y="93.5"
            width="277"
            height="167"
            fill="var(--alt-purple)"
            transform="rotate(-23.9 507 177)"
          />
          <rect
            x="71.5"
            y="426"
            width="257"
            height="219"
            fill="var(--alt-green)"
            transform="rotate(-10.7 200 535.5)"
          />
          <circle cx="792" cy="435" r="143" fill="var(--alt-pink)" />
          <path
            d="M213 824 A470 470 0 0 0 725 627"
            fill="none"
            stroke="var(--alt-yellow)"
            stroke-width="68"
          />
        </svg>
      </div>

      <div class="body">
        <div class="copy">
          <!-- Says what it is first. The AI needs a model the person connects,
               so the sentence says "connect", not just "let AI". -->
          <p class="alt-lede">
            Pile Commander is a file manager that opens any folder as a board:
            pictures show as pictures, notes as notes. Arrange it by hand, or
            connect an AI model and let it name the files and sort them into
            folders. Everything stays ordinary files on your disk.
          </p>

          <!-- A phone cannot run the desktop app: the web demo leads there -->
          <div v-if="os === 'mobile'" class="actions">
            <a :href="demoUrl" v-bind="external" class="alt-btn alt-btn-primary">
              Try it in the browser
            </a>
            <NuxtLink to="/download" class="alt-btn alt-btn-secondary">
              Get the desktop app
            </NuxtLink>
          </div>
          <div v-else class="actions">
            <NuxtLink to="/download" class="alt-btn alt-btn-primary">
              <UIcon name="i-lucide-download" class="size-[1.1em]" />
              {{ downloadLabel }}
            </NuxtLink>
            <a :href="demoUrl" v-bind="external" class="alt-btn alt-btn-secondary">
              Try it in the browser
            </a>
          </div>

          <p class="alt-small">
            Free on your computer · No account · macOS, Windows, Linux and the web
          </p>
        </div>

        <AltPileScene />
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero {
  overflow-x: clip;
  padding: clamp(2.5rem, 4.5vw, 3.75rem) 0 var(--alt-section);
}

.head {
  position: relative;
}

/* ── The heap ────────────────────────────────────────── */

/* To the right of the headline, centred on it */
.heap {
  position: absolute;
  top: 50%;
  right: 0;
  width: clamp(4rem, 19vw, 10rem);
  height: auto;
  aspect-ratio: 1;
  overflow: visible;
  translate: 0 -50%;
}

/* No room beside the headline on the narrowest phones */
@media (max-width: 339px) {
  .heap {
    display: none;
  }
}

@media (min-width: 900px) {
  .heap {
    right: 5%;
    width: clamp(12rem, 19vw, 15.5rem);
  }
}

/* Each shape falls onto the heap, one after another */
@media (prefers-reduced-motion: no-preference) {
  .heap > * {
    animation: heap-drop 0.8s cubic-bezier(0.2, 0.9, 0.3, 1.15) both;
  }

  .heap > :nth-child(2) {
    animation-delay: 0.08s;
  }

  .heap > :nth-child(3) {
    animation-delay: 0.16s;
  }

  .heap > :nth-child(4) {
    animation-delay: 0.24s;
  }

  .heap > :nth-child(5) {
    animation-delay: 0.32s;
  }
}

@keyframes heap-drop {
  from {
    opacity: 0;
    translate: 0 -180px;
  }
}

/* ── Words and the frame ─────────────────────────────── */

.body {
  display: grid;
  gap: 2.5rem;
  margin-top: clamp(1.75rem, 3.2vw, 2.75rem);
}

@media (min-width: 900px) {
  .body {
    grid-template-columns: minmax(0, 4fr) minmax(0, 8fr);
    gap: 3.5rem;
    align-items: start;
  }
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin: 2rem 0 1.25rem;
}
</style>
