/**
 * The main action by the visitor's OS: "Download for macOS" and the like on a
 * computer; a phone cannot run the desktop app, so its pages lead with the
 * web demo instead (see `os === "mobile"` in the templates).
 */
export function useDownloadCta() {
  const { os } = useVisitorPlatform();

  const names: Record<string, string> = { mac: "macOS", windows: "Windows", linux: "Linux" };
  const downloadLabel = computed(() => {
    const name = names[os.value];
    return name ? `Download for ${name}` : "Download desktop app";
  });

  return { os, downloadLabel };
}
