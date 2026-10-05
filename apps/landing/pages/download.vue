<script setup lang="ts">
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

const publishedOn = computed(() => {
  const at = release.value?.publishedAt;
  if (!at) return "";
  return new Date(at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
});

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
</script>

<template>
  <div>
    <section class="relative overflow-hidden px-5 pt-16 pb-10 md:pt-24">
      <div
        class="pointer-events-none absolute -top-32 left-1/2 size-[32rem] -translate-x-1/2 rounded-full bg-pc-400/20 blur-3xl"
        aria-hidden="true"
      />
      <div class="relative mx-auto max-w-2xl text-center">
        <img src="/app-icon.png" alt="" width="80" height="80" class="mx-auto size-20 rounded-2xl" />
        <h1 class="mt-6 text-4xl tracking-tight text-slate-900 md:text-5xl">
          Download Pile Commander
        </h1>
        <p class="mx-auto mt-4 max-w-xl text-base leading-relaxed text-slate-600 md:text-lg">
          The desktop app works directly on the folders on your disk. It is
          free, needs no account, and updates itself.
        </p>
        <p v-if="release" class="mt-3 text-sm text-slate-500">
          Version {{ release.version }}<template v-if="publishedOn"> · {{ publishedOn }}</template>
        </p>
      </div>
    </section>

    <section class="px-5 pb-12">
      <div class="mx-auto max-w-2xl">
        <div
          v-if="!isDesktop"
          class="mb-5 rounded-2xl border border-[var(--pc-gray-border)] bg-white p-6 text-center"
        >
          <p class="text-sm leading-relaxed text-slate-600">
            The desktop app runs on macOS, Windows and Linux. On this device,
            use Pile Commander in the browser.
          </p>
          <div class="mt-4 flex flex-wrap justify-center gap-2.5">
            <UButton :href="clientUrl" target="_blank" rel="noopener noreferrer" color="primary">
              Open web app
            </UButton>
            <UButton
              :href="demoUrl"
              target="_blank"
              rel="noopener noreferrer"
              color="neutral"
              variant="outline"
            >
              Try a web demo
            </UButton>
          </div>
        </div>

        <article class="rounded-2xl border border-[var(--pc-gray-border)] bg-white p-6 md:p-8">
          <div
            class="mx-auto grid max-w-sm grid-cols-3 gap-1 rounded-xl bg-[var(--pc-gray-muted)] p-1"
            role="tablist"
            aria-label="Operating system"
          >
            <button
              v-for="p in platforms"
              :key="p.id"
              type="button"
              role="tab"
              :aria-selected="platform === p.id"
              class="flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm transition-colors"
              :class="
                platform === p.id
                  ? 'bg-white font-semibold text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              "
              @click="pick(p.id)"
            >
              <UIcon :name="p.icon" class="size-4" />
              {{ p.label }}
            </button>
          </div>

          <div class="mt-8 text-center">
            <template v-if="choice.primary">
              <UButton
                :href="choice.primary.asset.url"
                external
                color="primary"
                size="xl"
                icon="i-lucide-download"
                class="px-8 py-4 text-lg"
              >
                Download for {{ choice.primary.label }}
              </UButton>
              <p class="mt-3 text-xs break-all text-slate-500">
                {{ choice.primary.asset.name }} · {{ megabytes(choice.primary.asset.size) }}
              </p>

              <div v-if="choice.others.length" class="mt-5 flex flex-wrap justify-center gap-2.5">
                <UButton
                  v-for="other in choice.others"
                  :key="other.asset.url"
                  :href="other.asset.url"
                  external
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-download"
                >
                  {{ platform === "mac" ? `For ${other.label}` : other.label }}
                </UButton>
              </div>
            </template>

            <template v-else>
              <UButton
                :href="releasePageUrl"
                target="_blank"
                rel="noopener noreferrer"
                color="primary"
                size="xl"
                icon="i-lucide-external-link"
                class="px-8 py-4 text-lg"
              >
                Open the release page
              </UButton>
              <p class="mt-3 text-sm text-slate-500">
                Pick the file for your system there.
              </p>
            </template>
          </div>

          <p
            v-if="choice.primary && releasePageUrl"
            class="mt-8 border-t border-[var(--pc-gray-border)] pt-5 text-center text-sm text-slate-500"
          >
            Need another file?
            <a
              :href="releasePageUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="font-medium text-pc-600 hover:text-pc-700"
            >
              All files on the release page
            </a>
          </p>
        </article>
      </div>
    </section>

    <section class="px-5 pb-20">
      <div class="mx-auto max-w-2xl rounded-2xl border border-[var(--pc-gray-border)] bg-white p-6 md:p-8">
        <h2 class="text-xl font-semibold tracking-tight text-slate-900">After you install</h2>

        <div v-if="platform === 'windows'" class="mt-4 text-sm leading-relaxed text-slate-600">
          <p>
            Windows SmartScreen says the publisher is unknown: choose
            <strong>More info</strong>, then <strong>Run anyway</strong>.
          </p>
        </div>

        <div v-else-if="platform === 'linux'" class="mt-4 space-y-3 text-sm leading-relaxed text-slate-600">
          <p>
            A downloaded <code>.AppImage</code> is not executable until you make
            it so:
          </p>
          <div class="flex items-center gap-2 rounded-xl bg-[var(--pc-gray-muted)] py-2 pr-2 pl-4">
            <code class="min-w-0 flex-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap text-slate-800">{{ appImageCommand }}</code>
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              :icon="copied === appImageCommand ? 'i-lucide-check' : 'i-lucide-copy'"
              :aria-label="copied === appImageCommand ? 'Copied' : 'Copy command'"
              @click="copy(appImageCommand)"
            />
          </div>
          <p><code>.deb</code> and <code>.rpm</code> install as usual.</p>
        </div>

        <p class="mt-5 border-t border-[var(--pc-gray-border)] pt-5 text-sm leading-relaxed text-slate-600">
          The desktop app updates itself when a new release comes out.
        </p>
      </div>
    </section>
  </div>
</template>
