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
    /** `#` until NUXT_PUBLIC_DESKTOP_APP_URL is set, so the CTAs still render. */
    desktopAppLink: desktopAppUrl
      ? { href: desktopAppUrl, target: "_blank", rel: "noopener noreferrer" }
      : { href: "#" },
  };
}
