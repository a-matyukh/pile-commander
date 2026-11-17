<!-- ④ Share, link, Hub. The step names are the app's Share menu
     (ShareMenu.vue): Share with…, Make a public folder, Publish on the Hub. -->
<script setup lang="ts">
const facts = [
  { title: "Share with…", text: "Invite people by email as editors or viewers. Everyone in the folder sees changes as they happen." },
  { title: "Make a public folder", text: "The folder gets its own link. Anyone can look, no account needed." },
  { title: "Publish on the Hub", text: "Add tags and a preview. People find it in the gallery and copy it to their own cloud." },
];
</script>

<template>
  <Alt2Section
    id="share"
    :n="4"
    label="Share"
    title="Share it. Link it. Put it on the Hub."
    lede="A cloud folder opens up one step at a time, and you choose each one. Invite people, make it a public folder with its own link, then publish it on the Hub, the public gallery of folders."
    :facts="facts"
    note="A folder on your computer is copied to the cloud first. A free account can list up to 3 folders on the Hub."
  >
    <Alt2ShareScene />
  </Alt2Section>
</template>
