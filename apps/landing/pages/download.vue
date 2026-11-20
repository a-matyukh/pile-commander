<script setup lang="ts">
definePageMeta({ layout: "final" })

type DesktopAsset = { name: string; url: string; size: number };
type Platform = "mac" | "windows" | "linux";

const { clientUrl, demoUrl, desktopReleaseUrl } = useAppLinks();
const { os, macArch } = useVisitorPlatform();
const { data: release } = await useFetch("/api/desktop-release", { key: "desktop-release" });

useSeoMeta({
  title: "Download",
  description:
    "Download Pile Commander for macOS, Windows or Linux. The desktop app works directly on the folders on your disk and updates itself.",
  ogTitle: "Download — Pile Commander",
  ogDescription: "The desktop app for macOS, Windows and Linux.",
  ogImage: "/app-icon.png",
  twitterCard: "summary",
});

const isDesktop = computed(() => os.value === "mac" || os.value === "windows" || os.value === "linux");
const platform = ref<Platform>(isDesktop.value ? (os.value as Platform) : "mac");
// iPadOS is only told apart after mount; follow the detection until the visitor picks.
let picked = false;
watch(os, (value) => {
  if (!picked && (value === "mac" || value === "windows" || value === "linux")) platform.value = value;
});
function pick(value: Platform) {
  picked = true;
  platform.value = value;
}

const platforms: { id: Platform; label: string; icon: string }[] = [
  { id: "mac", label: "macOS", icon: "i-lucide-laptop" },
  { id: "windows", label: "Windows", icon: "i-lucide-monitor" },
  { id: "linux", label: "Linux", icon: "i-lucide-terminal" },
];

type Download = { label: string; asset: DesktopAsset };

const choice = computed<{ primary: Download | null; others: Download[] }>(() => {
  const a = release.value?.assets;
  if (!a) return { primary: null, others: [] };
  const list = (...items: [string, DesktopAsset | null][]): Download[] =>
    items.flatMap(([label, asset]) => (asset ? [{ label, asset }] : []));

  let ordered: Download[];
  if (platform.value === "mac") {
    const arm: [string, DesktopAsset | null] = ["Mac with Apple silicon", a.macArm];
    const intel: [string, DesktopAsset | null] = ["Mac with Intel", a.macIntel];
    ordered = macArch.value === "intel" ? list(intel, arm) : list(arm, intel);
  } else if (platform.value === "windows") {
    ordered = list(["Windows", a.windows]);
  } else {
    ordered = list(["Linux (AppImage)", a.appImage], [".deb", a.deb], [".rpm", a.rpm]);
  }
  return { primary: ordered[0] ?? null, others: ordered.slice(1) };
});

const releasePageUrl = computed(() => desktopReleaseUrl || release.value?.releaseUrl || "");

function megabytes(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(0)} MB`;
}

const appImageCommand = computed(
  () => `chmod +x ${release.value?.assets.appImage?.name ?? "Pile.Commander_*.AppImage"}`,
);

const copied = ref<string | null>(null);
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = text;
    setTimeout(() => {
      if (copied.value === text) copied.value = null;
    }, 1500);
  } catch {}
}

const platformName = computed(() => platforms.find((p) => p.id === platform.value)?.label ?? "");

/* The icon's shapes over the button: they come together and part while the
   page is open, hold together while the pointer is on the download, and
   play once on a platform switch. Reduced motion: still, the icon itself */
const reduced = ref(false);
const cycle = ref(false);
const hold = ref(false);
const together = computed(() => reduced.value || hold.value || cycle.value);

let timer: number | undefined;
function restart() {
  if (reduced.value) return;
  window.clearInterval(timer);
  cycle.value = true;
  timer = window.setInterval(() => { cycle.value = !cycle.value; }, 3200);
}

watch(platform, () => {
  if (reduced.value) return;
  cycle.value = false;
  window.setTimeout(restart, 900);
});

onMounted(() => {
  reduced.value = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.setTimeout(restart, 600);
});

onBeforeUnmount(() => window.clearInterval(timer));
</script>

<template>
  <div class="lf-page">
    <div class="lf-wrap">

      <div class="col">
        <div v-if="!isDesktop" class="lf-card web">
          <p class="wt">
            The desktop app runs on macOS, Windows and Linux. On this device,
            use Pile Commander in the browser.
          </p>
          <div class="row">
            <a :href="clientUrl" target="_blank" rel="noopener noreferrer" class="lf-btn lf-btn-primary">Open web app</a>
            <a :href="demoUrl" target="_blank" rel="noopener noreferrer" class="lf-btn lf-btn-secondary">Try a web demo</a>
          </div>
        </div>

        <article class="lf-card get">
          <!-- The app icon's shapes, coming together over the button -->
          <div class="art" :class="{ together }">
            <FinalShapes :together="together" />
          </div>

          <h1 class="gt">Pile Commander <span class="for">for {{ platformName }}</span></h1>

          <!-- The app's segmented control: the system to download for -->
          <div class="seg" role="tablist" aria-label="Operating system">
            <button
              v-for="p in platforms"
              :key="p.id"
              type="button"
              role="tab"
              :aria-selected="platform === p.id"
              class="sb"
              @click="pick(p.id)"
            >
              <UIcon :name="p.icon" class="sbi" />
              {{ p.label }}
            </button>
          </div>

          <div class="main">
            <template v-if="choice.primary">
              <a
                :href="choice.primary.asset.url"
                class="lf-btn lf-btn-primary big"
                @mouseenter="hold = true"
                @mouseleave="hold = false"
                @focus="hold = true"
                @blur="hold = false"
              >
                <UIcon name="i-lucide-download" class="size-[1.15em]" />
                Download for {{ choice.primary.label }}
              </a>
              <p class="file">
                {{ choice.primary.asset.name }} · {{ megabytes(choice.primary.asset.size) }}
              </p>

              <div v-if="choice.others.length" class="row">
                <a
                  v-for="other in choice.others"
                  :key="other.asset.url"
                  :href="other.asset.url"
                  class="lf-btn lf-btn-secondary"
                >
                  <UIcon name="i-lucide-download" class="size-[1.1em]" />
                  {{ platform === "mac" ? `For ${other.label}` : other.label }}
                </a>
              </div>
            </template>

            <template v-else>
              <a :href="releasePageUrl" target="_blank" rel="noopener noreferrer" class="lf-btn lf-btn-primary big">
                <UIcon name="i-lucide-external-link" class="size-[1.15em]" />
                Open the release page
              </a>
              <p class="file">Pick the file for your system there.</p>
            </template>
          </div>

          <ul class="perks">
            <li><UIcon name="i-lucide-badge-check" class="pk" />Free</li>
            <li><UIcon name="i-lucide-user-x" class="pk" />No account</li>
            <li><UIcon name="i-lucide-folder-open" class="pk" />Your real folders</li>
            <li><UIcon name="i-lucide-refresh-cw" class="pk" />Updates itself</li>
          </ul>

          <p v-if="choice.primary && releasePageUrl" class="more">
            Need another file?
            <a :href="releasePageUrl" target="_blank" rel="noopener noreferrer" class="lf-link">All files on the release page</a>
          </p>
        </article>

        <section class="lf-card after">
          <h2 class="h2">After you install</h2>

          <div v-if="platform === 'windows'" class="tx">
            <p>
              Windows SmartScreen says the publisher is unknown: choose
              <strong>More info</strong>, then <strong>Run anyway</strong>.
            </p>
          </div>

          <div v-else-if="platform === 'linux'" class="tx">
            <p>
              A downloaded <code>.AppImage</code> is not executable until you make
              it so:
            </p>
            <div class="cmd">
              <code class="cmdc">{{ appImageCommand }}</code>
              <button
                type="button"
                class="copy"
                :aria-label="copied === appImageCommand ? 'Copied' : 'Copy command'"
                @click="copy(appImageCommand)"
              >
                <UIcon :name="copied === appImageCommand ? 'i-lucide-check' : 'i-lucide-copy'" class="size-4" />
              </button>
            </div>
            <p><code>.deb</code> and <code>.rpm</code> install as usual.</p>
          </div>

          <p class="upd">The desktop app updates itself when a new release comes out.</p>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.col {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1.25rem;
  max-width: 46rem;
  margin-inline: auto;
}

.web {
  display: grid;
  justify-items: center;
  gap: 1rem;
  text-align: center;
}

.wt {
  margin: 0;
  color: var(--lf-ink-2);
  line-height: 1.55;
}

.row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.6rem;
}

/* The card: everything on its middle line, the shapes on top */
.get {
  display: grid;
  justify-items: center;
  padding-top: clamp(2rem, 5vw, 3rem);
  text-align: center;
}

.art {
  width: min(22rem, 100%);
  margin-bottom: 0.5rem;
}

.gt {
  margin: 0 0 1.5rem;
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.1;
  text-wrap: balance;
}

.for {
  color: var(--lf-accent);
}

/* What comes with it, as small chips */
.perks {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
  margin: 1.75rem 0 0;
  padding: 0;
  list-style: none;
}

.perks li {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid var(--lf-line);
  border-radius: 99em;
  background: var(--lf-bg);
  padding: 0.3rem 0.8rem;
  color: var(--lf-ink-2);
  font-size: 0.875rem;
}

.pk {
  width: 1rem;
  height: 1rem;
  color: var(--lf-accent);
}

/* As the app's segmented control: a gray track, the chosen one white */
.seg {
  display: grid;
  width: 100%;
  max-width: 26rem;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.25rem;
  border-radius: 12px;
  background: var(--lf-bg);
  padding: 0.25rem;
}

.sb {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  border: 0;
  border-radius: 9px;
  background: transparent;
  padding: 0.5rem 0.5rem;
  color: var(--lf-ink-2);
  font: inherit;
  font-size: 0.9375rem;
  cursor: pointer;
}

.sb:hover {
  color: var(--lf-ink);
}

.sb[aria-selected="true"] {
  background: var(--lf-surface);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.1);
  color: var(--lf-ink);
  font-weight: 600;
}

.sbi {
  width: 1rem;
  height: 1rem;
}

.main {
  display: grid;
  justify-items: center;
  gap: 0.75rem;
  margin-top: 1.75rem;
}

.big {
  min-height: 3.375rem;
  padding: 0 1.75rem;
  font-size: 1.0625rem;
}

/* A phone: the buttons take the card's width, and long names wrap */
@media (max-width: 560px) {
  .main {
    justify-self: stretch;
    justify-items: stretch;
  }

  .main .lf-btn {
    min-height: 3rem;
    padding-block: 0.6rem;
    white-space: normal;
    text-align: center;
  }
}

.file {
  margin: 0;
  color: var(--lf-ink-3);
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}

.more {
  justify-self: stretch;
  margin: 1.75rem 0 0;
  border-top: 1px solid var(--lf-line);
  padding-top: 1.25rem;
  color: var(--lf-ink-2);
  font-size: 0.9375rem;
}

.h2 {
  margin: 0;
  font-size: 1.3rem;
  font-weight: 700;
  letter-spacing: -0.015em;
}

.tx {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.75rem;
  margin-top: 1rem;
  color: var(--lf-ink-2);
  line-height: 1.55;
}

.tx p {
  margin: 0;
}

.tx strong {
  color: var(--lf-ink);
}

.tx code,
.cmdc {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.875em;
}

.cmd {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border-radius: 10px;
  background: var(--lf-bg);
  padding: 0.4rem 0.4rem 0.4rem 1rem;
}

.cmdc {
  min-width: 0;
  flex: 1;
  overflow-x: auto;
  color: var(--lf-ink);
  white-space: nowrap;
}

.copy {
  display: grid;
  width: 2rem;
  height: 2rem;
  flex: none;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--lf-ink-2);
  cursor: pointer;
}

.copy:hover {
  background: var(--lf-surface);
  color: var(--lf-ink);
}

.upd {
  margin: 1.25rem 0 0;
  border-top: 1px solid var(--lf-line);
  padding-top: 1.25rem;
  color: var(--lf-ink-2);
  font-size: 0.9375rem;
}
</style>
