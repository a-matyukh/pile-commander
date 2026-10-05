export function useAppLinks() {
  const config = useRuntimeConfig();
  const clientUrl = String(config.public.clientUrl).replace(/\/$/, "");
  const backendUrl = String(config.public.backendUrl).replace(/\/$/, "");
  const desktopAppUrl = String(config.public.desktopAppUrl ?? "")
    .trim()
    .replace(/\/$/, "");
  return {
    clientUrl,
    demoUrl: `${clientUrl}/demo`,
    backendUrl,
    /** Every "Download desktop app" goes to /download, which picks the file. */
    desktopAppLink: { to: "/download" },
    /** All release files. Empty only if NUXT_PUBLIC_DESKTOP_APP_URL is set to "". */
    desktopReleaseUrl: desktopAppUrl,
  };
}
