<!-- The desktop app's window, drawn after the app (apps/client/src/ui/explorer):
     the top bar with bookmarks, the sidebar with drives and the folder tree,
     and the compact folder header — the path in one row, ~ for the home
     folder (a cloud icon for the cloud), the open folder last — with the
     folder's buttons in the app's order for a folder of your own
     (FolderActions.vue): view, add, layers (a board or a canvas only), AI,
     sync, share, more.
     The content goes in the default slot; the `over` slot sits over the
     folder (a menu open from its header). It keeps the app's own palette and
     scales with its width (container units), like a screenshot.
     On a narrow screen it zooms into the folder: the sidebar and the
     bookmarks leave. -->
<script setup lang="ts">
export interface Crumb {
  /** home: ~ ; cloud: the cloud icon; otherwise the folder's name */
  glyph?: "home" | "cloud" | "browser";
  name?: string;
}

export interface TreeItem {
  name: string;
  /** tabler icon of the folder's own view */
  icon?: string;
  color?: string;
  depth?: number;
  open?: boolean;
  selected?: boolean;
}

const props = withDefaults(
  defineProps<{
    crumbs: Crumb[];
    title: string;
    viewIcon?: string;
    viewColor?: string;
    bookmarks?: TreeItem[];
    tree?: TreeItem[];
    /** which drive is open in the sidebar */
    drive?: "local" | "cloud" | "hub";
    synced?: boolean;
    label?: string;
    /** pin the blocks' numbers on the window: all (the intro's map) or some */
    markers?: boolean | number[];
    /** take the height of its box (the intro fits the screen); the content stretches */
    fill?: boolean;
    /** a board or a canvas: the header has the layers button */
    spatial?: boolean;
    /** a header menu is open: its button is pressed */
    open?: "view" | "add" | "layers" | "ai" | "sync" | "share" | null;
    /** the sync button's icon (SyncMenu.vue): cloud-up before syncing */
    syncIcon?: string;
    /** the folder's buttons; a page (Settings) has none */
    actions?: boolean;
    /** a tablet's screen: narrow, but 640px and wider keep the sidebar */
    keepSidebar?: boolean;
    /** the visitor can use something in it: no longer a picture to screen readers */
    interactive?: boolean;
    /** the web app: no disk, so the first source is the browser's own
     *  storage (IndexedDB), a database icon instead of ~ */
    web?: boolean;
  }>(),
  {
    viewIcon: "i-tabler-template",
    viewColor: "#534ab7",
    bookmarks: () => [],
    tree: () => [],
    drive: "local",
    synced: true,
    label: undefined,
    markers: false,
    fill: false,
    spatial: true,
    open: null,
    actions: true,
    syncIcon: "i-tabler-cloud-check",
    interactive: false,
    keepSidebar: false,
  },
);

const pin = (n: number) => props.markers === true || (Array.isArray(props.markers) && props.markers.includes(n));

/** The block under the pointer: its place in the window gets a ring */
const active = useState<number | null>("lf-active", () => null);
</script>

<template>
  <div class="shot" :class="{ pins: markers, fill, keep: keepSidebar }" :data-active="markers ? active ?? undefined : undefined">
  <div class="lf-frame" :role="interactive ? undefined : 'img'" :aria-label="interactive ? undefined : label">
    <div class="win">
      <div class="topbar">
        <span class="tb"><UIcon name="i-tabler-layout-sidebar" class="ic" /></span>
        <span class="tb"><UIcon name="i-tabler-chevron-left" class="ic" /></span>
        <span class="tb"><UIcon name="i-tabler-chevron-right" class="ic" /></span>
        <span class="sep" />
        <span class="tb"><UIcon name="i-tabler-arrow-back-up" class="ic" /></span>
        <span class="tb"><UIcon name="i-tabler-arrow-forward-up" class="ic" /></span>
        <span v-if="bookmarks.length" class="sep" />
        <span class="bms">
          <span v-for="b in bookmarks" :key="b.name" class="bm" :class="{ on: b.selected }">
            <UIcon :name="b.icon ?? 'i-tabler-folder'" class="ic" :style="{ color: b.color }" />{{ b.name }}
          </span>
        </span>
      </div>

      <div class="body">
        <aside class="side">
          <div class="drives">
            <!-- The home folder is ~, as in the path (HomeGlyph.vue); the web
                 app has the browser's storage there (Breadcrumbs.vue) -->
            <span class="dr" :class="{ on: drive === 'local' }">
              <UIcon v-if="web" name="i-tabler-database" class="ic" />
              <span v-else class="hm">~</span>
            </span>
            <span class="dr" :class="{ on: drive === 'cloud' }"><UIcon name="i-tabler-cloud" class="ic" /></span>
            <span class="dr" :class="{ on: drive === 'hub' }"><UIcon name="i-tabler-world" class="ic" /></span>
          </div>
          <ul class="tree">
            <li v-for="item in tree" :key="item.name" :class="{ sel: item.selected }" :style="{ paddingLeft: `${0.4 + (item.depth ?? 0) * 1.2}em` }">
              <UIcon v-if="item.open !== undefined" :name="item.open ? 'i-tabler-chevron-down' : 'i-tabler-chevron-right'" class="ic tw" />
              <span v-else class="tw" />
              <UIcon :name="item.icon ?? 'i-tabler-folder'" class="ic" :style="{ color: item.color }" />
              {{ item.name }}
            </li>
          </ul>
        </aside>

        <div class="main">
          <!-- The compact folder header: the path in one row -->
          <div class="fh">
            <div class="bc">
              <template v-for="(c, i) in crumbs" :key="i">
                <UIcon v-if="i > 0" name="i-tabler-chevron-right" class="chev" />
                <span v-if="c.glyph === 'home'" class="hm">~</span>
                <UIcon v-else-if="c.glyph === 'cloud'" name="i-tabler-cloud" class="cl" />
                <UIcon v-else-if="c.glyph === 'browser'" name="i-tabler-database" class="db" />
                <span v-else>{{ c.name }}</span>
              </template>
              <UIcon v-if="crumbs.length" name="i-tabler-chevron-right" class="chev" />
              <span class="cur">{{ title }}</span>
            </div>

            <div v-if="actions" class="acts">
              <span class="act" :class="{ on: open === 'view' }" data-anchor="1"><UIcon :name="viewIcon" class="ic" :style="{ color: viewColor }" /><FinalMarker v-if="pin(1)" :n="1" /></span>
              <!-- ② files and folders: what you add and the layers they sit on -->
              <span class="pair" data-anchor="2">
                <span class="act" :class="{ on: open === 'add' }"><UIcon name="i-tabler-plus" class="ic" /></span>
                <span v-if="spatial" class="act" :class="{ on: open === 'layers' }"><UIcon name="i-tabler-stack-2" class="ic" /></span>
                <FinalMarker v-if="pin(2)" :n="2" />
              </span>
              <span class="act" :class="{ on: open === 'ai' }" data-anchor="3"><UIcon name="i-lucide-sparkles" class="ic" /><FinalMarker v-if="pin(3)" :n="3" /></span>
              <!-- Sync before share, as in the app: a private cloud copy comes first -->
              <span v-if="synced" class="act" :class="{ on: open === 'sync' }" data-anchor="4"><UIcon :name="syncIcon" class="ic" /><FinalMarker v-if="pin(4)" :n="4" /></span>
              <span class="act" :class="{ on: open === 'share' }" data-anchor="5"><UIcon name="i-tabler-share-2" class="ic" /><FinalMarker v-if="pin(5)" :n="5" /></span>
              <span class="act"><UIcon name="i-tabler-dots" class="ic" /></span>
            </div>
          </div>

          <!-- The content, and a panel pinned right of it (layers) -->
          <div class="crow">
            <div class="content">
              <slot />
            </div>
            <slot name="aside" />
          </div>
          <slot name="over" />
        </div>
      </div>

      <!-- A dialog over the whole window, as the app's Modal -->
      <slot name="modal" />

      <!-- The window's corner: it fits any screen -->
      <span v-if="pin(6)" class="grip" data-anchor="6"><FinalMarker :n="6" class="mk-grip" /></span>
    </div>
  </div>
  </div>
</template>

<style scoped>
.shot {
  container-type: inline-size;
}

/* Fill: the window takes its box's height, the sidebar and content cut off */
.fill,
.fill .lf-frame,
.fill .win {
  height: 100%;
}

.fill .lf-frame {
  box-sizing: border-box;
}

/* The tree cuts off; the body may not, or it would clip the markers */
.fill .body {
  min-height: 0;
}

.fill .side {
  overflow: hidden;
}

/* ⑥ lights the whole window */
.lf-frame {
  outline: 3px solid transparent;
  outline-offset: 4px;
  transition: outline-color 0.15s ease;
}

.shot[data-active="6"] .lf-frame {
  outline-color: var(--lf-accent);
}

/* The block in focus: its place in the app gets a ring */
.shot[data-active="1"] :deep([data-anchor="1"]),
.shot[data-active="2"] :deep([data-anchor="2"]),
.shot[data-active="3"] :deep([data-anchor="3"]),
.shot[data-active="4"] :deep([data-anchor="4"]),
.shot[data-active="5"] :deep([data-anchor="5"]) {
  box-shadow: 0 0 0 2px var(--lf-accent);
}

/* The app's palette (apps/client/src/ui/explorer/tokens.css) */
.win {
  --s0: #f0f0ee;
  --s1: #f8f8f7;
  --s2: #ffffff;
  --tp: #1f1f1e;
  --ts: #5f5e5a;
  --tm: #9a9893;
  --bd: rgb(0 0 0 / 0.08);
  --acc-bg: #e6f1fb;
  --acc-tx: #185fa5;

  position: relative;
  display: grid;
  grid-template-rows: auto 1fr;
  background: var(--s2);
  color: var(--tp);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  /* 13px, the app's size, on a 1160px-wide window */
  font-size: clamp(7px, 1.12cqw, 13px);
  line-height: 1.3;
  text-align: left;
  user-select: none;
  -webkit-font-smoothing: auto;
}

.ic {
  width: 1.3em;
  height: 1.3em;
  flex: none;
}

/* ── Top bar ─────────────────────────────────────────── */

.topbar {
  display: flex;
  height: 2.9em;
  align-items: center;
  gap: 0.2em;
  border-bottom: 1px solid var(--bd);
  background: var(--s1);
  padding: 0 0.8em;
  color: var(--ts);
}

.tb {
  display: grid;
  width: 2em;
  height: 2em;
  place-items: center;
}

.sep {
  width: 1px;
  height: 1.3em;
  margin: 0 0.4em;
  background: var(--bd);
}

.bms {
  display: flex;
  gap: 0.3em;
  overflow: hidden;
}

.bm {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  border-radius: 0.45em;
  padding: 0.35em 0.6em;
  color: var(--tp);
  white-space: nowrap;
}

.bm.on {
  background: var(--s0);
}

/* ── Sidebar ─────────────────────────────────────────── */

.body {
  display: grid;
  grid-template-columns: 15em minmax(0, 1fr);
  min-height: 0;
}

.side {
  border-right: 1px solid var(--bd);
  background: var(--s1);
}

/* The sources (Sidebar.vue .hd): as tall as the folder header, the open
   one underlined */
.drives {
  display: flex;
  height: 3.55em;
  box-sizing: border-box;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--bd);
  padding: 0 0.45em;
  color: var(--ts);
}

.dr {
  position: relative;
  display: grid;
  width: 2.8em;
  height: 2.3em;
  place-items: center;
}

.dr .ic {
  width: 1.38em;
  height: 1.38em;
}

.dr .hm {
  font-size: 1.38em;
}

.dr.on {
  color: var(--tp);
}

.dr.on::after {
  position: absolute;
  right: 0.6em;
  bottom: -0.6em;
  left: 0.6em;
  height: 2px;
  border-radius: 1px;
  background: var(--tp);
  content: "";
}

.tree {
  margin: 0;
  padding: 0.45em 0.45em;
  list-style: none;
}

/* TreeRow.vue: 28px rows */
.tree li {
  display: flex;
  height: 2.15em;
  align-items: center;
  gap: 0.35em;
  border-radius: 0.45em;
  padding: 0 0.4em;
  white-space: nowrap;
}

.tree .sel {
  background: var(--acc-bg);
  color: var(--acc-tx);
}

.tw {
  display: inline-block;
  width: 1em;
  height: 1em;
  flex: none;
  color: var(--tm);
}

/* ── The compact folder header (FolderHeader.vue, Breadcrumbs.vue) ── */

.main {
  position: relative;
  display: grid;
  grid-template-rows: auto 1fr;
  min-width: 0;
}

.fh {
  display: flex;
  height: 3.55em;
  align-items: center;
  gap: 0.3em;
  border-bottom: 1px solid var(--bd);
  /* Gray like the window's other panels (the app's gray panels) */
  background: var(--s1);
  padding: 0 1.25em;
}

.bc {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.3em;
  margin-right: auto;
  overflow: hidden;
  color: var(--tm);
  white-space: nowrap;
}

.chev {
  width: 0.92em;
  height: 0.92em;
  flex: none;
}

/* ~ as the app draws it (HomeGlyph.vue): mono, a touch larger */
.hm {
  position: relative;
  border-radius: 0.3em;
  padding: 0 0.15em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 1.08em;
  line-height: 1;
}

.cl {
  width: 1.3em;
  height: 1.3em;
  flex: none;
}

/* The browser's storage in the path: 14px in the app's 12px row */
.db {
  width: 1.1em;
  height: 1.1em;
  flex: none;
}

.cur {
  overflow: hidden;
  color: var(--tp);
  font-weight: 500;
  text-overflow: ellipsis;
}

.acts {
  display: flex;
  flex: none;
  align-items: center;
  gap: 0.3em;
  color: var(--ts);
}

/* The view button while its menu is open (IconButton .on) */
.act.on {
  border: 1px solid var(--bd);
  background: var(--s0);
}

.pair {
  position: relative;
  display: flex;
  gap: 0.3em;
  border-radius: 0.45em;
}

.act {
  position: relative;
  box-sizing: border-box;
  display: grid;
  width: 2.3em;
  height: 2.3em;
  place-items: center;
  border-radius: 0.45em;
}

.act .ic {
  width: 1.4em;
  height: 1.4em;
}

.crow {
  display: flex;
  min-height: 0;
}

.content {
  flex: 1;
  min-width: 0;
  position: relative;
  min-height: 0;
  overflow: hidden;
}

/* ── ⑥ the corner ────────────────────────────────────── */

.grip {
  position: absolute;
  right: 0.5em;
  bottom: 0.5em;
  width: 1.4em;
  height: 1.4em;
  background:
    linear-gradient(135deg, transparent 45%, rgb(0 0 0 / 0.28) 45% 52%, transparent 52% 64%, rgb(0 0 0 / 0.28) 64% 71%, transparent 71%);
}

.grip :deep(.mk-grip) {
  right: calc(100% + 0.4rem);
  bottom: 0;
  left: auto;
  translate: 0 0;
}

/* ── Narrow: zoom into the folder ────────────────────── */

@container (max-width: 760px) {
  .win {
    font-size: clamp(8.5px, 2.15cqw, 13px);
  }

  .bms,
  .side {
    display: none;
  }

  .body {
    grid-template-columns: minmax(0, 1fr);
  }
}
/* A tablet keeps its sidebar at this width (the app: 640px and wider) */
@container (max-width: 760px) {
  .keep .win {
    font-size: clamp(7px, 1.7cqw, 13px);
  }

  .keep .side {
    display: block;
  }

  .keep .body {
    grid-template-columns: 15em minmax(0, 1fr);
  }
}

</style>
