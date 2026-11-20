<!-- The app icon's five shapes: upright in a row, or together as the icon.
     Drawn in the icon's own geometry (public/app-icon.png, 1024 × 1024),
     each around its own centre; two transforms per shape place it, and CSS
     moves between them. The parent decides when (Finale.vue, the download
     page). -->
<script setup lang="ts">
defineProps<{ together: boolean }>();

/** In the row: upright, each about 400 units, evenly spaced. In the icon:
 *  its place (the icon sits in the middle of the 3000-wide drawing) */
const shapes = [
  { key: "line", row: "translate(300px, 550px) scale(0.36)", icon: "translate(1414px, 485px) rotate(-38.6deg)" },
  { key: "rect", row: "translate(900px, 550px) scale(1.45)", icon: "translate(1495px, 215px) rotate(-23.7deg)" },
  { key: "square", row: "translate(1500px, 550px) scale(1.4)", icon: "translate(1188px, 573px) rotate(-10.7deg)" },
  { key: "circle", row: "translate(2100px, 550px) scale(1.3)", icon: "translate(1780px, 473px)" },
  { key: "arc", row: "translate(2700px, 520px) scale(0.75)", icon: "translate(1457px, 763px) rotate(-21deg)" },
] as const;
</script>

<template>
  <svg viewBox="0 0 3000 1100" class="shapes" aria-hidden="true" focusable="false">
    <g v-for="s in shapes" :key="s.key" class="sh" :style="{ transform: together ? s.icon : s.row }">
      <line v-if="s.key === 'line'" x1="0" y1="-554" x2="0" y2="554" stroke="#2194f8" :style="{ strokeWidth: together ? 32 : 220 }" />
      <rect v-else-if="s.key === 'rect'" x="-138" y="-83.5" width="276" height="167" fill="#6044d9" />
      <rect v-else-if="s.key === 'square'" x="-128.5" y="-109.5" width="257" height="219" fill="#21f885" />
      <circle v-else-if="s.key === 'circle'" r="143" fill="#f82194" />
      <path v-else d="M -274 0 C -210 95, 150 110, 274 0" fill="none" stroke="#f5ef24" :style="{ strokeWidth: together ? 70 : 150 }" />
    </g>
  </svg>
</template>

<style scoped>
.shapes {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.sh {
  transition: transform 1.6s cubic-bezier(0.45, 0, 0.25, 1);
}

/* The line and the arc: thicker in the row, where they are drawn smaller,
   so they weigh as much as the others; the icon's own width in the icon */
.sh line,
.sh path {
  transition: stroke-width 1.6s cubic-bezier(0.45, 0, 0.25, 1);
}
</style>
