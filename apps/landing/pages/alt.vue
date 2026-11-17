<!-- The alternative landing, "From a pile to order". Not linked from the site
     and never indexed, whatever NUXT_PUBLIC_ALLOW_INDEXING says. -->
<script setup lang="ts">
definePageMeta({ layout: "alt" });

useSeoMeta({
  title: "Make sense of the pile",
  description:
    "A file manager that opens any folder as a board. Arrange it by hand, or connect an AI model to name and sort the files. They stay ordinary files.",
  robots: "noindex, nofollow",
});
</script>

<template>
  <div>
    <AltHero />
    <AltSee />
    <AltTidy />
    <AltMake />
    <AltFiles />
    <AltStart />
  </div>
</template>
