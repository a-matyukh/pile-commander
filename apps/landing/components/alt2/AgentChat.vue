<!-- ② An agent working through the app's MCP server: it asks to sort a folder
     (propose_move), and the app opens the plan in its own Sort dialog for the
     person to check. The dialog is drawn after apps/client/src/ui/ai/
     SortDialog.vue: an agent's plan is titled with the agent's name and its
     reason, and nothing moves until Sort is clicked. Static: no motion. -->
<template>
  <div
    class="agent"
    role="img"
    aria-label="An agent in a terminal asks Pile Commander to sort a folder into folders. The app opens the plan in its Sort dialog, with checkboxes and a Sort button."
  >
    <div class="term" aria-hidden="true">
      <div class="term-bar">
        <span class="dot" /><span class="dot" /><span class="dot" />
        <span class="term-name">Claude Code</span>
      </div>
      <div class="term-body">
        <p class="you"><span class="prompt">&gt;</span> Sort my Harbor moodboard folder into folders</p>
        <p class="tool">
          <span class="bullet">●</span> pile-commander · <b>propose_move</b>
        </p>
        <p class="said">
          I've proposed three folders. The plan is open in Pile Commander for
          you to check.
        </p>
      </div>
    </div>

    <div class="dlg" aria-hidden="true">
      <p class="dlg-title">Claude Code</p>
      <p class="dlg-desc">Photos apart from notes, and the references in a folder of their own.</p>
      <p class="hint">Uncheck what stays where it is. Nothing moves until you click Sort.</p>

      <ul class="groups">
        <li class="grp">
          <span class="box on" />
          <span class="gname">Photos</span>
          <span class="tag">new</span>
        </li>
        <li class="file"><span class="box on" />sea-horizon.jpg</li>
        <li class="file"><span class="box on" />lemon-tea.jpg</li>
        <li class="grp">
          <span class="box on" />
          <span class="gname">Notes</span>
          <span class="tag">new</span>
        </li>
        <li class="grp">
          <span class="box on" />
          <span class="gname">References</span>
          <span class="tag">exists</span>
        </li>
      </ul>

      <div class="foot">
        <span class="count">7 to move</span>
        <span class="btn">Cancel</span>
        <span class="btn primary">Sort 7</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent {
  display: grid;
  gap: 0.75rem;
  margin-top: 1.25rem;
  font-size: 13px;
}

/* ── The agent's terminal ────────────────────────────── */

.term {
  overflow: hidden;
  border-radius: 12px;
  background: #16181d;
  color: #d6d9e0;
  font-family: "JetBrains Mono Variable", ui-monospace, Menlo, monospace;
  font-size: 0.92em;
}

.term-bar {
  display: flex;
  align-items: center;
  gap: 0.4em;
  border-bottom: 1px solid rgb(255 255 255 / 0.08);
  padding: 0.6em 0.8em;
}

.dot {
  width: 0.65em;
  height: 0.65em;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.18);
}

.term-name {
  margin-left: 0.5em;
  color: rgb(255 255 255 / 0.55);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 0.95em;
}

.term-body {
  display: grid;
  gap: 0.55em;
  padding: 0.9em 1em 1em;
  line-height: 1.5;
}

.term-body p {
  margin: 0;
}

.you {
  color: #ffffff;
}

.prompt {
  color: #8ec5ff;
}

.tool {
  color: rgb(255 255 255 / 0.62);
}

.tool b {
  color: #c6f0d4;
  font-weight: 500;
}

.bullet {
  color: #21f885;
}

.said {
  color: #d6d9e0;
}

/* ── The app's Sort dialog ───────────────────────────── */

.dlg {
  justify-self: end;
  width: min(100%, 25em);
  box-sizing: border-box;
  border: 1px solid rgb(0 0 0 / 0.08);
  border-radius: 12px;
  background: #ffffff;
  padding: 1em 1.1em 0.9em;
  color: #1f1f1e;
  box-shadow: 0 18px 40px -22px rgb(11 18 32 / 0.45);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}

.dlg p {
  margin: 0;
}

.dlg-title {
  font-size: 1.1em;
  font-weight: 600;
}

.dlg-desc {
  margin-top: 0.2em !important;
  color: #5f5e5a;
}

.hint {
  margin-top: 0.75em !important;
  color: #9a9893;
  font-size: 0.92em;
}

.groups {
  display: grid;
  gap: 0.35em;
  margin: 0.7em 0 0;
  padding: 0;
  list-style: none;
}

.grp,
.file {
  display: flex;
  align-items: center;
  gap: 0.55em;
}

.grp {
  margin-top: 0.25em;
  font-weight: 600;
}

.file {
  padding-left: 1.6em;
  color: #5f5e5a;
}

.box {
  width: 1em;
  height: 1em;
  flex: none;
  box-sizing: border-box;
  border: 1.5px solid #c9c7c2;
  border-radius: 0.25em;
}

.box.on {
  border-color: #378add;
  background:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.5l3 3 6-7' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
      center / 90% no-repeat,
    #378add;
}

.tag {
  border-radius: 999px;
  background: #f0f0ee;
  padding: 0.05em 0.55em;
  color: #5f5e5a;
  font-size: 0.85em;
  font-weight: 500;
}

.foot {
  display: flex;
  align-items: center;
  gap: 0.5em;
  margin-top: 0.95em;
  border-top: 1px solid rgb(0 0 0 / 0.08);
  padding-top: 0.8em;
}

.count {
  margin-right: auto;
  color: #9a9893;
  font-size: 0.92em;
}

.btn {
  border: 1px solid rgb(0 0 0 / 0.12);
  border-radius: 999px;
  padding: 0.35em 0.9em;
  font-weight: 500;
}

.btn.primary {
  border-color: #1f1f1e;
  background: #1f1f1e;
  color: #ffffff;
}
</style>
