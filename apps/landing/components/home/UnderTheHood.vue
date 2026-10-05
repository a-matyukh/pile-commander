<script setup lang="ts">
const githubUrl = "https://github.com/a-matyukh/pile-commander";

type Attr = [key: string, value: string];

// Real attribute names the client writes (view, background, position, size, order).
const root = {
  key: "root",
  name: "Research/",
  attrs: [["view", '"board"'], ["background", '"dots"']] as Attr[],
};
const references = {
  key: "refs",
  name: "References/",
  attrs: [["view", '"grid"']] as Attr[],
};
const harbor = {
  key: "harbor",
  name: "harbor-01.jpg",
  attrs: [["position", '{"x":120,"y":48}'], ["size", '{"w":240,"h":180}']] as Attr[],
};
const mood = {
  key: "mood",
  name: "Mood.md",
  attrs: [["position", '{"x":40,"y":300}'], ["order", "2"]] as Attr[],
};

const facts = [
  {
    icon: "i-lucide-tag",
    title: "Layout in xattrs",
    body: "Position, size, view and background are stored on the files themselves: as xattrs on macOS and Linux, and as alternate data streams on Windows (NTFS only). In the browser and the cloud they travel as records next to each file.",
  },
  {
    icon: "i-lucide-hard-drive",
    title: "Local",
    body: "The desktop app works right in your ordinary file system — the same folders you see in Finder or Explorer; Tauri only provides the bridge to them through its plugins. The browser version keeps its desktops in IndexedDB.",
  },
  {
    icon: "i-lucide-cloud",
    title: "Cloud",
    body: "Supabase for accounts, data and live editing. Media files are stored in Backblaze B2.",
  },
  {
    icon: "i-lucide-file-archive",
    title: ".pile archives",
    body: "Just a zip of the folder with its attributes, so the layout survives email, USB sticks and file systems that drop xattrs.",
  },
];

// A highlight walks the tree: every level carries the same kind of map.
const order = [root.key, references.key, harbor.key, mood.key];
const active = ref<string | null>(null);
const tree = ref<HTMLElement>();
let timer: ReturnType<typeof setInterval> | undefined;
let observer: IntersectionObserver | undefined;

function stop() {
  clearInterval(timer);
  timer = undefined;
}

function start() {
  if (timer) return;
  let i = 0;
  active.value = order[i]!;
  timer = setInterval(() => {
    i = (i + 1) % order.length;
    active.value = order[i]!;
  }, 1800);
}

onMounted(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  observer = new IntersectionObserver(([entry]) => {
    if (entry?.isIntersecting) start();
    else stop();
  });
  if (tree.value) observer.observe(tree.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  stop();
});
</script>

<template>
  <FeatureSection
    eyebrow="Under the hood"
    title="Plain folders all the way down."
    lede="A workspace is a folder on disk. The board is written into the files' extended attributes — there is no database to migrate and nothing to lock you in."
    muted
  >
    <div class="grid items-start gap-10 lg:grid-cols-[1.15fr_1fr]">
      <!-- The workspace as a tree: every node carries a key:value map -->
      <figure class="m-0 min-w-0 rounded-2xl border border-[var(--pc-gray-border)] bg-white p-5 shadow-sm sm:p-7">
        <div ref="tree" class="tree">
          <div class="node" :class="{ active: active === root.key }">
            <p class="node-row">
              <UIcon name="i-lucide-folder" class="size-5 shrink-0 text-pc-500" />
              <span class="node-name">{{ root.name }}</span>
              <span class="root-badge">workspace root</span>
            </p>
            <dl class="attrs">
              <template v-for="[k, v] in root.attrs" :key="k">
                <dt>{{ k }}</dt>
                <dd>{{ v }}</dd>
              </template>
            </dl>
          </div>

          <ul class="branch">
            <li>
              <div class="node" :class="{ active: active === references.key }">
                <p class="node-row">
                  <UIcon name="i-lucide-folder" class="size-5 shrink-0 text-pc-500" />
                  <span class="node-name">{{ references.name }}</span>
                </p>
                <dl class="attrs">
                  <template v-for="[k, v] in references.attrs" :key="k">
                    <dt>{{ k }}</dt>
                    <dd>{{ v }}</dd>
                  </template>
                </dl>
              </div>

              <ul class="branch">
                <li>
                  <div class="node" :class="{ active: active === harbor.key }">
                    <p class="node-row">
                      <UIcon name="i-lucide-image" class="size-5 shrink-0 text-emerald-600" />
                      <span class="node-name">{{ harbor.name }}</span>
                    </p>
                    <dl class="attrs">
                      <template v-for="[k, v] in harbor.attrs" :key="k">
                        <dt>{{ k }}</dt>
                        <dd>{{ v }}</dd>
                      </template>
                    </dl>
                  </div>
                </li>
              </ul>
            </li>

            <li>
              <div class="node" :class="{ active: active === mood.key }">
                <p class="node-row">
                  <UIcon name="i-lucide-file-text" class="size-5 shrink-0 text-amber-600" />
                  <span class="node-name">{{ mood.name }}</span>
                </p>
                <dl class="attrs">
                  <template v-for="[k, v] in mood.attrs" :key="k">
                    <dt>{{ k }}</dt>
                    <dd>{{ v }}</dd>
                  </template>
                </dl>
              </div>
            </li>

            <li>
              <div class="node node-muted">
                <p class="node-row">
                  <UIcon name="i-lucide-folder-dot" class="size-5 shrink-0" />
                  <span class="node-name">.pile/</span>
                  <span class="node-note">strokes.json · connections.json</span>
                </p>
              </div>
            </li>
          </ul>
        </div>

        <figcaption class="mt-6 inline-flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <UIcon name="i-lucide-tag" class="size-4 shrink-0 text-amber-600" />
          <span><strong class="font-semibold">xattrs</strong> — a key:value map on every file and folder, the root included.</span>
        </figcaption>
      </figure>

      <div class="min-w-0">
        <ul class="grid list-none gap-6 p-0 sm:grid-cols-2 lg:grid-cols-1">
          <li v-for="fact in facts" :key="fact.title" class="flex gap-3">
            <UIcon :name="fact.icon" class="mt-0.5 size-5 shrink-0 text-pc-500" />
            <div>
              <h3 class="text-base font-semibold text-slate-900">{{ fact.title }}</h3>
              <p class="mt-1 text-sm leading-relaxed text-slate-600">{{ fact.body }}</p>
            </div>
          </li>
        </ul>

        <div class="mt-8 flex flex-wrap items-center gap-3 border-t border-[var(--pc-gray-border)] pt-6">
          <UButton
            :href="githubUrl"
            target="_blank"
            rel="noopener noreferrer"
            color="neutral"
            variant="outline"
            size="lg"
            icon="bytesize:github"
          >
            View source on GitHub
          </UButton>
          <span class="font-mono text-sm text-slate-500">a-matyukh/pile-commander</span>
        </div>
      </div>
    </div>
  </FeatureSection>
</template>

<style scoped>
.tree {
  font-size: 15px;
}

.branch {
  position: relative;
  margin: 0 0 0 0.6rem;
  padding: 0.35rem 0 0 1.6rem;
  list-style: none;
  border-left: 1.5px solid #cbd5e1;
}

.branch > li {
  position: relative;
  padding-top: 0.55rem;
}

/* The twig from the trunk to each node. */
.branch > li::before {
  content: "";
  position: absolute;
  top: 1.35rem;
  left: -1.6rem;
  width: 1.3rem;
  border-top: 1.5px solid #cbd5e1;
}

/* The last child ends the trunk at its twig. */
.branch > li:last-child::after {
  content: "";
  position: absolute;
  top: 1.35rem;
  bottom: 0;
  left: calc(-1.6rem - 1.5px);
  width: 3px;
  background: white;
}

.node-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
}

.node-name {
  font-weight: 600;
  color: #0f172a;
}

.root-badge {
  border-radius: 999px;
  background: var(--color-pc-50);
  padding: 0.1rem 0.55rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-pc-700);
}

.node-muted .node-row {
  color: #94a3b8;
}

.node-muted .node-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 500;
  color: #94a3b8;
}

.node-note {
  min-width: 0;
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The key:value map, marked like a highlighter. */
.attrs {
  display: inline-grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.15rem 0.9rem;
  max-width: 100%;
  margin: 0.4rem 0 0 1.75rem;
  border: 1px solid #fde68a;
  border-radius: 0.6rem;
  background: #fffbeb;
  padding: 0.4rem 0.7rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.78rem;
  transition:
    background-color 0.4s ease,
    border-color 0.4s ease,
    box-shadow 0.4s ease;
}

.attrs dt {
  color: #b45309;
}

.attrs dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: #334155;
}

.active .attrs {
  border-color: #fbbf24;
  background: #fef3c7;
  box-shadow: 0 0 0 4px rgb(251 191 36 / 0.25);
}

@media (max-width: 480px) {
  .tree {
    font-size: 14px;
  }

  .branch {
    padding-left: 1.1rem;
  }

  .branch > li::before {
    left: -1.1rem;
    width: 0.9rem;
  }

  .branch > li:last-child::after {
    left: calc(-1.1rem - 1.5px);
  }

  .attrs {
    margin-left: 0;
  }

  .node-note {
    display: none;
  }
}
</style>
