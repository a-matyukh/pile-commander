<template>
  <div
    class="overflow-hidden rounded-2xl border border-[var(--pc-gray-border)] bg-white shadow-[0_24px_60px_-28px_rgba(15,23,42,0.28)]"
    aria-hidden="true"
  >
    <div class="flex items-center gap-2 border-b border-[var(--pc-gray-border)] bg-[var(--pc-gray-header)] px-3 py-2.5">
      <span class="size-2 rounded-full bg-slate-300" />
      <span class="size-2 rounded-full bg-slate-300" />
      <span class="size-2 rounded-full bg-slate-300" />
      <span class="ml-2 text-xs font-medium text-slate-500">Research</span>
    </div>

    <div
      class="relative aspect-[16/11] min-h-[260px] overflow-hidden"
      style="background: linear-gradient(160deg, hsl(215 40% 97%) 0%, hsl(210 36% 94%) 100%)"
    >
      <div
        class="absolute top-5 left-5 w-[38%] max-w-[200px] rotate-[-2deg] rounded-lg border border-amber-200/80 bg-[#fff7d6] p-3 shadow-sm"
      >
        <p class="text-[11px] leading-snug text-amber-950/80">
          Mood for the opening — warm light, quiet room, one object on the table.
        </p>
      </div>

      <div
        class="absolute top-6 right-[8%] w-[32%] max-w-[170px] overflow-hidden rounded-xl border border-[var(--pc-gray-border)] bg-white shadow-sm"
      >
        <div
          class="h-16"
          style="background: linear-gradient(135deg, #7dd3fc 0%, #38bdf8 40%, #2182f8 100%)"
        />
        <div class="px-2.5 py-2">
          <p class="text-[11px] font-medium text-slate-700">Harbor morning</p>
        </div>
      </div>

      <div
        class="absolute top-[42%] left-[28%] w-[26%] max-w-[140px] rounded-xl border border-[var(--pc-gray-border)] bg-white p-2.5 shadow-sm"
      >
        <div class="mb-2 flex size-8 items-center justify-center rounded-lg bg-pc-50 text-pc-600">
          <UIcon name="i-lucide-folder" class="size-4" />
        </div>
        <p class="text-[11px] font-medium text-slate-700">References</p>
        <p class="text-[10px] text-slate-500">12 items</p>
      </div>

      <div
        class="absolute right-[14%] bottom-[22%] w-[36%] max-w-[190px] rotate-[1.5deg] rounded-lg border border-sky-100 bg-white p-3 shadow-sm"
      >
        <p class="text-[11px] leading-snug text-slate-600">
          Keep the live version on this board. Share the link when the pile feels ready.
        </p>
      </div>

      <svg
        class="pointer-events-none absolute inset-0 size-full text-pc-400/70"
        viewBox="0 0 400 280"
        fill="none"
      >
        <path
          d="M168 138 C 210 138, 230 168, 248 188"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-dasharray="4 3"
        />
        <polygon points="248,188 241,182 246,176" fill="currentColor" />
      </svg>
    </div>

    <div
      class="flex items-center gap-2 border-t border-[var(--pc-gray-border)] bg-[var(--pc-gray-header)] px-3 py-2"
    >
      <span
        class="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-slate-700 shadow-sm ring-1 ring-[var(--pc-gray-border)]"
      >
        <UIcon name="i-lucide-layout-grid" class="size-3 text-pc-500" />
        Start
      </span>
      <span class="rounded-md bg-white px-2 py-1 text-[11px] font-medium text-slate-800 shadow-sm ring-1 ring-pc-200">
        Research
      </span>
      <span class="rounded-md px-2 py-1 text-[11px] text-slate-500">Notes</span>
    </div>
  </div>
</template>
