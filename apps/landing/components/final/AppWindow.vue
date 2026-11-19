<!-- The desktop app's window, drawn after the app (apps/client/src/ui/explorer):
     the top bar with bookmarks, the sidebar with drives and the folder tree,
     and the compact folder header — the path in one row, ~ for the home
     folder (a cloud icon for the cloud), the open folder last — with the
     folder's buttons in the app's order for a folder of your own
     (FolderActions.vue): view, add, layers, AI, share, sync, more.
     The content goes in the default slot. It keeps the app's own palette and
     scales with its width (container units), like a screenshot.
     On a narrow screen it zooms into the folder: the sidebar and the
     bookmarks leave. -->
<script setup lang="ts">
export interface Crumb {
  /** home: ~ ; cloud: the cloud icon; otherwise the folder's name */
  glyph?: "home" | "cloud";
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

withDefaults(
  defineProps<{
    crumbs: Crumb[];
    title: string;
    viewIcon?: string;
    viewColor?: string;
    bookmarks?: TreeItem[];
    tree?: TreeItem[];
    /** which drive is open in the sidebar */
    drive?: "local" | "cloud";
    synced?: boolean;
    label?: string;
  }>(),
  {
    viewIcon: "i-tabler-template",
    viewColor: "#534ab7",
    bookmarks: () => [],
    tree: () => [],
    drive: "local",
    synced: true,
    label: undefined,
  },
);
</script>

<template>
  <div class="lf-frame shot" role="img" :aria-label="label">
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
            <span class="dr" :class="{ on: drive === 'local' }"><UIcon name="i-tabler-device-desktop" class="ic" /></span>
            <span class="dr" :class="{ on: drive === 'cloud' }"><UIcon name="i-tabler-cloud" class="ic" /></span>
            <span class="dr"><UIcon name="i-tabler-world" class="ic" /></span>
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
                <span v-else>{{ c.name }}</span>
              </template>
              <UIcon v-if="crumbs.length" name="i-tabler-chevron-right" class="chev" />
              <span class="cur">{{ title }}</span>
            </div>

            <div class="acts">
              <span class="act"><UIcon :name="viewIcon" class="ic" :style="{ color: viewColor }" /></span>
              <span class="act"><UIcon name="i-tabler-plus" class="ic" /></span>
              <span class="act"><UIcon name="i-tabler-stack-2" class="ic" /></span>
              <span class="act"><UIcon name="i-lucide-sparkles" class="ic" /></span>
              <span class="act"><UIcon name="i-tabler-share-2" class="ic" /></span>
              <span v-if="synced" class="act"><UIcon name="i-tabler-cloud-check" class="ic" /></span>
              <span class="act"><UIcon name="i-tabler-dots" class="ic" /></span>
            </div>
          </div>

          <div class="content">
            <slot />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shot {
  container-type: inline-size;
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
  padding: 0.6em 0.5em;
}

.drives {
  display: flex;
  justify-content: space-between;
  padding: 0.2em 0.5em 0.7em;
  color: var(--ts);
}

.dr {
  display: grid;
  width: 2.1em;
  height: 2.1em;
  place-items: center;
  border-radius: 0.45em;
}

.dr.on {
  background: var(--s0);
  color: var(--tp);
}

.tree {
  margin: 0;
  padding: 0;
  list-style: none;
}

.tree li {
  display: flex;
  align-items: center;
  gap: 0.35em;
  border-radius: 0.45em;
  padding: 0.45em 0.4em;
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
  background: var(--s2);
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
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 1.08em;
  line-height: 1;
}

.cl {
  width: 1.3em;
  height: 1.3em;
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

.act {
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

.content {
  position: relative;
  min-height: 0;
  overflow: hidden;
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
</style>
