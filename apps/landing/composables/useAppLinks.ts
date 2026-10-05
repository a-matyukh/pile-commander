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
    /** `#` only if NUXT_PUBLIC_DESKTOP_APP_URL is set to an empty string. */
    desktopAppLink: desktopAppUrl
      ? { href: desktopAppUrl, target: "_blank", rel: "noopener noreferrer" }
      : { href: "#" },
  };
}
