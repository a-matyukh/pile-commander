<!-- Block 8, transparency: source available, the code public to read. Not
     "open source": the repository has no license file. Static, the last block:
     the repository as its folders and the stack from README.md's badges. How
     the files keep their layout (xattrs, .pile) is in the README; the
     browser's storage is in block 6, .pile files in block 5. The page ends
     with Finale.vue. -->
<script setup lang="ts">
const githubUrl = "https://github.com/a-matyukh/pile-commander";
const external = { target: "_blank", rel: "noopener noreferrer" };

const folders = [
  { name: "apps/client", text: "The app: the web app and, with Tauri, the desktop one" },
  { name: "apps/backend", text: "The server: accounts, uploads, thumbnails" },
  { name: "apps/landing", text: "This page" },
  { name: "apps/mcp", text: "Lets an AI agent work with your folders through the app" },
  { name: "packages/file-manager", text: "Folders and files, the database schema and its rules" },
  { name: "packages/tauri-plugin-xattrs", text: "Reads and writes the files' own attributes" },
];

const stack = ["Vue 3.5", "Tauri 2", "TypeScript", "Bun", "Supabase: Postgres + RLS", "Backblaze B2"];

</script>

<template>
  <section id="code" class="sec" aria-labelledby="code-title">
    <div class="lf-wrap">
      <header class="head">
        <span class="lf-marker" aria-hidden="true">8</span>
        <h2 id="code-title" class="title">Source available</h2>
        <p class="lede">The code is open to read: see how Pile Commander works and what it does with your files, all in one public repository.</p>
      </header>

      <!-- The repository: its name, stack and link beside its folders -->
      <a :href="githubUrl" v-bind="external" class="repo">
        <span class="rl">
          <span class="rh">
            <UIcon name="i-tabler-brand-github" class="rgi" />
            <span class="rn">a-matyukh/pile-commander</span>
            <span class="rp">Public</span>
          </span>
          <span class="rs">
            <span v-for="s in stack" :key="s" class="st">{{ s }}</span>
          </span>
          <span class="rgo">View the code on GitHub<UIcon name="i-tabler-arrow-up-right" class="rga" /></span>
        </span>
        <ul class="rf">
          <li v-for="f in folders" :key="f.name">
            <span class="fn"><UIcon name="i-tabler-folder" class="fi" />{{ f.name }}</span>
            <span class="ft">{{ f.text }}</span>
          </li>
        </ul>
      </a>

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

/* ── The repository ──────────────────────────────────── */

/* Wide: the name, the stack and the link on the left, the folders on the
   right; narrower, one column */
.repo {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
  align-items: start;
  gap: 1.5rem 2.5rem;
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

@media (max-width: 900px) {
  .repo {
    grid-template-columns: minmax(0, 1fr);
  }
}

.rl {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
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
  color: var(--lf-accent);
  font-weight: 600;
}

.rga {
  width: 1.1rem;
  height: 1.1rem;
}

</style>
