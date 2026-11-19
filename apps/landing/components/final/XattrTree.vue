<!-- How the folder keeps its layout: a key:value map (xattrs) on every file
     and folder, the folder itself included, and drawings and connections in
     its hidden .pile folder. The keys are the ones the app writes (view,
     background, position, size, order; see the home page's UnderTheHood.vue
     and apps/client), the folder is the page's own ~/Pictures/Harbor
     moodboard. A light walks the tree while it is on screen and motion is
     welcome; the pointer on a node lights it too. -->
<script setup lang="ts">
type Node = {
  key: string;
  name: string;
  icon: string;
  tint: string;
  depth: number;
  attrs?: [string, string][];
  note?: string;
  dim?: boolean;
  tag?: string;
};

const nodes: Node[] = [
  { key: "root", name: "Harbor moodboard/", icon: "i-tabler-template", tint: "#534ab7", depth: 0, tag: "~/Pictures", attrs: [["view", '"board"'], ["background", '"dots"']] },
  { key: "refs", name: "References/", icon: "i-tabler-layout-grid", tint: "#d4537e", depth: 1, attrs: [["view", '"grid"']] },
  { key: "sea", name: "sea-horizon.jpg", icon: "i-tabler-photo", tint: "#1d9e75", depth: 1, attrs: [["position", '{"x":48,"y":96}'], ["size", '{"w":420,"h":280}']] },
  { key: "mood", name: "Mood.md", icon: "i-tabler-file-text", tint: "#ba7517", depth: 1, attrs: [["position", '{"x":980,"y":64}'], ["order", "2"]] },
  { key: "pile", name: ".pile/", icon: "i-tabler-folder", tint: "#9a9893", depth: 1, note: "strokes.json · connections.json", dim: true },
];

const order = nodes.filter(n => n.attrs).map(n => n.key);
const lit = ref<string | null>(null);
const hover = ref<string | null>(null);
const root = useTemplateRef<HTMLElement>("root");

onMounted(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let i = 0;
  let timer: number | undefined;
  const io = new IntersectionObserver(([e]) => {
    window.clearInterval(timer);
    if (!e?.isIntersecting) return;
    lit.value = order[i % order.length]!;
    timer = window.setInterval(() => {
      i += 1;
      lit.value = order[i % order.length]!;
    }, 1800);
  });
  if (root.value) io.observe(root.value);
  onBeforeUnmount(() => {
    io.disconnect();
    window.clearInterval(timer);
  });
});

const on = (key: string) => (hover.value ?? lit.value) === key;
</script>

<template>
  <figure ref="root" class="xt">
    <!-- The folder, then its things on branches from it -->
    <div class="tree" role="list" aria-label="A folder and the attributes on each of its files">
      <template v-for="n in nodes.slice(0, 1)" :key="n.key">
        <div
          class="node top"
          role="listitem"
          :class="{ on: on(n.key) }"
          @mouseenter="hover = n.key"
          @mouseleave="hover = null"
        >
          <span class="row">
            <span class="badge"><UIcon :name="n.icon" class="ni" :style="{ color: n.tint }" /></span>
            <span class="nn">{{ n.name }}</span>
            <span v-if="n.tag" class="ntag">{{ n.tag }}</span>
          </span>
          <span v-if="n.attrs" class="attrs">
            <span v-for="[k, v] in n.attrs" :key="k" class="kv"><span class="k">{{ k }}</span><span class="v">{{ v }}</span></span>
          </span>
        </div>
      </template>
      <ul class="kids">
        <li
          v-for="n in nodes.slice(1)"
          :key="n.key"
          class="node kid"
          :class="{ on: on(n.key), dim: n.dim }"
          @mouseenter="hover = n.key"
          @mouseleave="hover = null"
        >
          <span class="row">
            <span class="badge"><UIcon :name="n.icon" class="ni" :style="{ color: n.tint }" /></span>
            <span class="nn">{{ n.name }}</span>
            <span v-if="n.note" class="nnote">{{ n.note }}</span>
          </span>
          <span v-if="n.attrs" class="attrs">
            <span v-for="[k, v] in n.attrs" :key="k" class="kv"><span class="k">{{ k }}</span><span class="v">{{ v }}</span></span>
          </span>
        </li>
      </ul>
    </div>
    <figcaption class="cap">
      <UIcon name="i-tabler-tag" class="ci" />
      <span><b>xattrs</b>: a key:value map on every file and folder, the folder itself included. Drawings and connections live in its hidden <code>.pile</code> folder.</span>
    </figcaption>
  </figure>
</template>

<style scoped>
.xt {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin: 0;
  border: 1px solid var(--lf-line-strong);
  border-radius: 12px;
  background: var(--lf-surface);
  padding: 1.25rem 1.5rem;
}

.tree {
  --line: #c9cdd6;
  --badge: 1.9rem;
}

.node {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  border-radius: 10px;
  padding: 0.35rem 0.5rem;
  transition: background-color 0.25s ease;
}

.node.on {
  background: rgb(36 83 255 / 0.06);
}

/* Each thing's icon on a small tile, so the branches have a point to meet */
.badge {
  display: grid;
  width: var(--badge);
  height: var(--badge);
  flex: none;
  place-items: center;
  border: 1px solid var(--lf-line);
  border-radius: 8px;
  background: #fff;
}

/* The branches: one trunk down from the folder's tile to the last thing,
   and a branch to each thing's tile; the last one ends in a curve */
.kids {
  position: relative;
  margin: 0 0 0 calc(0.5rem + var(--badge) / 2 - 1px);
  padding: 0 0 0 1.4rem;
  list-style: none;
}

.kid {
  margin-top: 0.35rem;
}

.kid::before {
  position: absolute;
  top: -0.35rem;
  bottom: 0;
  left: -1.4rem;
  border-left: 2px solid var(--line);
  content: "";
}

.kid::after {
  position: absolute;
  top: calc(0.35rem + var(--badge) / 2 - 1px);
  left: -1.4rem;
  width: 1.4rem;
  border-top: 2px solid var(--line);
  content: "";
}

.kid:last-child::before {
  bottom: auto;
  height: calc(0.7rem + var(--badge) / 2 - 1px);
  border-bottom: 2px solid var(--line);
  border-bottom-left-radius: 8px;
  width: 1.4rem;
}

.kid:last-child::after {
  display: none;
}

/* The trunk starts under the folder's tile */
.top::after {
  position: absolute;
  top: calc(0.35rem + var(--badge));
  bottom: 0;
  left: calc(0.5rem + var(--badge) / 2 - 1px);
  border-left: 2px solid var(--line);
  content: "";
}

.top .badge {
  border-color: rgb(83 74 183 / 0.35);
  background: rgb(83 74 183 / 0.06);
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}

.ni {
  width: 1.15rem;
  height: 1.15rem;
  flex: none;
}

.nn {
  font-weight: 600;
}

.dim .nn {
  color: var(--lf-ink-3);
  font-weight: 500;
}

.ntag {
  border-radius: 99em;
  background: rgb(36 83 255 / 0.08);
  padding: 0.05rem 0.55rem;
  color: var(--lf-accent);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem;
}

.nnote {
  color: var(--lf-ink-3);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem;
}

/* The map: key and value, monospaced, on a soft card */
.attrs {
  display: grid;
  width: fit-content;
  max-width: 100%;
  grid-template-columns: auto auto;
  gap: 0.15rem 1rem;
  margin-left: calc(var(--badge) + 0.6rem);
  border: 1px solid var(--lf-line);
  border-radius: 8px;
  background: var(--lf-bg);
  padding: 0.45rem 0.7rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8125rem;
  transition: border-color 0.25s ease, background-color 0.25s ease;
}

.on .attrs {
  border-color: rgb(36 83 255 / 0.35);
  background: #fff;
}

.kv {
  display: contents;
}

.k {
  color: var(--lf-accent);
}

.v {
  overflow: hidden;
  color: var(--lf-ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cap {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  border-radius: 8px;
  background: var(--lf-bg);
  padding: 0.6rem 0.75rem;
  color: var(--lf-ink-2);
  font-size: 0.875rem;
  line-height: 1.45;
}

.cap b {
  color: var(--lf-ink);
}

.cap code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.ci {
  width: 1.1rem;
  height: 1.1rem;
  flex: none;
  margin-top: 0.1rem;
  color: var(--lf-accent);
}
</style>
