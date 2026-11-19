<!-- The final landing, built block by block. Not linked from the site and
     never indexed, whatever NUXT_PUBLIC_ALLOW_INDEXING says, until it
     replaces the home page.

     The blocks, in order (each lands as its own component):
       0 Intro: the pitch
       1 Nine views
       2 Files and folders that aren't boring: icons, previews, covers,
         layers, shapes, the pen
       3 AI with a folder and its files
       4 Sync and cloud folders
       5 Share: a .pile file, a shared cloud folder, a public link, the Hub
       6 Any screen, even only in the browser
       7 Your files stay yours: on disk after uninstall; the cloud is encrypted
       8 Open source: the repository -->
<script setup lang="ts">
definePageMeta({ layout: "final" });

useSeoMeta({
  title: "File manager. Creative space.",
  description:
    "A file manager for your home folder and the cloud, where files and folders are not boring.",
  robots: "noindex, nofollow",
});
</script>

<template>
  <div>
    <FinalIntro />
  </div>
</template>
