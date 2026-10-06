<script setup lang="ts">
const { clientUrl, demoUrl, desktopAppLink } = useAppLinks();

const demoOpen = ref(false);
const demoVideo = useTemplateRef<HTMLVideoElement>("demoVideo");
// Served from apps/landing/public/demo.mp4. Bound as a string so Vite
// does not try to import the file before it is there.
const demoVideoSrc = "/demo.mp4";

function playDemo() {
  demoVideo.value?.play().catch(() => {});
}

function stopDemo() {
  const video = demoVideo.value;
  if (!video) return;
  video.pause();
  video.currentTime = 0;
}
</script>

<template>
  <section class="px-5 pt-16 pb-10 md:pt-24 md:pb-16">
    <div class="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
      <div>
        <!-- <p class="mb-4 text-xs font-semibold tracking-[0.08em] text-pc-600 uppercase">
          Pile Commander
        </p> -->
        <h1 class="text-4xl leading-[1.1] tracking-tight text-slate-900 md:text-4xl lg:text-[3rem]">
			File manager<br> with unusual possibilities
        </h1>
        <p class="mt-5 max-w-lg text-base leading-relaxed text-slate-600 md:text-lg">
			Cross-platform desktop and web application with responsive UI, where folders with files can serve as whiteboards or other types of views, and be stored locally or in the cloud for real-time collaboration and publishing
        </p>
        <div class="mt-8 flex flex-wrap items-center gap-3">
          <UButton
            v-bind="desktopAppLink"
            color="primary"
            size="lg"
          >
            Download desktop app
          </UButton>
          <UButton
            :href="clientUrl"
            target="_blank"
            rel="noopener noreferrer"
            color="neutral"
            variant="outline"
            size="lg"
          >
            Open web app
          </UButton>
          <UButton
            :href="demoUrl"
            target="_blank"
            rel="noopener noreferrer"
            color="neutral"
            variant="outline"
            size="lg"
          >
            Try a web demo
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            size="lg"
            @click="() => { demoOpen = true }"
          >
            Watch demo video (0:52)
          </UButton>
        </div>
        <a
          href="https://www.producthunt.com/products/pile-commander?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-pile-commander-2"
          target="_blank"
          rel="noopener noreferrer"
          class="mt-6 inline-block"
        >
          <img
            alt="Pile Commander 2 - File manager with unusual possibilities | Product Hunt"
            width="250"
            height="54"
            src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1271850&theme=light&t=1791307934463"
          >
        </a>
      </div>
      <DemoFrame />
    </div>

    <UModal
      v-model:open="demoOpen"
      title="Demo"
      :ui="{ content: 'max-w-3xl' }"
      @after:enter="playDemo"
      @after:leave="stopDemo"
    >
      <template #body>
        <video
          ref="demoVideo"
          class="aspect-video w-full rounded-lg bg-black"
          controls
          playsinline
          preload="metadata"
          poster="/demo-poster.jpg"
          :src="demoVideoSrc"
        />
      </template>
    </UModal>
  </section>
</template>
