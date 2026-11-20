<!-- The home page: the landing built block by block (it lived at /final
     while it was made; the previous home page is /old). Indexed or not as
     NUXT_PUBLIC_ALLOW_INDEXING says, like the rest of the site.

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
       8 Source available: the repository -->
<script setup lang="ts">
definePageMeta({ layout: "final", blocks: true });

useHead({ titleTemplate: null });
useSeoMeta({
  title: "Pile Commander. File manager. Creative space.",
  description:
    "A file manager for your home folder and the cloud, where files and folders are not boring.",
  ogTitle: "Pile Commander. File manager. Creative space.",
  ogDescription:
    "A file manager for your home folder and the cloud, where files and folders are not boring.",
  ogImage: "/app-icon.png",
  twitterCard: "summary",
});
</script>

<template>
  <div>
    <FinalIntro />
    <FinalViews />
    <FinalAlive />
    <FinalAi />
    <FinalSync />
    <FinalShare />
    <FinalDevices />
    <FinalYours />
    <FinalCode />
    <FinalFinale />
  </div>
</template>
