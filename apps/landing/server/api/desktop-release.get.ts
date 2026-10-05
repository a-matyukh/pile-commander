// The latest desktop release, trimmed to the installers /download offers.
// Asset names carry the version, so they are looked up here instead of being
// hard-coded: a new release shows up without redeploying the landing.

type GithubAsset = { name: string; size: number; browser_download_url: string };
type GithubRelease = {
  tag_name: string;
  published_at: string | null;
  html_url: string;
  assets: GithubAsset[];
};

export type DesktopAsset = { name: string; url: string; size: number };

export type DesktopRelease = {
  version: string;
  publishedAt: string | null;
  releaseUrl: string;
  assets: {
    macArm: DesktopAsset | null;
    macIntel: DesktopAsset | null;
    windows: DesktopAsset | null;
    appImage: DesktopAsset | null;
    deb: DesktopAsset | null;
    rpm: DesktopAsset | null;
  };
};

const DEFAULT_REPO = "a-matyukh/pile-commander";

function repoFrom(desktopAppUrl: string): string {
  const match = /github\.com\/([^/]+\/[^/]+)/.exec(desktopAppUrl);
  return match?.[1] ?? DEFAULT_REPO;
}

export default defineCachedEventHandler(
  async (event): Promise<DesktopRelease> => {
    const config = useRuntimeConfig(event);
    const repo = repoFrom(String(config.public.desktopAppUrl ?? ""));
    const token = String(config.githubToken ?? "").trim();

    let release: GithubRelease;
    try {
      release = await $fetch<GithubRelease>(
        `https://api.github.com/repos/${repo}/releases/latest`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "pile-commander-landing",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          timeout: 8000,
        },
      );
    } catch {
      throw createError({ statusCode: 502, statusMessage: "GitHub release unavailable" });
    }

    const installers = release.assets.filter(
      (a) => !a.name.endsWith(".sig") && !a.name.endsWith(".tar.gz"),
    );
    const pick = (...suffixes: string[]): DesktopAsset | null => {
      for (const suffix of suffixes) {
        const asset = installers.find((a) => a.name.endsWith(suffix));
        if (asset) return { name: asset.name, url: asset.browser_download_url, size: asset.size };
      }
      return null;
    };

    return {
      version: release.tag_name.replace(/^v/, ""),
      publishedAt: release.published_at,
      releaseUrl: release.html_url,
      assets: {
        macArm: pick("_aarch64.dmg"),
        macIntel: pick("_x64.dmg"),
        windows: pick("-setup.exe", ".msi"),
        appImage: pick(".AppImage"),
        deb: pick(".deb"),
        rpm: pick(".rpm"),
      },
    };
  },
  { name: "desktop-release", maxAge: 600, swr: true, getKey: () => "latest" },
);
