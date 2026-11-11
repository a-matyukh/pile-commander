<script setup lang="ts">
useSeoMeta({
  title: "File manager with unusual possibilities",
  description:
    "Folders that open as a list, a grid, a board, a canvas, a space in 3D, a stack, a tiled wall, or slides. On your computer for free, or in the cloud to invite people and publish.",
  ogTitle: "Pile Commander — File manager with unusual possibilities",
  ogDescription:
    "One folder, eight ways to look at it. Files stay ordinary files; the board is just how you arrange them.",
  ogImage: "/app-icon.png",
  twitterCard: "summary",
});
</script>

<template>
  <div>
    <HeroSection />

    <FeatureSection
      eyebrow="Eight views"
      title="One folder. Eight ways to look at it."
      lede="Every folder remembers its own view. Switch whenever the work changes — the files stay put, only the way of looking moves. Two classic file-manager views, List and Gallery; three spatial ones, Board, Canvas and 3D; and three based on sorting, Stack, Masonry and Slides."
      muted
    >
      <HomeViewSwitcher />
    </FeatureSection>

    <HomeFolder3d />

    <HomeFilesStayFiles />
    <HomeWhatLivesHere />
    <HomeCanvasTools />
    <HomeAiTools />
    <HomeSharePublish />
    <HomeWhereItLives />
    <HomeFolderSync />
    <HomeAnyDevice />
    <HomeStartCta />
    <HomeTryDemos />
    <HomeUnderTheHood />
  </div>
</template>
