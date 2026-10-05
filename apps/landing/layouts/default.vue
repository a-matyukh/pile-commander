<template>
  <div class="flex min-h-dvh flex-col bg-[var(--pc-gray-surface)] text-slate-800">
    <SiteHeader />
    <main class="flex-1">
      <slot />
    </main>
    <SiteFooter />
  </div>
</template>
