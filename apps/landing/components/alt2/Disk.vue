<!-- ⑥ Your disk. Views and layout live in the files' extended attributes and
     a hidden .pile folder; bookmarks, settings and AI keys live with the app
     on the device (README.md, FilesStayFiles.vue). -->
<script setup lang="ts">
const facts = [
  { title: "Plain files", text: "A note is a .md file, a picture is a picture. Rename one in Finder or Explorer and the board follows." },
  { title: "No lock-in", text: "No library to import into, no database to migrate, nothing to export." },
  { title: "Kept by the app", text: "Bookmarks, settings and AI keys stay with the app on this device." },
];
</script>

<template>
  <Alt2Section
    id="disk"
    :n="6"
    label="Your disk"
    title="Your files stay yours. Even without the app."
    lede="On your computer, Pile Commander opens real folders. Views and layout are written into the files and a small .pile folder beside them, so if you delete the app, everything stays in your folders. Install it again, and every board is where you left it."
    :facts="facts"
  >
    <Alt2DiskScene />
  </Alt2Section>
</template>
