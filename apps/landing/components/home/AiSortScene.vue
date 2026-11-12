<!-- Sorting as it ships: a pile on the board, the model's plan as folders
     with their files (checked, one left in place), "Sort" moves them; the
     new folders stand where their files stood. SSR, no-JS and reduced
     motion get the plan as proposed. -->
<script setup lang="ts">
type Kind = "photo" | "note" | "pdf";

/** x, y: where it lies; fx, fy: the folder it goes into (none stays) */
const files: { key: string; name: string; kind: Kind; x: number; y: number; fx?: number; fy?: number }[] = [
  { key: "beach", name: "beach.jpg", kind: "photo", x: 5, y: 17, fx: 5, fy: 17 },
  { key: "pier", name: "pier.jpg", kind: "photo", x: 22, y: 27, fx: 5, fy: 17 },
  { key: "sunset", name: "sunset.jpg", kind: "photo", x: 9, y: 55, fx: 5, fy: 17 },
  { key: "packing", name: "Packing.md", kind: "note", x: 41, y: 16, fx: 41, fy: 16 },
  { key: "budget", name: "Budget.md", kind: "note", x: 44, y: 46, fx: 41, fy: 16 },
  { key: "tickets", name: "Tickets.pdf", kind: "pdf", x: 31, y: 70 },
];

const folders = [
  { key: "photos", name: "Photos", x: 5, y: 17, items: ["beach.jpg", "pier.jpg", "sunset.jpg"] },
  { key: "plans", name: "Plans", x: 41, y: 16, items: ["Packing.md", "Budget.md"] },
];

const emit = defineEmits<{ done: [] }>();

const root = ref<HTMLElement>();
// The finished frame: the plan as proposed. The loop rewinds it on the client.
const panel = ref(true);
const asking = ref(false);
const pressing = ref(false);
const sorted = ref(false);
const fading = ref(false);

let timers: ReturnType<typeof setTimeout>[] = [];
let observer: IntersectionObserver | undefined;
let running = false;

function at(ms: number, fn: () => void) {
  timers.push(setTimeout(fn, ms));
}

function stop() {
  running = false;
  for (const t of timers) clearTimeout(t);
  timers = [];
}

function cycle() {
  panel.value = false;
  asking.value = false;
  pressing.value = false;
  sorted.value = false;
  fading.value = false;

  at(900, () => {
    panel.value = true;
    asking.value = true;
  });
  at(2100, () => (asking.value = false));
  at(4600, () => (pressing.value = true));
  at(4900, () => {
    pressing.value = false;
    panel.value = false;
    sorted.value = true;
  });
  at(8200, () => (fading.value = true));
  at(9100, () => {
    // The block may move to the next tab; if it does not, the scene plays again
    emit("done");
    cycle();
  });
}

function start() {
  if (running) return;
  running = true;
  cycle();
}

onMounted(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  observer = new IntersectionObserver(([entry]) => {
    if (entry?.isIntersecting) start();
    else stop();
  });
  if (root.value) observer.observe(root.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  stop();
});
</script>

<template>
  <div
    ref="root"
    class="sort"
    :class="{ 'is-panel': panel, 'is-asking': asking, 'is-sorted': sorted, 'is-fading': fading }"
    aria-hidden="true"
  >
    <p class="folder-pill">
      <UIcon name="i-lucide-folder" class="size-[1.15em] text-pc-600" />
      Trip pile
    </p>

    <!-- The folders the plan makes, where their files stood -->
    <article
      v-for="(folder, i) in folders"
      :key="folder.key"
      class="new-folder"
      :style="{ left: `${folder.x}%`, top: `${folder.y}%`, '--i': i }"
    >
      <span class="tab" />
      <UIcon name="i-lucide-folder" class="size-[1.8em] text-pc-500" />
      <p>{{ folder.name }}</p>
    </article>

    <article
      v-for="(file, i) in files"
      :key="file.key"
      class="file"
      :class="[`file-${file.kind}`, { 'file-stays': file.fx === undefined }]"
      :style="{
        '--x': `${file.x}%`,
        '--y': `${file.y}%`,
        '--fx': `${file.fx ?? file.x}%`,
        '--fy': `${file.fy ?? file.y}%`,
        '--i': i,
      }"
    >
      <div v-if="file.kind === 'photo'" class="thumb" :class="`thumb-${file.key}`" />
      <p v-else-if="file.kind === 'note'" class="note-title">{{ file.name.replace('.md', '') }}</p>
      <UIcon v-else name="i-lucide-file-text" class="size-[1.6em] text-rose-500" />
      <p class="file-name">{{ file.name }}</p>
    </article>

    <!-- The model's plan, before anything moves -->
    <section class="plan">
      <p class="plan-title">Sort “Trip pile” into folders</p>
      <div v-if="asking" class="plan-asking">
        <UIcon name="i-lucide-loader-circle" class="size-[1em] animate-spin" />
        Asking the model…
      </div>
      <template v-else>
        <div v-for="folder in folders" :key="folder.key" class="plan-group">
          <p class="plan-folder">
            <span class="box box-on"><UIcon name="i-lucide-check" class="size-[0.8em]" /></span>
            <UIcon name="i-lucide-folder" class="size-[1em] text-slate-500" />
            {{ folder.name }}
            <span class="tag">new</span>
          </p>
          <p v-for="item in folder.items" :key="item" class="plan-item">
            <span class="box box-on"><UIcon name="i-lucide-check" class="size-[0.8em]" /></span>
            {{ item }}
          </p>
        </div>
        <div class="plan-foot">
          <span>1 left in place</span>
          <span class="button" :class="{ 'is-pressed': pressing }">Sort 5</span>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.sort {
  position: relative;
  height: 100%;
  container-type: inline-size;
  overflow: hidden;
  font-size: clamp(8px, 1.5cqw, 14px);
  color: #334155;
  background-color: hsl(213 40% 96.5%);
  background-image: radial-gradient(hsl(215 25% 80%) 1px, transparent 1px);
  background-size: 1.6em 1.6em;
}

p {
  margin: 0;
}

.folder-pill {
  position: absolute;
  top: 5%;
  left: 4%;
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  border: 1px solid var(--pc-gray-border);
  border-radius: 0.6em;
  background: white;
  padding: 0.35em 0.7em;
  font-weight: 600;
  color: #475569;
}

/* ── The pile ────────────────────────────────────────── */

.file {
  position: absolute;
  left: var(--x);
  top: var(--y);
  display: flex;
  width: 14%;
  flex-direction: column;
  gap: 0.35em;
  box-sizing: border-box;
  border: 1px solid var(--pc-gray-border);
  border-radius: 0.8em;
  background: white;
  padding: 0.45em;
  box-shadow: 0 0.7em 1.4em -0.8em rgb(15 23 42 / 0.4);
  transition:
    left 0.7s cubic-bezier(0.5, 0, 0.2, 1),
    top 0.7s cubic-bezier(0.5, 0, 0.2, 1),
    scale 0.7s cubic-bezier(0.5, 0, 0.2, 1),
    opacity 0.45s ease 0.3s;
  transition-delay: calc(var(--i) * 70ms);
}

.file-note {
  border-color: rgb(252 211 77 / 0.9);
  background: #fff7d6;
  color: rgb(120 53 15 / 0.85);
}

.file-pdf {
  align-items: flex-start;
}

.thumb {
  height: 4.2em;
  border-radius: 0.5em;
}

.thumb-beach {
  background: linear-gradient(180deg, #bae6fd 0%, #7dd3fc 55%, #fde68a 56%, #fcd34d 100%);
}

.thumb-pier {
  background: linear-gradient(160deg, #e0f2fe 0%, #93c5fd 60%, #475569 61%, #334155 100%);
}

.thumb-sunset {
  background:
    radial-gradient(circle at 50% 70%, #fde68a 0 0.9em, transparent 0.95em),
    linear-gradient(180deg, #fb923c 0%, #f472b6 60%, #1e3a5f 61%);
}

.note-title {
  font-weight: 700;
}

.file-name {
  overflow: hidden;
  font-size: 0.85em;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Sorted: into its folder; what fits nowhere stays */
.is-sorted .file:not(.file-stays) {
  left: var(--fx);
  top: var(--fy);
  scale: 0.4;
  opacity: 0;
}

.is-fading .file-stays {
  opacity: 0;
}

/* ── The new folders ─────────────────────────────────── */

.new-folder {
  position: absolute;
  display: flex;
  width: 14%;
  height: 22%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.3em;
  box-sizing: border-box;
  border: 1px solid var(--pc-gray-border);
  border-radius: 0 0.8em 0.8em 0.8em;
  background: white;
  font-weight: 600;
  box-shadow: 0 0.7em 1.4em -0.8em rgb(15 23 42 / 0.4);
  opacity: 0;
  scale: 0.8;
  transition:
    opacity 0.4s ease,
    scale 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.2);
  transition-delay: calc(0.45s + var(--i) * 120ms);
}

.tab {
  position: absolute;
  bottom: 100%;
  left: -1px;
  width: 40%;
  height: 0.7em;
  border: 1px solid var(--pc-gray-border);
  border-bottom: 0;
  border-radius: 0.4em 0.4em 0 0;
  background: white;
}

.is-sorted .new-folder {
  opacity: 1;
  scale: 1;
}

.is-fading .new-folder {
  opacity: 0;
  transition-delay: 0s;
}

/* ── The plan ────────────────────────────────────────── */

.plan {
  position: absolute;
  top: 8%;
  right: 4%;
  width: 34%;
  box-sizing: border-box;
  border: 1px solid var(--pc-gray-border);
  border-radius: 0.9em;
  background: white;
  padding: 0.8em;
  box-shadow: 0 1.2em 2.4em -1em rgb(15 23 42 / 0.45);
  opacity: 0;
  translate: 0 0.6em;
  transition:
    opacity 0.35s ease,
    translate 0.35s ease;
}

.is-panel .plan {
  opacity: 1;
  translate: 0 0;
}

.plan-title {
  font-weight: 700;
  color: #1e293b;
}

.plan-asking {
  display: flex;
  align-items: center;
  gap: 0.4em;
  margin-top: 0.8em;
  color: #64748b;
}

.plan-group {
  margin-top: 0.6em;
  overflow: hidden;
  border: 1px solid var(--pc-gray-border);
  border-radius: 0.6em;
}

.plan-folder {
  display: flex;
  align-items: center;
  gap: 0.4em;
  background: var(--pc-gray-header);
  padding: 0.35em 0.5em;
  font-weight: 600;
}

.plan-item {
  display: flex;
  align-items: center;
  gap: 0.4em;
  border-top: 1px solid var(--pc-gray-border);
  padding: 0.3em 0.5em 0.3em 1.6em;
}

.box {
  display: grid;
  width: 1.05em;
  height: 1.05em;
  flex-shrink: 0;
  place-items: center;
  border-radius: 0.25em;
  color: white;
}

.box-on {
  background: var(--color-pc-500);
}

.tag {
  margin-left: auto;
  border-radius: 999px;
  background: var(--color-pc-50);
  padding: 0.05em 0.5em;
  font-size: 0.8em;
  font-weight: 600;
  color: var(--color-pc-600);
}

.plan-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.7em;
  font-size: 0.9em;
  color: #64748b;
}

.button {
  border-radius: 0.5em;
  background: var(--color-pc-500);
  padding: 0.35em 0.8em;
  font-weight: 600;
  color: white;
  transition: scale 0.15s ease, filter 0.15s ease;
}

.button.is-pressed {
  scale: 0.92;
  filter: brightness(0.9);
}

/* Narrow cards: the plan over the board, smaller words */
@container (max-width: 520px) {
  .plan {
    width: 52%;
    font-size: 0.85em;
  }

  .file {
    width: 18%;
  }

  .new-folder {
    width: 18%;
  }

  .file-name {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .file,
  .new-folder,
  .plan {
    transition: none;
  }
}
</style>
