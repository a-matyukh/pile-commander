<!-- ② Settings → AI with a model on the person's own computer (Ollama), drawn
     after the app's AI settings: the labels and the connection message are
     the app's strings (i18n en.ts, settings.ai). Static. -->
<template>
  <div
    class="settings"
    role="img"
    aria-label="The app's AI settings: provider Ollama, its local address, no API key needed, the connection tested with four models available, and the model gemma3."
  >
    <div class="rows" aria-hidden="true">
      <p class="head">AI</p>
      <div class="row">
        <span class="k">Provider</span>
        <span class="v select">Ollama<UIcon name="i-tabler-chevron-down" class="size-[1.1em] text-[#9a9893]" /></span>
      </div>
      <div class="row">
        <span class="k">Address</span>
        <span class="v field">http://localhost:11434/v1</span>
      </div>
      <div class="row">
        <span class="k">API key</span>
        <span class="v field muted">Optional</span>
      </div>
      <div class="row">
        <span class="k">Connection</span>
        <span class="v test">
          <span class="btn">Test connection</span>
          <span class="ok"><UIcon name="i-tabler-circle-check" class="size-[1.15em]" />Connected: 4 models available</span>
        </span>
      </div>
      <div class="row">
        <span class="k">Model</span>
        <span class="v field">gemma3</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings {
  margin-top: 1.25rem;
  border: 1px solid rgb(0 0 0 / 0.08);
  border-radius: 12px;
  background: #ffffff;
  color: #1f1f1e;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 13px;
}

.rows {
  display: grid;
  gap: 0.15em;
  padding: 0.9em 1.1em 1em;
}

.head {
  margin: 0 0 0.45em;
  font-size: 1.1em;
  font-weight: 600;
}

.row {
  display: grid;
  grid-template-columns: 6.5em minmax(0, 1fr);
  align-items: center;
  gap: 0.75em;
  border-top: 1px solid rgb(0 0 0 / 0.06);
  padding: 0.55em 0;
}

.k {
  color: #5f5e5a;
}

.v {
  min-width: 0;
}

.field,
.select {
  display: flex;
  overflow: hidden;
  align-items: center;
  justify-content: space-between;
  border: 1px solid rgb(0 0 0 / 0.12);
  border-radius: 0.5em;
  padding: 0.35em 0.6em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.muted {
  color: #9a9893;
}

.test {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45em 0.75em;
}

.btn {
  border: 1px solid rgb(0 0 0 / 0.12);
  border-radius: 999px;
  padding: 0.3em 0.85em;
  font-weight: 500;
}

.ok {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  color: #3b6d11;
}
</style>
