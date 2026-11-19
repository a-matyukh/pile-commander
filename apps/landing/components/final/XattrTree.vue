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
    <ul class="tree" aria-label="A folder and the attributes on each of its files">
      <li
        v-for="n in nodes"
        :key="n.key"
        class="node"
        :class="{ on: on(n.key), dim: n.dim, child: n.depth > 0 }"
        :style="{ '--d': n.depth }"
        @mouseenter="hover = n.key"
        @mouseleave="hover = null"
      >
        <span class="row">
          <UIcon :name="n.icon" class="ni" :style="{ color: n.tint }" />
          <span class="nn">{{ n.name }}</span>
          <span v-if="n.tag" class="ntag">{{ n.tag }}</span>
          <span v-if="n.note" class="nnote">{{ n.note }}</span>
        </span>
        <span v-if="n.attrs" class="attrs">
          <span v-for="[k, v] in n.attrs" :key="k" class="kv"><span class="k">{{ k }}</span><span class="v">{{ v }}</span></span>
        </span>
      </li>
    </ul>
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
  margin: 0;
  padding: 0;
  list-style: none;
}

/* A node: indented by depth, a line down from its parent */
.node {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-left: calc(var(--d) * 1.75rem);
  border-radius: 10px;
  padding: 0.45rem 0.6rem;
  transition: background-color 0.25s ease;
}

.node + .node {
  margin-top: 0.15rem;
}

.node.child::before {
  position: absolute;
  top: -0.3rem;
  bottom: 50%;
  left: -1rem;
  width: 0.85rem;
  border-bottom: 1.5px solid var(--lf-line-strong);
  border-left: 1.5px solid var(--lf-line-strong);
  border-bottom-left-radius: 6px;
  content: "";
}

.node.on {
  background: rgb(36 83 255 / 0.06);
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.ni {
  width: 1.25rem;
  height: 1.25rem;
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
  margin-left: 1.75rem;
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
