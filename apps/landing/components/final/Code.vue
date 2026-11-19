<!-- Block 8, transparency: source available, the code public to read. Not
     "open source": the repository has no license file. Static, the last block: the
     repository as its folders, the stack from README.md's badges, how the
     app keeps things from the home page's "Under the hood"
     (UnderTheHood.vue), then the ways in once more. -->
<script setup lang="ts">
const githubUrl = "https://github.com/a-matyukh/pile-commander";
const { demoUrl } = useAppLinks();
const { os, downloadLabel } = useDownloadCta();
const external = { target: "_blank", rel: "noopener noreferrer" };

const folders = [
  { name: "apps/client", text: "The app: the web app and, with Tauri, the desktop one" },
  { name: "apps/backend", text: "The server: accounts, uploads, thumbnails" },
  { name: "apps/landing", text: "This page" },
  { name: "packages/file-manager", text: "Folders and files, the database schema and its rules" },
  { name: "packages/tauri-plugin-xattrs", text: "Reads and writes the files' own attributes" },
];

const stack = ["Vue 3.5", "Tauri 2", "TypeScript", "Bun", "Supabase: Postgres + RLS", "Backblaze B2"];

const facts = [
  { icon: "i-tabler-tag", title: "Layout on the files", text: "Position, size, view and background are written on the files themselves: xattrs on macOS and Linux, alternate data streams on Windows (NTFS)." },
  { icon: "i-tabler-folder", title: "Your file system", text: "The desktop app works in the same folders you see in Finder or Explorer. The browser keeps its folders in IndexedDB." },
  { icon: "i-tabler-file-zip", title: ".pile archives", text: "A zip of the folder with its attributes, so the layout survives email, USB sticks and file systems that drop them." },
];
</script>

<template>
  <section id="code" class="sec" aria-labelledby="code-title">
    <div class="lf-wrap">
      <header class="head">
        <span class="lf-marker" aria-hidden="true">8</span>
        <h2 id="code-title" class="title">The code is open to read</h2>
        <p class="lede">See how Pile Commander works and what it does with your files: all of it is in one public repository.</p>
      </header>

      <div class="grid">
        <!-- The repository, as its folders -->
        <a :href="githubUrl" v-bind="external" class="repo">
          <span class="rh">
            <UIcon name="i-tabler-brand-github" class="rgi" />
            <span class="rn">a-matyukh/pile-commander</span>
            <span class="rp">Source available</span>
          </span>
          <ul class="rf">
            <li v-for="f in folders" :key="f.name">
              <span class="fn"><UIcon name="i-tabler-folder" class="fi" />{{ f.name }}</span>
              <span class="ft">{{ f.text }}</span>
            </li>
          </ul>
          <span class="rs">
            <span v-for="s in stack" :key="s" class="st">{{ s }}</span>
          </span>
          <span class="rgo">View the code on GitHub<UIcon name="i-tabler-arrow-up-right" class="rga" /></span>
        </a>

        <!-- How the folder keeps its layout -->
        <FinalXattrTree />
      </div>

      <!-- How it keeps things -->
      <ul class="facts">
          <li v-for="f in facts" :key="f.title" class="fact">
            <span class="fic"><UIcon :name="f.icon" class="fii" /></span>
            <span>
              <span class="fti">{{ f.title }}</span>
              <span class="fte">{{ f.text }}</span>
            </span>
          </li>
        </ul>

      <!-- The ways in, once more -->
      <div class="end">
        <p class="et">File manager. <span class="em">Creative space.</span></p>
        <div class="eb">
          <a v-if="os === 'mobile'" :href="demoUrl" v-bind="external" class="lf-btn lf-btn-primary">Try in the browser</a>
          <template v-else>
            <NuxtLink to="/download" class="lf-btn lf-btn-primary">
              <UIcon name="i-lucide-download" class="size-[1.1em]" />
              {{ downloadLabel }}
            </NuxtLink>
            <a :href="demoUrl" v-bind="external" class="lf-btn lf-btn-secondary">Try in the browser</a>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sec {
  padding: var(--lf-section) 0 var(--lf-section);
  scroll-margin-top: 1rem;
}

.head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.25rem 0.75rem;
  margin-bottom: 1.75rem;
}

.title {
  margin: 0;
  font-size: clamp(1.75rem, 2.6vw, 2.25rem);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.15;
}

.lede {
  grid-column: 2;
  margin: 0.625rem 0 0;
  color: var(--lf-ink-2);
  font-size: 1.0625rem;
  line-height: 1.5;
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1.5rem;
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* ── The repository ──────────────────────────────────── */

.repo {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  border: 1px solid var(--lf-line-strong);
  border-radius: 12px;
  background: var(--lf-surface);
  padding: 1.25rem 1.5rem;
  color: var(--lf-ink);
  text-decoration: none;
  transition: border-color 0.15s ease;
}

.repo:hover {
  border-color: rgb(0 0 0 / 0.3);
}

.rh {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.rgi {
  width: 1.375rem;
  height: 1.375rem;
}

.rn {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 600;
}

.rp {
  border: 1px solid var(--lf-line-strong);
  border-radius: 99em;
  padding: 0.05rem 0.5rem;
  color: var(--lf-ink-3);
  font-size: 0.75rem;
}

.rf {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--lf-line);
  border-radius: 8px;
}

.rf li {
  display: grid;
  grid-template-columns: minmax(10rem, auto) minmax(0, 1fr);
  gap: 1rem;
  padding: 0.55rem 0.8rem;
  font-size: 0.875rem;
}

.rf li + li {
  border-top: 1px solid var(--lf-line);
}

@media (max-width: 560px) {
  .rf li {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.15rem;
  }
}

.fn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.fi {
  width: 1rem;
  height: 1rem;
  color: #378add;
}

.ft {
  color: var(--lf-ink-3);
}

.rs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.st {
  border: 1px solid var(--lf-line);
  border-radius: 6px;
  background: var(--lf-bg);
  padding: 0.15rem 0.55rem;
  color: var(--lf-ink-2);
  font-size: 0.8125rem;
}

.rgo {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  margin-top: auto;
  color: var(--lf-accent);
  font-weight: 600;
}

.rga {
  width: 1.1rem;
  height: 1.1rem;
}

/* ── How it keeps things ─────────────────────────────── */

.facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1.5rem;
  margin: 2rem 0 0;
  padding: 0;
  list-style: none;
}

.fact {
  display: flex;
  gap: 0.875rem;
}

.fic {
  display: grid;
  width: 2.25rem;
  height: 2.25rem;
  flex: none;
  place-items: center;
  border: 1px solid var(--lf-line-strong);
  border-radius: 8px;
  background: var(--lf-surface);
}

.fii {
  width: 1.15rem;
  height: 1.15rem;
}

.fti {
  display: block;
  font-weight: 600;
}

.fte {
  display: block;
  margin-top: 0.2rem;
  color: var(--lf-ink-2);
  font-size: 0.9375rem;
  line-height: 1.5;
}

@media (max-width: 900px) {
  .facts {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* ── The ways in ─────────────────────────────────────── */

.end {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem 2rem;
  margin-top: clamp(3rem, 6vw, 5rem);
  border-top: 1px solid var(--lf-line);
  padding-top: 2rem;
}

.et {
  margin: 0;
  font-size: clamp(1.5rem, 2.4vw, 2rem);
  font-weight: 700;
  letter-spacing: -0.025em;
}

.em {
  color: var(--lf-accent);
}

.eb {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
</style>
