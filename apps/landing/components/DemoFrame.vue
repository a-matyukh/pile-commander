<script setup lang="ts">
const { clientUrl, demoUrl } = useAppLinks();

const live = ref(false);
const giveUp = ref(false);

let clientOrigin = "";
try {
  clientOrigin = new URL(clientUrl).origin;
} catch {
  clientOrigin = "";
}

onMounted(() => {
  if (!clientOrigin) {
    giveUp.value = true;
    return;
  }

  const onMessage = (event: MessageEvent) => {
    if (giveUp.value || event.origin !== clientOrigin) return;
    const data = event.data;
    if (
      data == null
      || typeof data !== "object"
      || !("source" in data)
      || !("type" in data)
      || data.source !== "pile-commander"
      || data.type !== "demo-embed-ready"
    ) {
      return;
    }
    live.value = true;
  };

  window.addEventListener("message", onMessage);
  const timeout = window.setTimeout(() => {
    if (!live.value) giveUp.value = true;
  }, 8000);

  onUnmounted(() => {
    window.removeEventListener("message", onMessage);
    window.clearTimeout(timeout);
  });
});
</script>

<template>
  <div class="relative min-h-[22rem] md:min-h-[32rem]">
    <ProductFrame v-if="!live" />

    <div
      class="overflow-hidden rounded-2xl border border-[var(--pc-gray-border)] bg-white shadow-[0_24px_60px_-28px_rgba(15,23,42,0.28)]"
      :class="live ? 'relative' : 'pointer-events-none invisible absolute inset-0'"
      :aria-hidden="live ? undefined : 'true'"
    >
      <div
        class="flex items-center gap-2 border-b border-[var(--pc-gray-border)] bg-[var(--pc-gray-header)] px-3 py-2.5"
      >
		<span class="size-2 rounded-full bg-slate-300" />
        <span class="size-2 rounded-full bg-slate-300" />
        <span class="size-2 rounded-full bg-slate-300" />
		<span class="ml-2 text-xs font-medium text-slate-500">Demo</span>
        <a
          :href="demoUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="ml-auto text-xs font-medium text-slate-500 no-underline hover:text-slate-800"
        >
          Open in new tab
        </a>
      </div>
      <div class="relative min-h-[22rem] bg-white md:min-h-[32rem]">
        <ClientOnly>
          <iframe
            v-if="clientOrigin && (!giveUp || live)"
            :src="demoUrl"
            title="Pile Commander demo"
            class="absolute inset-0 size-full border-0"
            referrerpolicy="strict-origin-when-cross-origin"
          />
        </ClientOnly>
      </div>
    </div>
  </div>
</template>
