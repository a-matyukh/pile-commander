<!-- A thin bar across the top, as an operating system draws one: the page
     is a desktop. No system in particular: an abstract start button, the
     running apps with Pile Commander open, and a tray with the usual
     status icons and the time. Decoration only, hidden from screen readers.
     The time is the visitor's own, filled in after the page loads (the
     server does not know it). -->
<script setup lang="ts">
const time = ref("");

onMounted(() => {
  const tick = () => {
    time.value = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };
  tick();
  const id = setInterval(tick, 15_000);
  onBeforeUnmount(() => clearInterval(id));
});
</script>

<template>
  <div class="os" aria-hidden="true">
    <span class="start"><UIcon name="i-tabler-circle-dashed" class="ic" /></span>

    <span class="tasks">
      <span class="task on">
        <img src="/app-icon.png" alt="" width="16" height="16" class="task-icon">
        Pile Commander
      </span>
      <span class="task"><UIcon name="i-tabler-mail" class="ic" /></span>
      <span class="task"><UIcon name="i-tabler-music" class="ic" /></span>
    </span>

    <span class="tray">
      <UIcon name="i-tabler-wifi" class="ic" />
      <UIcon name="i-tabler-volume" class="ic" />
      <UIcon name="i-tabler-battery-3" class="ic" />
      <span class="time">{{ time }}</span>
    </span>
  </div>
</template>

<style scoped>
.os {
  display: flex;
  height: var(--lf-os-h);
  flex: none;
  align-items: center;
  gap: 0.5rem;
  background: #2b2b2b;
  padding: 0 0.5rem;
  color: rgb(255 255 255 / 0.85);
  font-size: 0.75rem;
  line-height: 1;
  user-select: none;
}

.ic {
  width: 1rem;
  height: 1rem;
  flex: none;
}

.start {
  display: grid;
  width: 1.5rem;
  height: 1.25rem;
  place-items: center;
  border-radius: 4px;
}

.tasks {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.25rem;
}

.task {
  display: inline-flex;
  height: 1.25rem;
  align-items: center;
  gap: 0.375rem;
  border-radius: 4px;
  padding: 0 0.375rem;
  color: rgb(255 255 255 / 0.6);
  white-space: nowrap;
}

/* The open app */
.task.on {
  background: rgb(255 255 255 / 0.14);
  color: #fff;
}

.task-icon {
  width: 0.9375rem;
  height: 0.9375rem;
  border-radius: 22.5%;
}

.tray {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  margin-left: auto;
}

.time {
  min-width: 2.25rem;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

@media (max-width: 480px) {
  .tray .ic:not(:last-of-type) {
    display: none;
  }
}
</style>
