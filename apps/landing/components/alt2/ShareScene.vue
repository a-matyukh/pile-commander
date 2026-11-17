<!-- ④ A cloud folder opening up in three steps, named as the app's Share menu
     names them (ShareMenu.vue, sharePublishPanel.ts): Share with…, Make a
     public folder, Publish on the Hub. For each step: the menu, the app's
     panel (People, Publication, the Hub card; strings from i18n en.ts) and
     what other people see: a member's app, any browser at the public link,
     the Hub gallery. The address is the app's: www.pile-commander.app/
     <username>/<slug>. There are no likes in the Hub; cards count copies.
     The steps play on their own while on screen and motion is welcome;
     Play runs them once, also with reduced motion. -->
<script setup lang="ts">
const steps = [
  { label: "Share with…", icon: "i-tabler-users", who: "Maria's computer" },
  { label: "Make a public folder", icon: "i-tabler-link", who: "Any browser" },
  { label: "Publish on the Hub", icon: "i-tabler-world", who: "The Hub" },
] as const;

const step = ref(0);
/** The visitor picked a step: the steps stop for good */
const touched = ref(false);
/** Play was pressed: the steps run with motion, once */
const playing = ref(false);

const tabs = useTemplateRef<HTMLButtonElement[]>("tabs");
const root = useTemplateRef<HTMLElement>("root");

let timers: ReturnType<typeof setTimeout>[] = [];

function clear() {
  for (const t of timers) clearTimeout(t);
  timers = [];
}

function pick(i: number) {
  clear();
  touched.value = true;
  playing.value = false;
  step.value = i;
}

function play() {
  clear();
  touched.value = true;
  playing.value = true;
  step.value = 0;
  timers.push(setTimeout(() => (step.value = 1), 3600));
  timers.push(setTimeout(() => (step.value = 2), 7200));
  timers.push(setTimeout(() => (playing.value = false), 10200));
}

/** Arrow keys move between the steps, as a tab list should */
function onKey(event: KeyboardEvent) {
  const last = steps.length - 1;
  const to
    = event.key === "ArrowRight" ? (step.value === last ? 0 : step.value + 1)
      : event.key === "ArrowLeft" ? (step.value === 0 ? last : step.value - 1)
        : event.key === "Home" ? 0
          : event.key === "End" ? last
            : -1;
  if (to < 0) return;
  event.preventDefault();
  pick(to);
  nextTick(() => tabs.value?.[to]?.focus());
}

onMounted(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let visible = false;
  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = !!entry?.isIntersecting;
    },
    { threshold: 0.4 },
  );
  if (root.value) observer.observe(root.value);
  const timer = window.setInterval(() => {
    if (visible && !touched.value) step.value = (step.value + 1) % steps.length;
  }, 4200);
  onUnmounted(() => {
    observer.disconnect();
    window.clearInterval(timer);
    clear();
  });
});
</script>

<template>
  <div ref="root">
    <div class="controls">
      <div class="tabs-scroll">
        <div role="tablist" aria-label="Ways to open a folder up" class="tabs" @keydown="onKey">
          <button
            v-for="(s, i) in steps"
            :id="`a2-share-tab-${i}`"
            :key="s.label"
            ref="tabs"
            type="button"
            role="tab"
            :aria-selected="step === i"
            :tabindex="step === i ? 0 : -1"
            aria-controls="a2-share-stage"
            class="tab"
            :class="{ 'is-on': step === i }"
            @click="pick(i)"
          >
            <UIcon :name="s.icon" class="size-4" />
            {{ s.label }}
          </button>
        </div>
      </div>
      <button type="button" class="play" :aria-pressed="playing" @click="play">
        <UIcon name="i-lucide-play" class="size-4" />
        Play
      </button>
    </div>

    <div
      id="a2-share-stage"
      role="tabpanel"
      :aria-labelledby="`a2-share-tab-${step}`"
      class="a2-frame stage"
      :class="{ playing }"
    >
      <div class="cols" aria-hidden="true">
        <!-- The Share menu, open on the folder -->
        <div class="col col-menu">
          <p class="col-label">In the app</p>
          <div class="win">
            <div class="fh">
              <div class="where">
                <span class="crumbs"><UIcon name="i-tabler-cloud" class="ic-s" />Cloud</span>
                <span class="title">Harbor moodboard</span>
              </div>
              <span class="acts">
                <span class="act"><UIcon name="i-tabler-template" class="ic v-board" /></span>
                <span class="act"><UIcon name="i-lucide-sparkles" class="ic" /></span>
                <span class="act act-on"><UIcon name="i-tabler-share-2" class="ic" /></span>
              </span>
            </div>
            <ul class="menu">
              <li class="mi"><UIcon name="i-tabler-file-export" class="ic" />Export…</li>
              <li v-for="(s, i) in steps" :key="s.label" class="mi" :class="{ on: step === i }">
                <UIcon :name="s.icon" class="ic" />{{ s.label }}
              </li>
            </ul>
          </div>
        </div>

        <!-- The app's panel for the step -->
        <div class="col col-panel">
          <p class="col-label">{{ steps[step]!.label.replace("…", "") }}</p>
          <div class="pane-stack">
            <!-- People -->
            <div class="panel" :class="{ on: step === 0 }">
              <p class="p-title">People</p>
              <div class="invite">
                <span class="field">maria@studio.com</span>
                <span class="select">Editor<UIcon name="i-tabler-chevron-down" class="ic-s" /></span>
                <span class="btn primary">Invite</span>
              </div>
              <ul class="people">
                <li>
                  <span class="avatar a-s">S</span>
                  <span class="who">sam@studio.com</span>
                  <span class="role">Viewer</span>
                </li>
                <li class="new">
                  <span class="avatar a-m">M</span>
                  <span class="who">maria@studio.com</span>
                  <span class="role wait">Invited, waiting</span>
                </li>
              </ul>
              <p class="p-note">Send again · Revoke</p>
            </div>

            <!-- Publication: the public link -->
            <div class="panel" :class="{ on: step === 1 }">
              <p class="p-title">Public link <span class="pill ok">Open</span></p>
              <p class="p-lead">Anyone with the link can view this folder. You and editors keep changing it.</p>
              <p class="p-label">Address</p>
              <span class="field mono">www.pile-commander.app/alex/harbor-moodboard</span>
              <div class="row-btns">
                <span class="btn primary"><UIcon name="i-tabler-copy" class="ic-s" />Copy link</span>
                <span class="btn">Close the link</span>
              </div>
              <p class="check"><span class="box on" />Allow forks and .pile downloads</p>
            </div>

            <!-- Publication: the Hub card -->
            <div class="panel" :class="{ on: step === 2 }">
              <p class="p-title">Show in the Hub <span class="pill ok">In the gallery</span></p>
              <div class="tags">
                <span class="tag">moodboard</span>
                <span class="tag">summer</span>
                <span class="tag add">+ tag</span>
              </div>
              <span class="field">Brand refresh · sun, salty air, fresh fruit</span>
              <div class="preview-row">
                <img src="/landing-alt2/sea-horizon.jpg" alt="" class="preview" width="520" height="346">
                <span class="p-note">Free: 1 of 3 listings</span>
              </div>
              <p class="p-link">Open in the Hub <UIcon name="i-tabler-arrow-up-right" class="ic-s" /></p>
            </div>
          </div>
        </div>

        <!-- What others see -->
        <div class="col col-out">
          <p class="col-label">{{ steps[step]!.who }}</p>
          <div class="pane-stack">
            <!-- A member's app: the folder, shared, live -->
            <div class="out win" :class="{ on: step === 0 }">
              <div class="out-body member">
                <aside class="tree">
                  <p class="t-head"><UIcon name="i-tabler-cloud" class="ic-s" />Cloud</p>
                  <p class="t-row sel"><UIcon name="i-tabler-template" class="ic-s v-board" />Harbor moodboard</p>
                  <p class="t-badge"><UIcon name="i-tabler-users" class="ic-s" />Shared folder</p>
                  <p class="t-row"><UIcon name="i-tabler-folder" class="ic-s" />Recipes</p>
                </aside>
                <div class="mini-board">
                  <img src="/landing-alt2/sea-horizon.jpg" alt="" class="mb mb-1" width="520" height="346">
                  <img src="/landing-alt2/lemon-tea.jpg" alt="" class="mb mb-2" width="416" height="520">
                  <span class="mb mb-note">Warm light, salty air.</span>
                </div>
              </div>
            </div>

            <!-- Any browser at the public link -->
            <div class="out win" :class="{ on: step === 1 }">
              <div class="url"><UIcon name="i-tabler-lock" class="ic-s" />www.pile-commander.app/alex/harbor-moodboard</div>
              <div class="pub-head">
                <span class="title">Harbor moodboard</span>
                <span class="pill">View only</span>
              </div>
              <div class="pub-acts">
                <span class="btn primary">Copy to my cloud</span>
                <span class="btn">Download .pile</span>
              </div>
              <div class="mini-board flat">
                <img src="/landing-alt2/sea-horizon.jpg" alt="" class="mb mb-1" width="520" height="346">
                <img src="/landing-alt2/pink-blossom.jpg" alt="" class="mb mb-2" width="416" height="520">
                <span class="mb mb-note">Warm light, salty air.</span>
              </div>
            </div>

            <!-- The Hub gallery -->
            <div class="out win" :class="{ on: step === 2 }">
              <div class="url"><UIcon name="i-tabler-lock" class="ic-s" />www.pile-commander.app/hub</div>
              <div class="hub-tabs">
                <span class="on">Publications</span><span>Authors</span><span>Tags</span>
              </div>
              <span class="field search"><UIcon name="i-tabler-search" class="ic-s" />Search publications…</span>
              <div class="cards">
                <div class="card mine">
                  <img src="/landing-alt2/sea-horizon.jpg" alt="" class="c-img" width="520" height="346">
                  <p class="c-title">Harbor moodboard</p>
                  <p class="c-meta">@alex · moodboard · summer</p>
                  <p class="c-meta">12 copies</p>
                </div>
                <div class="card">
                  <span class="c-img c-img-2" />
                  <p class="c-title">Trip to Lisbon</p>
                  <p class="c-meta">@nora · travel</p>
                  <p class="c-meta">8 copies</p>
                </div>
                <div class="card">
                  <span class="c-img c-img-3" />
                  <p class="c-title">Studio kanban</p>
                  <p class="c-meta">@ilya · kanban</p>
                  <p class="c-meta">21 copies</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Steps and Play ──────────────────────────────────── */

.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1.5rem;
  margin-bottom: 1.5rem;
}

.tabs-scroll {
  margin: 0 calc(-1 * var(--a2-gutter));
  overflow-x: auto;
  padding: 0 var(--a2-gutter) 0.25rem;
  scrollbar-width: none;
}

.tabs {
  display: inline-flex;
  gap: 0.25rem;
  border: 1px solid var(--a2-line);
  border-radius: 999px;
  background: var(--a2-surface);
  padding: 0.3rem;
}

.tab {
  display: inline-flex;
  min-height: 2.5rem;
  flex-shrink: 0;
  cursor: pointer;
  align-items: center;
  gap: 0.45rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  padding: 0 1rem;
  color: var(--a2-ink-2);
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 500;
  white-space: nowrap;
}

.tab:hover {
  background: var(--a2-bg);
  color: var(--a2-ink);
}

.tab.is-on {
  background: var(--a2-ink);
  color: #fff;
}

.play {
  display: inline-flex;
  height: 2.25rem;
  cursor: pointer;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid var(--a2-line);
  border-radius: 999px;
  background: var(--a2-surface);
  padding: 0 0.9rem 0 0.75rem;
  color: var(--a2-ink);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 600;
}

.play:hover {
  border-color: var(--a2-ink-3);
}

/* ── The stage, in the app's palette ─────────────────── */

.stage {
  container-type: inline-size;
  background: #f0f0ee;
}

.cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1.1em;
  padding: 1.25em;
  color: #1f1f1e;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 12px;
  line-height: 1.35;
}

@container (min-width: 900px) {
  .cols {
    grid-template-columns: 15.5em minmax(0, 1fr) minmax(0, 1.2fr);
    gap: 1.4em;
    padding: 1.6em;
    font-size: 13px;
  }
}

.cols p {
  margin: 0;
}

.col {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.6em;
}

/* On a narrow stage the menu goes: the step buttons above name the step */
@container (max-width: 899px) {
  .col-menu {
    display: none;
  }
}

.col-label {
  color: #9a9893;
  font-size: 0.85em;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.win {
  overflow: hidden;
  border: 1px solid rgb(0 0 0 / 0.08);
  border-radius: 0.8em;
  background: #fff;
  box-shadow: 0 0.8em 1.6em -1.1em rgb(15 23 42 / 0.35);
}

.ic {
  width: 1.3em;
  height: 1.3em;
  flex: none;
}

.ic-s {
  width: 1.1em;
  height: 1.1em;
  flex: none;
}

.ic.v-board,
.ic-s.v-board {
  color: #534ab7;
}

/* ── The menu column ─────────────────────────────────── */

.fh {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5em;
  border-bottom: 1px solid rgb(0 0 0 / 0.08);
  padding: 0.7em 0.8em;
}

.where {
  display: grid;
  min-width: 0;
  gap: 0.15em;
}

.crumbs {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  color: #9a9893;
  font-size: 0.9em;
}

.title {
  overflow: hidden;
  font-size: 1.1em;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acts {
  display: inline-flex;
  gap: 0.15em;
  color: #5f5e5a;
}

.act {
  display: grid;
  width: 2em;
  height: 2em;
  place-items: center;
  border-radius: 0.45em;
}

.act-on {
  background: #f0f0ee;
  color: #1f1f1e;
}

.menu {
  display: grid;
  gap: 0.1em;
  margin: 0;
  padding: 0.45em;
  list-style: none;
}

.mi {
  display: flex;
  align-items: center;
  gap: 0.55em;
  border-radius: 0.5em;
  padding: 0.55em 0.6em;
  color: #1f1f1e;
  transition: background-color 0.3s ease;
}

.mi.on {
  background: #e6f1fb;
  color: #185fa5;
}

/* ── Panels and what others see: one at a time ───────── */

.pane-stack {
  position: relative;
  height: 21em;
}

.panel,
.out {
  position: absolute;
  inset: 0;
  opacity: 0;
  translate: 0 0.6em;
  transition:
    opacity 0.45s ease,
    translate 0.45s cubic-bezier(0.2, 0.8, 0.2, 1);
  pointer-events: none;
}

.panel.on,
.out.on {
  opacity: 1;
  translate: 0 0;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 0.7em;
  box-sizing: border-box;
  border: 1px solid rgb(0 0 0 / 0.08);
  border-radius: 0.8em;
  background: #fff;
  padding: 1em 1.1em;
  box-shadow: 0 0.8em 1.6em -1.1em rgb(15 23 42 / 0.35);
}

.p-title {
  display: flex;
  align-items: center;
  gap: 0.5em;
  font-size: 1.1em;
  font-weight: 600;
}

.p-lead {
  color: #5f5e5a;
}

.p-label {
  color: #9a9893;
  font-size: 0.9em;
}

.p-note {
  color: #9a9893;
  font-size: 0.9em;
}

.p-link {
  display: inline-flex;
  align-items: center;
  gap: 0.25em;
  color: #185fa5;
  font-weight: 500;
}

.pill {
  border-radius: 999px;
  background: #f0f0ee;
  padding: 0.1em 0.6em;
  color: #5f5e5a;
  font-size: 0.78em;
  font-weight: 600;
}

.pill.ok {
  background: #e7f1dc;
  color: #3b6d11;
}

.field,
.select {
  display: flex;
  min-width: 0;
  overflow: hidden;
  align-items: center;
  gap: 0.4em;
  border: 1px solid rgb(0 0 0 / 0.12);
  border-radius: 0.5em;
  padding: 0.45em 0.6em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mono {
  display: block;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
}

.invite {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.4em;
}

.select {
  gap: 0.25em;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35em;
  border: 1px solid rgb(0 0 0 / 0.12);
  border-radius: 999px;
  padding: 0.4em 0.85em;
  font-weight: 500;
  white-space: nowrap;
}

.btn.primary {
  border-color: #1f1f1e;
  background: #1f1f1e;
  color: #fff;
}

.people {
  display: grid;
  gap: 0.2em;
  margin: 0;
  padding: 0;
  list-style: none;
}

.people li {
  display: flex;
  align-items: center;
  gap: 0.55em;
  border-radius: 0.5em;
  padding: 0.45em 0.3em;
}

.people .new {
  background: #e6f1fb;
}

.avatar {
  display: grid;
  width: 1.8em;
  height: 1.8em;
  flex: none;
  place-items: center;
  border-radius: 999px;
  color: #fff;
  font-size: 0.85em;
  font-weight: 700;
}

.a-s {
  background: #1d9e75;
}

.a-m {
  background: #d4537e;
}

.who {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role {
  margin-left: auto;
  color: #5f5e5a;
  white-space: nowrap;
}

.role.wait {
  color: #185fa5;
}

.row-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4em;
}

.check {
  display: flex;
  align-items: center;
  gap: 0.5em;
}

.box {
  width: 1.05em;
  height: 1.05em;
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

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35em;
}

.tag {
  border-radius: 999px;
  background: #f0f0ee;
  padding: 0.25em 0.7em;
  font-weight: 500;
}

.tag.add {
  background: transparent;
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.12);
  color: #5f5e5a;
}

.preview-row {
  display: flex;
  align-items: flex-end;
  gap: 0.8em;
}

.preview {
  width: 7em;
  height: auto;
  border-radius: 0.4em;
}

/* ── What others see ─────────────────────────────────── */

.out {
  display: flex;
  flex-direction: column;
}

.url {
  display: flex;
  align-items: center;
  gap: 0.4em;
  overflow: hidden;
  border-bottom: 1px solid rgb(0 0 0 / 0.08);
  background: #f8f8f7;
  padding: 0.6em 0.8em;
  color: #5f5e5a;
  font-size: 0.92em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.out-body.member {
  display: grid;
  height: 100%;
  grid-template-columns: 12.5em minmax(0, 1fr);
}

.tree {
  border-right: 1px solid rgb(0 0 0 / 0.08);
  background: #f8f8f7;
  padding: 0.7em 0.5em;
}

.t-head,
.t-row,
.t-badge {
  display: flex;
  min-width: 0;
  overflow: hidden;
  align-items: center;
  gap: 0.4em;
  border-radius: 0.45em;
  padding: 0.4em 0.45em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.t-head {
  color: #5f5e5a;
  font-weight: 600;
}

.t-row.sel {
  background: #e6f1fb;
  color: #185fa5;
}

.t-badge {
  padding-left: 1.9em;
  color: #9a9893;
  font-size: 0.85em;
}

.mini-board {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: #ebe9e6;
}

.mb {
  position: absolute;
  object-fit: cover;
}

.mb-1 {
  top: 9%;
  left: 6%;
  width: 46%;
  aspect-ratio: 520 / 346;
}

.mb-2 {
  top: 7%;
  left: 60%;
  width: 24%;
  aspect-ratio: 4 / 5;
}

.mb-note {
  top: 72%;
  left: 6%;
  width: 40%;
  box-sizing: border-box;
  border: 1px solid rgb(0 0 0 / 0.08);
  background: #fff;
  padding: 0.6em 0.7em;
}

.pub-head {
  display: flex;
  align-items: center;
  gap: 0.6em;
  padding: 0.8em 0.9em 0.4em;
}

.pub-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4em;
  padding: 0 0.9em 0.8em;
}

.hub-tabs {
  display: flex;
  gap: 1.2em;
  border-bottom: 1px solid rgb(0 0 0 / 0.08);
  padding: 0.7em 0.9em 0;
  color: #5f5e5a;
}

.hub-tabs span {
  padding-bottom: 0.55em;
}

.hub-tabs .on {
  box-shadow: inset 0 -2px 0 #378add;
  color: #185fa5;
  font-weight: 600;
}

.search {
  margin: 0.7em 0.9em;
  color: #9a9893;
}

.cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.6em;
  padding: 0 0.9em 0.9em;
}

.card {
  display: grid;
  gap: 0.2em;
  border: 1px solid rgb(0 0 0 / 0.08);
  border-radius: 0.6em;
  padding: 0.4em 0.4em 0.55em;
}

.card.mine {
  box-shadow: 0 0 0 2px #378add;
}

.c-img {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 3 / 2;
  border-radius: 0.35em;
  object-fit: cover;
}

.c-img-2 {
  background: linear-gradient(160deg, #f6d6a8, #e98f5a);
}

.c-img-3 {
  background:
    linear-gradient(90deg, #fff 0 30%, transparent 30% 35%, #fff 35% 65%, transparent 65% 70%, #fff 70%) 0 30% / 100% 40% no-repeat,
    #cfe0fb;
}

.c-title {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.c-meta {
  overflow: hidden;
  color: #9a9893;
  font-size: 0.85em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* With reduced motion the steps switch at once, unless Play was pressed */
@media (prefers-reduced-motion: reduce) {
  .stage:not(.playing) * {
    transition-duration: 0ms !important;
  }
}
</style>
