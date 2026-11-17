<!-- One of the app icon's five shapes, in its own colour. Sized by font-size
     (1em square) or by a width set from outside. As in the icon each lies at
     its own angle; `tidy` stands it upright, for the row that ends the page. -->
<script setup lang="ts">
defineProps<{ kind: "line" | "rect" | "square" | "circle" | "arc"; tidy?: boolean }>();
</script>

<template>
  <svg class="shape" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      v-if="kind === 'line'"
      :d="tidy ? 'M12 2 L12 22' : 'M3 2 L21 22'"
      fill="none"
      stroke="var(--alt-blue)"
      stroke-width="2.4"
    />
    <rect
      v-else-if="kind === 'rect'"
      x="2.5"
      y="7"
      width="19"
      height="10"
      fill="var(--alt-purple)"
      :transform="tidy ? undefined : 'rotate(-23 12 12)'"
    />
    <rect
      v-else-if="kind === 'square'"
      x="4"
      y="4"
      width="16"
      height="16"
      fill="var(--alt-green)"
      :transform="tidy ? undefined : 'rotate(-11 12 12)'"
    />
    <circle v-else-if="kind === 'circle'" cx="12" cy="12" r="10" fill="var(--alt-pink)" />
    <path
      v-else
      :d="tidy ? 'M3.5 8 Q 12 22 20.5 8' : 'M3 15.5 Q 15.5 20.5 21 9'"
      fill="none"
      stroke="var(--alt-yellow)"
      stroke-width="3.2"
    />
  </svg>
</template>

<style scoped>
.shape {
  display: block;
  width: 1em;
  height: 1em;
  flex-shrink: 0;
  overflow: visible;
}
</style>
