<!-- The folder's view menu as the app draws it (ViewMenu.vue, MenuItem.vue,
     menu.css): a header, the nine views with their icons and colours, a
     check on the current one. Open under the view button, its right edge on
     the button's. The visitor can pick a view, as in the app. Sizes are in em
     of the window (13px in the app). -->
<script setup lang="ts">
import { FOLDER_VIEWS, type ViewId } from "~/utils/finalFolder";

defineProps<{ current: ViewId }>();
const emit = defineEmits<{ pick: [view: ViewId] }>();
</script>

<template>
  <div class="mn" role="menu" aria-label="Folder view">
    <div class="mh">Folder view</div>
    <button
      v-for="v in FOLDER_VIEWS"
      :key="v.id"
      type="button"
      role="menuitemradio"
      class="mi"
      :aria-checked="v.id === current"
      @click="emit('pick', v.id)"
    >
      <UIcon :name="v.icon" class="ic" :style="{ color: v.color ?? undefined }" />
      <span class="lb">{{ v.label }}</span>
      <UIcon v-if="v.id === current" name="i-tabler-check" class="ck" />
    </button>
  </div>
</template>

<style scoped>
/* menu.css .mn: 250px wide, white, a thin border, 8px corners, 4px padding,
   the "Menu shadow" setting on */
.mn {
  width: 19.25em;
  box-sizing: border-box;
  border: 1px solid rgb(0 0 0 / 0.15);
  border-radius: 0.62em;
  background: #fff;
  padding: 0.31em;
  box-shadow: 0 0.62em 1.85em rgb(0 0 0 / 0.1), 0 0.15em 0.46em rgb(0 0 0 / 0.06);
  color: #1f1f1e;
  font-size: 1em;
  user-select: none;
}

/* MenuLabel.vue .mh: as tall as an item, 11px, muted */
.mh {
  display: flex;
  min-height: 2.15em;
  align-items: center;
  padding: 0 0.62em;
  color: #9a9893;
  font-size: 0.846em;
}

/* MenuItem.vue .mi: 28px rows, 16px icons, the check in the accent */
.mi {
  display: flex;
  width: 100%;
  height: 2.15em;
  align-items: center;
  gap: 0.62em;
  border: 0;
  border-radius: 0.46em;
  background: none;
  padding: 0 0.62em;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.mi:hover,
.mi:focus-visible {
  background: #f8f8f7;
  outline: none;
}

.ic {
  width: 1.23em;
  height: 1.23em;
  flex: none;
  color: #5f5e5a;
}

.ck {
  width: 1.23em;
  height: 1.23em;
  flex: none;
  margin-left: auto;
  color: #185fa5;
}
</style>
