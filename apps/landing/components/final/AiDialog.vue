<!-- What the app shows for an AI action, drawn after apps/client/src/ui/ai
     (BulkRenameDialog.vue, SortDialog.vue, SummaryDialog.vue on the kit's
     Modal, aiDialog.css, AiReachBadge.vue) with the app's own strings
     (i18n en.ts: bulk_rename, ai_sort, summary). An agent's plan opens in
     the same dialog, titled with the agent's name and its reason.
     Over the whole window: a dim layer and the dialog in its middle.
     Sizes are em of the window (13px in the app). -->
<script setup lang="ts">
defineProps<{ kind: "summarize" | "rename" | "sort" | "agent" }>();

const renames = [
  { from: "IMG_2041.jpg", to: "Sea horizon at dawn.jpg", on: true },
  { from: "IMG_2057.jpg", to: "Lemon tea in hand.jpg", on: true },
  { from: "photo (3).jpg", to: "Raspberries in a bowl.jpg", on: true },
  { from: "DSC_0192.jpg", to: "Orange jellyfish.jpg", on: true },
  { from: "New note 3.md", to: "Warm light mood.md", on: false },
];

const groups = [
  { name: "Photos", tag: "new", files: ["sea-horizon.jpg", "jellyfish.jpg"] },
  { name: "Fruit", tag: "new", files: ["lemon-tea.jpg", "raspberries.jpg"] },
  { name: "References", tag: "exists", files: ["Mood.md"] },
];
</script>

<template>
  <div class="ov" aria-hidden="true">
    <div class="dlg">
      <!-- ── Summarize this folder ───────────────────── -->
      <template v-if="kind === 'summarize'">
        <p class="dt">Summarize “Harbor moodboard”</p>
        <p class="dd">8 items · gemma3</p>
        <div class="st"><span class="badge"><UIcon name="i-tabler-lock" class="bi" />This computer</span></div>
        <div class="pv">
          <p><b>Coastal summer</b>, a moodboard for a brand refresh.</p>
          <ul>
            <li>Sea and sky: a horizon at dawn, pink blossom, an orange jellyfish.</li>
            <li>Fresh fruit: lemon tea and raspberries.</li>
            <li>The note asks for warm light and one object on the table.</li>
          </ul>
        </div>
        <div class="ft">
          <span class="aside">Adds a note next to what you summarized.</span>
          <span class="btn">Discard</span>
          <span class="btn primary">Add note</span>
        </div>
      </template>

      <!-- ── Rename files by content ─────────────────── -->
      <template v-else-if="kind === 'rename'">
        <p class="dt">Rename files by content</p>
        <p class="dd">5 items · gemma3</p>
        <div class="st">
          <span class="badge"><UIcon name="i-tabler-lock" class="bi" />This computer</span>
          <span>Uncheck what to keep. Nothing is renamed until you confirm.</span>
        </div>
        <ul class="list">
          <li v-for="r in renames" :key="r.from" class="row">
            <span class="cb" :class="{ on: r.on }"><UIcon v-if="r.on" name="i-tabler-check" class="cbi" /></span>
            <span class="cell muted">{{ r.from }}</span>
            <UIcon name="i-tabler-arrow-right" class="ai" />
            <span class="cell" :class="{ struck: !r.on }">{{ r.to }}</span>
          </li>
        </ul>
        <div class="ft">
          <span class="aside">4 to rename</span>
          <span class="btn">Cancel</span>
          <span class="btn primary">Rename 4</span>
        </div>
      </template>

      <!-- ── Sort into folders: the model's plan, or an agent's ── -->
      <template v-else>
        <p class="dt">{{ kind === 'agent' ? "Claude Code" : "Sort “Harbor moodboard” into folders" }}</p>
        <p class="dd">{{ kind === 'agent' ? "Photos apart from the fruit, and the note with the references." : "8 items · gemma3" }}</p>
        <div v-if="kind === 'sort'" class="st"><span class="badge"><UIcon name="i-tabler-lock" class="bi" />This computer</span></div>
        <p class="hint">Uncheck what stays where it is. Nothing moves until you click Sort.</p>
        <ul class="cards">
          <li v-for="g in groups" :key="g.name" class="card">
            <div class="row head">
              <span class="cb on"><UIcon name="i-tabler-check" class="cbi" /></span>
              <UIcon name="i-tabler-folder" class="ai" />
              <span class="cell gname">{{ g.name }}</span>
              <span class="tag" :class="{ new: g.tag === 'new' }">{{ g.tag }}</span>
            </div>
            <div v-for="f in g.files" :key="f" class="row sub">
              <span class="cb on"><UIcon name="i-tabler-check" class="cbi" /></span>
              <UIcon name="i-tabler-file" class="ai" />
              <span class="cell">{{ f }}</span>
            </div>
          </li>
        </ul>
        <div class="ft">
          <span class="aside">5 to move</span>
          <span class="btn">Cancel</span>
          <span class="btn primary">Sort 5</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* Modal.vue: a dim layer and the dialog */
.ov {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 0.28);
}

.dlg {
  display: flex;
  width: min(49em, 90%);
  box-sizing: border-box;
  flex-direction: column;
  gap: 0.77em;
  border: 1px solid rgb(0 0 0 / 0.15);
  border-radius: 0.92em;
  background: #fff;
  padding: 1.38em 1.38em 1.23em;
  box-shadow: 0 1.5em 3.8em rgb(0 0 0 / 0.18);
  color: #1f1f1e;
}

.dt {
  margin: 0;
  font-size: 1.15em;
  font-weight: 500;
}

.dd {
  margin: -0.3em 0 0.15em;
  color: #5f5e5a;
  font-size: 0.92em;
}

.st {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.62em;
  color: #5f5e5a;
  font-size: 0.92em;
}

/* AiReachBadge.vue, a model on this computer */
.badge {
  display: inline-flex;
  height: 1.7em;
  align-items: center;
  gap: 0.3em;
  border-radius: 0.46em;
  background: #eaf3de;
  padding: 0 0.62em;
  color: #3b6d11;
  font-weight: 500;
}

.bi {
  width: 1.15em;
  height: 1.15em;
}

.hint {
  margin: 0;
  color: #5f5e5a;
  font-size: 0.92em;
}

/* The summary, as a note will show it */
.pv {
  border: 1px solid rgb(0 0 0 / 0.15);
  border-radius: 0.62em;
  padding: 0.92em;
  line-height: 1.5;
}

.pv p {
  margin: 0 0 0.4em;
}

.pv ul {
  margin: 0;
  padding-left: 1.2em;
  list-style: disc;
}

/* aiDialog.css: a list with thin rules, 34px rows */
.list {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid rgb(0 0 0 / 0.15);
  border-radius: 0.62em;
}

.list > li + li {
  border-top: 1px solid rgb(0 0 0 / 0.08);
}

.row {
  display: flex;
  min-height: 2.6em;
  align-items: center;
  gap: 0.62em;
  padding: 0.3em 0.77em;
}

.cell {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.muted {
  color: #5f5e5a;
}

.struck {
  color: #9a9893;
  text-decoration: line-through;
}

.ai {
  width: 1.15em;
  height: 1.15em;
  flex: none;
  color: #9a9893;
}

/* Checkbox.vue */
.cb {
  display: grid;
  width: 1.38em;
  height: 1.38em;
  flex: none;
  box-sizing: border-box;
  place-items: center;
  border: 1px solid rgb(0 0 0 / 0.36);
  border-radius: 0.38em;
  background: #fff;
  color: #fff;
}

.cb.on {
  border-color: #378add;
  background: #378add;
}

.cbi {
  width: 1.05em;
  height: 1.05em;
}

.cards {
  display: flex;
  flex-direction: column;
  gap: 0.62em;
  margin: 0;
  padding: 0;
  list-style: none;
}

.card {
  overflow: hidden;
  border: 1px solid rgb(0 0 0 / 0.15);
  border-radius: 0.62em;
}

.row.head {
  background: #f8f8f7;
}

.row.sub {
  min-height: 2em;
  padding-left: 2.6em;
}

.gname {
  font-weight: 500;
}

.tag {
  flex: none;
  border-radius: 0.46em;
  background: #f8f8f7;
  padding: 0.08em 0.54em;
  color: #5f5e5a;
  font-size: 0.85em;
  font-weight: 500;
}

.tag.new {
  background: #e6f1fb;
  color: #185fa5;
}

/* The footer: what will change on the left, the buttons on the right */
.ft {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.62em;
  margin-top: 0.46em;
}

.aside {
  flex: 1 1 auto;
  color: #5f5e5a;
  font-size: 0.92em;
}

/* Button.vue: 32px, 7px corners; the primary one dark */
.btn {
  display: inline-flex;
  height: 2.46em;
  align-items: center;
  border: 1px solid rgb(0 0 0 / 0.15);
  border-radius: 0.54em;
  background: #fff;
  padding: 0 1.08em;
  font-weight: 500;
  white-space: nowrap;
}

.btn.primary {
  border-color: transparent;
  background: #1f1f1e;
  color: #fff;
}
</style>
