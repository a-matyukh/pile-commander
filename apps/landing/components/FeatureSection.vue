<script setup lang="ts">
withDefaults(
  defineProps<{
    eyebrow?: string;
    title: string;
    lede?: string;
    muted?: boolean;
    badge?: string;
  }>(),
  { muted: false },
);
</script>

<template>
  <section
    class="px-5 py-20 md:py-28"
    :class="muted ? 'bg-[var(--pc-gray-muted)]' : 'bg-white'"
  >
    <div class="mx-auto max-w-6xl">
      <div class="max-w-2xl">
        <div v-if="eyebrow || badge" class="mb-3 flex flex-wrap items-center gap-2">
          <p
            v-if="eyebrow"
            class="text-xs font-semibold tracking-[0.08em] text-pc-600 uppercase"
          >
            {{ eyebrow }}
          </p>
          <span
            v-if="badge"
            class="rounded-md bg-pc-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-pc-700 uppercase"
          >
            {{ badge }}
          </span>
        </div>
        <h2 class="text-3xl tracking-tight text-slate-900 md:text-4xl">
          {{ title }}
        </h2>
        <p v-if="lede" class="mt-4 text-base leading-relaxed text-slate-600 md:text-[17px]">
          {{ lede }}
        </p>
      </div>
      <div class="mt-10">
        <slot />
      </div>
    </div>
  </section>
</template>
