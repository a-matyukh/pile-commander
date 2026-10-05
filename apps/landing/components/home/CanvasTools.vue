<script setup lang="ts">
// Same tools, hotkeys and pen colours as the Canvas toolbar in the app.
const tools = [
  { key: "H", label: "Hand", icon: "i-lucide-hand" },
  { key: "S", label: "Select", icon: "i-lucide-mouse-pointer-2" },
  { key: "L", label: "Lasso", icon: "i-lucide-lasso" },
  { key: "C", label: "Connect", icon: "i-lucide-spline" },
  { key: "D", label: "Disconnect", icon: "i-lucide-unlink" },
  { key: "P", label: "Pen", icon: "i-lucide-pen-line" },
  { key: "E", label: "Eraser", icon: "i-lucide-eraser" },
];

const swatches = ["#111827", "#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899"];

const points = [
  "Connectors with arrows, a label in the middle, and an Animated style",
  "A pen in eight colours — or any colour, at any width",
  "Zoom from 20% to 400%. Fit to view. Pinch on a touch screen",
];
</script>

<template>
  <section class="bg-slate-950 px-5 py-20 text-white md:py-28">
    <div class="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1fr_1.3fr]">
      <div>
        <p class="mb-3 text-xs font-semibold tracking-[0.08em] text-pc-300 uppercase">Canvas</p>
        <h2 class="text-3xl tracking-tight md:text-4xl">When a pile needs a map.</h2>
        <p class="mt-4 text-base leading-relaxed text-slate-300 md:text-[17px]">
          Switch any folder to Canvas and it becomes an infinite surface. Draw
          between things, connect them, and keep both hands on the keyboard.
        </p>

        <ul class="mt-8 list-none space-y-3 p-0">
          <li v-for="point in points" :key="point" class="flex gap-3 text-sm leading-relaxed text-slate-300">
            <UIcon name="i-lucide-check" class="mt-0.5 size-4 shrink-0 text-pc-400" />
            {{ point }}
          </li>
        </ul>

        <ul class="mt-8 grid list-none grid-cols-4 gap-2 p-0 sm:grid-cols-7">
          <li
            v-for="tool in tools"
            :key="tool.key"
            class="flex flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-1 py-2.5"
          >
            <kbd
              class="flex size-7 items-center justify-center rounded-md border border-white/20 border-b-2 bg-white/10 font-sans text-sm font-semibold text-white"
            >
              {{ tool.key }}
            </kbd>
            <span class="text-[11px] text-slate-400">{{ tool.label }}</span>
          </li>
        </ul>
      </div>

      <!-- Canvas mock -->
      <div
        class="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 bg-[var(--pc-gray-surface)] shadow-[0_30px_80px_-30px_rgba(33,130,248,0.45)]"
        aria-hidden="true"
      >
        <div class="home-dots absolute inset-0" />
        <!-- axes -->
        <span class="absolute top-0 bottom-0 left-[18%] w-px bg-pc-200" />
        <span class="absolute top-[70%] right-0 left-0 h-px bg-pc-200" />

        <!-- toolbar -->
        <div
          class="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-xl bg-white p-1 shadow-md ring-1 ring-[var(--pc-gray-border)]"
        >
          <span
            v-for="tool in tools"
            :key="tool.key"
            class="flex size-7 items-center justify-center rounded-lg"
            :class="tool.key === 'P' ? 'bg-pc-500 text-white' : 'text-slate-500'"
          >
            <UIcon :name="tool.icon" class="size-3.5" />
          </span>
          <span class="mx-1 h-5 w-px bg-[var(--pc-gray-border)]" />
          <span class="hidden items-center gap-1 pr-1 sm:flex">
            <span
              v-for="c in swatches"
              :key="c"
              class="size-3.5 rounded-full"
              :class="c === '#ef4444' ? 'ring-2 ring-offset-1 ring-red-300' : ''"
              :style="{ background: c }"
            />
          </span>
        </div>

        <svg class="absolute inset-0 size-full" viewBox="0 0 400 300" fill="none">
          <defs>
            <marker id="home-canvas-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill="#2182f8" />
            </marker>
          </defs>
          <!-- connector -->
          <path
            class="home-dash"
            d="M 138 128 C 190 128, 200 196, 252 196"
            stroke="#2182f8"
            stroke-width="1.6"
            stroke-dasharray="6 4"
            marker-end="url(#home-canvas-arrow)"
          />
          <!-- ink -->
          <path
            class="home-ink"
            d="M 262 70 C 300 52, 360 62, 356 96 C 352 128, 290 132, 268 112 C 252 98, 258 82, 272 76"
            stroke="#ef4444"
            stroke-width="3"
            stroke-linecap="round"
            pathLength="100"
          />
        </svg>

        <!-- label on the connector -->
        <span
          class="absolute top-[53%] left-[47%] -translate-x-1/2 -translate-y-1/2 rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-pc-700 shadow-sm ring-1 ring-pc-200"
        >
          sets the tone
        </span>

        <!-- nodes -->
        <div class="absolute top-[30%] left-[8%] w-[27%] -rotate-1 rounded-lg border border-amber-200/80 bg-[#fff7d6] p-2.5 shadow-sm">
          <p class="text-[11px] leading-snug text-amber-950/80">Mood — warm light, quiet room.</p>
        </div>
        <div class="absolute top-[56%] left-[63%] w-[28%] overflow-hidden rounded-xl border border-[var(--pc-gray-border)] bg-white shadow-sm">
          <div class="h-10 bg-[linear-gradient(180deg,#bae6fd_0%,#7dd3fc_45%,#2182f8_100%)]" />
          <p class="px-2 py-1 text-[11px] font-medium text-slate-700">Harbor morning</p>
        </div>
        <div class="absolute top-[22%] left-[68%] text-[11px] font-medium text-red-500">
          this one
        </div>

        <!-- zoom -->
        <div
          class="absolute right-3 bottom-3 flex items-center gap-2 rounded-lg bg-white px-2 py-1 text-[11px] text-slate-500 shadow-sm ring-1 ring-[var(--pc-gray-border)]"
        >
          <UIcon name="i-lucide-minus" class="size-3" />
          <span class="font-medium tabular-nums text-slate-700">120%</span>
          <UIcon name="i-lucide-plus" class="size-3" />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-dots {
  background-image: radial-gradient(hsl(215 25% 80%) 1px, transparent 1px);
  background-size: 18px 18px;
}

.home-ink {
  stroke-dasharray: 100;
}

@media (prefers-reduced-motion: no-preference) {
  .home-dash {
    animation: home-dash 1s linear infinite;
  }

  .home-ink {
    animation: home-ink 5s ease-in-out infinite;
  }
}

@keyframes home-dash {
  to {
    stroke-dashoffset: -10;
  }
}

@keyframes home-ink {
  0% {
    stroke-dashoffset: 100;
  }
  40%, 85% {
    stroke-dashoffset: 0;
  }
  100% {
    stroke-dashoffset: 100;
  }
}
</style>
