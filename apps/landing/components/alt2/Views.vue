<!-- ① Nine views. The order is the app's view menu (Widget.ts FOLDER_VIEWS). -->
<script setup lang="ts">
const facts = [
  { title: "Classic", text: "List and Gallery, like any file manager." },
  { title: "By hand", text: "Board, Canvas and 3D: put things where you want them." },
  { title: "In order", text: "Stack, Masonry, Dashboard and Slides line things up for you." },
];
</script>

<template>
  <Alt2Section
    id="views"
    :n="1"
    label="Views"
    title="One folder, nine ways to see it."
    lede="Each folder remembers its own view, and switching never moves a file. List and Gallery work like any file manager. On a Board, a Canvas or in 3D you place things by hand. Stack, Masonry, Dashboard and Slides keep them in order."
    :facts="facts"
    alt
  >
    <Alt2ViewsScene />
  </Alt2Section>
</template>
