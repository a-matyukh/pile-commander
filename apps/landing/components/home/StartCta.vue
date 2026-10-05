<script setup lang="ts">
const { clientUrl, demoUrl, desktopAppLink } = useAppLinks();

const platforms = [
  { icon: "i-lucide-laptop", name: "macOS", note: "Apple silicon and Intel" },
  { icon: "i-lucide-monitor", name: "Windows", note: "Desktop app" },
  { icon: "i-lucide-terminal", name: "Linux", note: "Desktop app" },
  { icon: "i-lucide-globe", name: "Web", note: "Any modern browser" },
];

const steps = [
  { title: "Open a folder or the demo", body: "Any folder in the desktop app, or the demo workspace in the browser." },
  { title: "Arrange it", body: "Pick a view, drop things in, write where the idea belongs." },
  { title: "Invite or publish", body: "Sign in when you want people in it, or a link to it." },
];
</script>

<template>
  <section class="px-5 py-20 md:py-28">
    <div
      class="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-pc-950 px-6 py-12 text-white md:px-12 md:py-16"
    >
      <div
        class="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(hsl(215_60%_60%/.35)_1px,transparent_1px)] [background-size:22px_22px]"
        aria-hidden="true"
      />
      <div
        class="pointer-events-none absolute -top-40 -right-32 size-[28rem] rounded-full bg-pc-500/40 blur-3xl"
        aria-hidden="true"
      />

      <div class="relative grid gap-12 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <h2 class="text-3xl tracking-tight md:text-5xl">Start with a folder.</h2>
          <p class="mt-4 max-w-md text-base leading-relaxed text-pc-100/80">
            Everything on your computer is free and needs no account. The
            desktop app updates itself and opens .pile archives.
          </p>
          <div class="mt-8 flex flex-wrap items-center gap-3">
            <UButton v-bind="desktopAppLink" color="primary" size="lg" icon="i-lucide-download">
              Download desktop app
            </UButton>
            <UButton
              :href="clientUrl"
              target="_blank"
              rel="noopener noreferrer"
              color="neutral"
              variant="solid"
              size="lg"
              class="bg-white text-slate-900 hover:bg-pc-50"
            >
              Open web app
            </UButton>
            <UButton
              :href="demoUrl"
              target="_blank"
              rel="noopener noreferrer"
              color="neutral"
              variant="ghost"
              size="lg"
              class="text-white hover:bg-white/10"
              trailing-icon="i-lucide-arrow-right"
            >
              Try a web demo
            </UButton>
          </div>

          <ul class="mt-10 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-4">
            <li
              v-for="p in platforms"
              :key="p.name"
              class="rounded-xl border border-white/10 bg-white/5 px-3 py-3"
            >
              <UIcon :name="p.icon" class="size-4 text-pc-300" />
              <p class="mt-2 text-sm font-semibold">{{ p.name }}</p>
              <p class="text-[11px] text-pc-100/60">{{ p.note }}</p>
            </li>
          </ul>
        </div>

        <ol class="list-none space-y-3 self-center p-0">
          <li
            v-for="(step, i) in steps"
            :key="step.title"
            class="flex gap-4 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm"
          >
            <span
              class="flex size-8 shrink-0 items-center justify-center rounded-full bg-pc-500 text-sm font-semibold"
            >
              {{ i + 1 }}
            </span>
            <div>
              <h3 class="text-base font-semibold">{{ step.title }}</h3>
              <p class="mt-1 text-sm leading-relaxed text-pc-100/70">{{ step.body }}</p>
            </div>
          </li>
        </ol>
      </div>
    </div>
  </section>
</template>
