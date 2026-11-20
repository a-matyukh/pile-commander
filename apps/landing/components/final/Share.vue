<!-- Block 5, share. A tour like the blocks above, drawn after the app: the
     share button's menu (ShareMenu.vue, sharePublishPanel.ts: Export…,
     Share with…, Make a public folder, Publish on the Hub), the panels it
     opens (ExportPanel.vue, PeoplePanel.vue, LinkPanel.vue, HubPanel.vue in
     PanelFrame.vue: 230px for export, 380px for sharing) with the app's
     strings (i18n export, share, publish), and the Hub itself. Each step
     shows the menu with its item first, then its panel, as a click would. -->
<script setup lang="ts">
import { homeBookmarks, homeTree } from "~/utils/finalFolder";
import type { Crumb } from "./AppWindow.vue";

type ShareStep = "export" | "people" | "link" | "publish" | "hub";

const crumbs: Crumb[] = [{ glyph: "home" }, { name: "Pictures" }];

const steps: { id: ShareStep; label: string; icon: string; caption: string }[] = [
  { id: "export", label: "Export…", icon: "i-tabler-file-export", caption: "Pack a folder into one .pile file and pass it to anyone: a zip of the folder with its layout, so the arrangement survives email, USB sticks and disks that drop it, and opens in Pile Commander anywhere." },
  { id: "people", label: "Share with…", icon: "i-tabler-users", caption: "Invite people to the folder's cloud copy as editors or viewers, and work in it together in real time." },
  { id: "link", label: "Make a public folder", icon: "i-tabler-link", caption: "Anyone with the link sees the live folder. You and editors keep changing it." },
  { id: "publish", label: "Publish on the Hub", icon: "i-tabler-world", caption: "List the folder in the Hub, the public gallery, as a card with a cover, tags and a description." },
  { id: "hub", label: "The Hub", icon: "i-tabler-world", caption: "See what others publish, open any folder, and copy the ones you like into your own account." },
];

/** The share menu, in the app's order */
const menu = [
  { id: "export", icon: "i-tabler-file-export", label: "Export…" },
  { id: "people", icon: "i-tabler-users", label: "Share with…" },
  { id: "link", icon: "i-tabler-link", label: "Make a public folder" },
  { id: "publish", icon: "i-tabler-world", label: "Publish on the Hub" },
];

const step = ref<ShareStep>("export");
const meta = computed(() => steps.find(s => s.id === step.value)!);
const playing = ref(true);

/** A menu step shows the menu with its item, then the panel it opens */
const phase = ref<"menu" | "panel">("menu");
let phaseTimer: number | undefined;

function show(id: ShareStep) {
  step.value = id;
  window.clearTimeout(phaseTimer);
  const fromMenu = menu.some(m => m.id === id);
  phase.value = fromMenu ? "menu" : "panel";
  if (fromMenu) phaseTimer = window.setTimeout(() => { phase.value = "panel"; }, 1300);
}

function pick(id: ShareStep) {
  playing.value = false;
  show(id);
}

function next() {
  const i = steps.findIndex(s => s.id === step.value);
  show(steps[(i + 1) % steps.length]!.id);
}

function toggle() {
  playing.value = !playing.value;
  if (playing.value) next();
}

const root = useTemplateRef<HTMLElement>("root");

onMounted(() => {
  show(step.value);
  let visible = false;
  const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; }, { threshold: 0.35 });
  if (root.value) io.observe(root.value);
  const timer = window.setInterval(() => {
    if (visible && playing.value) next();
  }, 4600);
  onBeforeUnmount(() => {
    io.disconnect();
    window.clearInterval(timer);
    window.clearTimeout(phaseTimer);
  });
});

const menuOpen = computed(() => phase.value === "menu" && menu.some(m => m.id === step.value));
const panel = computed(() => (phase.value === "panel" && step.value !== "hub" ? step.value : null));

/* The Hub's gallery: cards with a cover, a title, an author and tags */
const cards = [
  { title: "Harbor moodboard", author: "anna", cover: "/landing-alt2/sea-horizon.jpg", tags: ["moodboard", "summer"], forks: 12 },
  { title: "Tea ceremony notes", author: "kenji", cover: "/landing-alt2/lemon-tea.jpg", tags: ["recipes"], forks: 4 },
  { title: "Berry season", author: "lena", cover: "/landing-alt2/raspberries.jpg", tags: ["photo", "food"], forks: 7 },
  { title: "Deep sea", author: "max", cover: "/landing-alt2/jellyfish.jpg", tags: ["research"], forks: 21 },
  { title: "Spring in Kyoto", author: "mira", cover: "/landing-alt2/pink-blossom.jpg", tags: ["travel"], forks: 9 },
];
</script>

<template>
  <section id="share" ref="root" class="sec" aria-labelledby="share-title">
    <div class="lf-wrap">
      <header class="head">
        <span class="lf-marker" aria-hidden="true">5</span>
        <div class="trow">
          <h2 id="share-title" class="title">Share</h2>
          <button type="button" class="play" :aria-pressed="playing" @click="toggle">
            <UIcon :name="playing ? 'i-tabler-player-pause' : 'i-tabler-player-play'" class="pi" />
            {{ playing ? "Pause" : "Play" }}
          </button>
          <p class="hint"><UIcon name="i-tabler-pointer" class="pi" />Pick one to see it</p>
        </div>
        <p class="lede">Send a folder as a file, share it with people, give it a public link, or publish it on the Hub.</p>

        <div class="steps" role="group" aria-label="Ways to share a folder">
          <button
            v-for="s in steps"
            :key="s.id"
            type="button"
            class="chip"
            :aria-pressed="step === s.id"
            @click="pick(s.id)"
          >
            <UIcon :name="s.icon" class="ci" />{{ s.label }}
          </button>
        </div>
        <p class="caption" aria-live="polite">{{ meta.caption }}</p>
      </header>

      <FinalAppWindow
        class="shot"
        :crumbs="step === 'hub' ? [] : crumbs"
        :title="step === 'hub' ? 'Hub' : 'Harbor moodboard'"
        :bookmarks="homeBookmarks('board')"
        :tree="step === 'hub' ? [] : homeTree('board')"
        :drive="step === 'hub' ? 'hub' : 'local'"
        :markers="step === 'hub' ? [] : [5]"
        :actions="step !== 'hub'"
        :open="menuOpen ? 'share' : null"
      >
        <!-- The Hub: the public gallery -->
        <div v-if="step === 'hub'" class="hub">
          <div v-for="c in cards" :key="c.title" class="hc">
            <img :src="c.cover" alt="" class="hci">
            <div class="hcb">
              <p class="hct">{{ c.title }}</p>
              <p class="hca">@{{ c.author }}</p>
              <p class="hctags"><span v-for="t in c.tags" :key="t" class="htag">{{ t }}</span><span class="hfork"><UIcon name="i-tabler-git-fork" class="hfi" />{{ c.forks }}</span></p>
            </div>
          </div>
        </div>
        <FinalFolderViews v-else view="board" />

        <template #over>
          <!-- The share menu: share is followed by more -->
          <div v-if="menuOpen" class="am shm">
            <div class="am-i" :class="{ hl: step === 'export' }"><UIcon name="i-tabler-file-export" class="am-ic" />Export…</div>
            <div v-for="m in menu.slice(1)" :key="m.id" class="am-i" :class="{ hl: m.id === step }"><UIcon :name="m.icon" class="am-ic" />{{ m.label }}</div>
          </div>

          <!-- The panel the item opens (PanelFrame.vue) -->
          <div v-if="panel" class="pf" :class="panel === 'export' ? 'narrow' : 'wide'">
            <div class="pfh">
              <UIcon v-if="panel !== 'export'" :name="meta.icon" class="pfi" />
              <span class="pft">{{ panel === 'export' ? 'Export' : meta.label }}</span>
              <UIcon name="i-tabler-x" class="pfx" />
            </div>

            <template v-if="panel === 'export'">
              <p class="pf-name">Harbor moodboard</p>
              <p class="pf-text">Done</p>
              <p class="pf-text">Saved: Harbor moodboard.pile</p>
              <span class="pf-link">Show in Finder</span>
            </template>

            <template v-else-if="panel === 'people'">
              <div class="inv">
                <span class="tf grow muted">user@email.com</span>
                <span class="sel">Editor<UIcon name="i-tabler-chevron-down" class="sci" /></span>
                <span class="btn">Invite</span>
              </div>
              <p class="lab">People</p>
              <div class="pr"><span class="av a1">A</span><span class="who">anna@studio.com</span><span class="sel">Editor<UIcon name="i-tabler-chevron-down" class="sci" /></span></div>
              <div class="pr"><span class="av a2">M</span><span class="who">max@studio.com</span><span class="sel">Viewer<UIcon name="i-tabler-chevron-down" class="sci" /></span></div>
              <p class="lab">Invited, waiting</p>
              <div class="pr"><span class="av mail">@</span><span class="who">lena@studio.com</span><span class="sel">Viewer<UIcon name="i-tabler-chevron-down" class="sci" /></span><span class="pf-link">Send again</span></div>
            </template>

            <template v-else-if="panel === 'link'">
              <div class="plaque">pile-commander.app/anna/harbor-moodboard<UIcon name="i-tabler-pencil" class="sci" /></div>
              <div class="pairb">
                <span class="btn"><UIcon name="i-tabler-copy" class="sci" />Copy link</span>
                <span class="btn"><UIcon name="i-tabler-external-link" class="sci" />Open</span>
              </div>
              <div class="opt">
                <span class="sw on"><span class="knob" /></span>
                <span><span class="opt-t">Allow forks and .pile downloads</span><span class="opt-h">Visitors can copy this folder into their own account or download it as a .pile</span></span>
              </div>
              <span class="quiet">Close the link</span>
            </template>

            <template v-else-if="panel === 'publish'">
              <p class="muted">The card will appear in the Hub gallery. This is how it will look:</p>
              <div class="hc preview">
                <img src="/landing-alt2/sea-horizon.jpg" alt="" class="hci">
                <div class="hcb">
                  <p class="hct">Harbor moodboard</p>
                  <p class="hca">@anna</p>
                  <p class="hctags"><span class="htag">moodboard</span><span class="htag">summer</span></p>
                </div>
              </div>
              <div class="plaque">pile-commander.app/anna/harbor-moodboard</div>
              <span class="btn block"><UIcon name="i-tabler-world" class="sci" />Publish on the Hub</span>
              <p class="quota">Free: 1 of 3 listings</p>
            </template>
          </div>
        </template>
      </FinalAppWindow>
    </div>
  </section>
</template>

<style scoped>
.sec {
  padding: var(--lf-section) 0 0;
  scroll-margin-top: 1rem;
}

.head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.25rem 0.75rem;
  margin-bottom: 1.75rem;
}

.trow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
}

.title {
  margin: 0;
  font-size: clamp(1.75rem, 2.6vw, 2.25rem);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.15;
}

.lede,
.caption {
  grid-column: 2;
  margin: 0.625rem 0 0;
  color: var(--lf-ink-2);
  font-size: 1.0625rem;
  line-height: 1.5;
}

@media (min-width: 1100px) {
  .lede {
    white-space: nowrap;
  }
}

.steps {
  display: flex;
  grid-column: 2;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  border: 1px solid var(--lf-line-strong);
  border-radius: 6px;
  background: transparent;
  padding: 0.25rem 0.625rem 0.25rem 0.5rem;
  color: var(--lf-ink-2);
  font: inherit;
  font-size: 0.9375rem;
  cursor: pointer;
}

.chip:hover {
  border-color: rgb(0 0 0 / 0.3);
  color: var(--lf-ink);
}

.chip[aria-pressed="true"] {
  background: var(--lf-surface);
  color: var(--lf-ink);
  font-weight: 600;
}

.ci {
  width: 1.125rem;
  height: 1.125rem;
  flex: none;
}

.play {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.375rem;
  border: 1px solid var(--lf-line-strong);
  border-radius: 999px;
  background: var(--lf-surface);
  padding: 0.375rem 0.875rem;
  color: var(--lf-ink);
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
}

.play:hover {
  border-color: rgb(0 0 0 / 0.3);
}

.hint {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  margin: 0;
  border: 1px solid var(--lf-line-strong);
  border-radius: 999px;
  padding: 0.375rem 0.875rem;
  color: var(--lf-ink-3);
  font-size: 0.875rem;
  line-height: 1.5;
}

.pi {
  width: 1rem;
  height: 1rem;
}

.shot :deep(.fv) {
  --fv-h: 32em;
}

/* The share menu: 280px; share is followed by more */
.shm {
  position: absolute;
  top: 3.25em;
  right: calc(1.25em + 2.6em);
  z-index: 3;
  width: 21.5em;
}

/* ── The panels (PanelFrame.vue) ─────────────────────── */

.pf {
  position: absolute;
  top: 3.25em;
  right: calc(1.25em + 2.6em);
  z-index: 3;
  display: flex;
  box-sizing: border-box;
  flex-direction: column;
  gap: 0.62em;
  border: 1px solid rgb(0 0 0 / 0.15);
  border-radius: 0.62em;
  background: #fff;
  padding: 0.77em 0.77em 0.92em;
  box-shadow: 0 0.62em 1.85em rgb(0 0 0 / 0.1), 0 0.15em 0.46em rgb(0 0 0 / 0.06);
  color: #1f1f1e;
}

.pf.narrow {
  width: 17.7em;
}

.pf.wide {
  width: 29.2em;
}

.pfh {
  display: flex;
  align-items: center;
  gap: 0.46em;
}

.pfi,
.pfx {
  width: 1.23em;
  height: 1.23em;
  flex: none;
  color: #5f5e5a;
}

.pft {
  flex: 1;
  font-weight: 600;
}

.pf p {
  margin: 0;
}

.pf-name {
  font-weight: 500;
}

.pf-text,
.muted {
  color: #5f5e5a;
  font-size: 0.92em;
  line-height: 1.45;
}

.pf-link {
  color: #185fa5;
  font-size: 0.92em;
}

.inv,
.pr,
.pairb {
  display: flex;
  align-items: center;
  gap: 0.46em;
}

.grow {
  flex: 1;
}

.tf,
.sel,
.plaque {
  display: inline-flex;
  min-height: 2.3em;
  box-sizing: border-box;
  align-items: center;
  border: 1px solid rgb(0 0 0 / 0.15);
  border-radius: 0.54em;
  padding: 0 0.7em;
}

.tf.muted {
  color: #9a9893;
}

.sel {
  gap: 0.3em;
  width: 7.7em;
  justify-content: space-between;
}

.sci {
  width: 1.1em;
  height: 1.1em;
  flex: none;
}

.btn {
  display: inline-flex;
  height: 2.46em;
  align-items: center;
  justify-content: center;
  gap: 0.4em;
  border: 1px solid rgb(0 0 0 / 0.15);
  border-radius: 0.54em;
  background: #fff;
  padding: 0 1em;
  font-weight: 500;
  white-space: nowrap;
}

.btn.block {
  width: 100%;
  box-sizing: border-box;
}

.lab {
  margin-top: 0.3em !important;
  color: #9a9893;
  font-size: 0.85em;
}

.av {
  display: grid;
  width: 2em;
  height: 2em;
  flex: none;
  place-items: center;
  border-radius: 50%;
  font-weight: 600;
}

.a1 { background: #e6f1fb; color: #185fa5; }
.a2 { background: #eaf3de; color: #3b6d11; }
.mail { background: #f8f8f7; color: #9a9893; }

.who {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.plaque {
  justify-content: space-between;
  gap: 0.5em;
  background: #f8f8f7;
  font-size: 0.92em;
}

.pairb .btn {
  flex: 1;
}

/* Switch.vue, on */
.opt {
  display: flex;
  align-items: flex-start;
  gap: 0.62em;
}

.sw {
  position: relative;
  width: 2.3em;
  height: 1.38em;
  flex: none;
  border-radius: 99em;
  background: #378add;
}

.knob {
  position: absolute;
  top: 0.15em;
  right: 0.15em;
  width: 1.08em;
  height: 1.08em;
  border-radius: 50%;
  background: #fff;
}

.opt-t {
  display: block;
  font-weight: 500;
}

.opt-h {
  display: block;
  color: #5f5e5a;
  font-size: 0.85em;
  line-height: 1.4;
}

.quiet {
  color: #9a9893;
  font-size: 0.92em;
  text-align: center;
}

.quota {
  color: #9a9893;
  font-size: 0.85em;
  text-align: center;
}

/* ── The Hub's cards ─────────────────────────────────── */

.hub {
  display: grid;
  height: 32em;
  box-sizing: border-box;
  grid-template-columns: repeat(auto-fill, minmax(13em, 1fr));
  align-content: start;
  gap: 1em;
  overflow: hidden;
  background: #fff;
  padding: 1.2em;
}

.hc {
  overflow: hidden;
  border: 1px solid rgb(0 0 0 / 0.08);
  border-radius: 0.62em;
  background: #fff;
}

.hci {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
}

.hcb {
  padding: 0.6em 0.75em 0.7em;
}

.hcb p {
  margin: 0;
}

.hct {
  font-weight: 600;
}

.hca {
  color: #9a9893;
  font-size: 0.92em;
}

.hctags {
  display: flex;
  align-items: center;
  gap: 0.35em;
  margin-top: 0.45em !important;
}

.htag {
  border-radius: 0.46em;
  background: #f8f8f7;
  padding: 0.08em 0.5em;
  color: #5f5e5a;
  font-size: 0.85em;
}

.hfork {
  display: inline-flex;
  align-items: center;
  gap: 0.2em;
  margin-left: auto;
  color: #9a9893;
  font-size: 0.85em;
}

.hfi {
  width: 1.05em;
  height: 1.05em;
}

.preview {
  width: 60%;
  align-self: center;
}
</style>
