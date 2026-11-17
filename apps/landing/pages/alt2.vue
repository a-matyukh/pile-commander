<!-- The third landing, "A file manager. The next generation.": six things
     a file manager can do now, one section each. Not linked from the site
     and never indexed, whatever NUXT_PUBLIC_ALLOW_INDEXING says. -->
<script setup lang="ts">
definePageMeta({ layout: "alt2" });

useSeoMeta({
  title: "The next-generation file manager",
  description:
    "Nine ways to see a folder, AI with your own model or agent, a cloud copy of any folder to share or publish, on a computer, a tablet and a phone. On your disk, files stay ordinary files.",
  robots: "noindex, nofollow",
});
</script>

<template>
  <div>
    <Alt2Hero />
    <Alt2Views />
    <Alt2Ai />
    <Alt2Sync />
    <Alt2Share />
    <Alt2Devices />
    <Alt2Disk />
    <Alt2Start />
  </div>
</template>
