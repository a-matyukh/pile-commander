import { fileURLToPath } from "node:url";

// launch-editor (Vite overlay and Nuxt DevTools) passes file, line, and
// column as separate args when LAUNCH_EDITOR is set. Same contract as
// apps/client/scripts/cursor-goto.sh.
process.env.LAUNCH_EDITOR = fileURLToPath(
  new URL("./scripts/cursor-goto.sh", import.meta.url),
);

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  devtools: { enabled: true },
  ssr: true,
  modules: ["@nuxt/ui"],
  css: ["~/assets/css/main.css"],
  ui: {
    fonts: false,
  },
  colorMode: {
    preference: "light",
    fallback: "light",
    storage: "cookie",
  },
  runtimeConfig: {
    // Server only. Optional token for the GitHub API behind /download; the
    // anonymous limit is enough with the 10-minute cache.
    // Overridden by NUXT_GITHUB_TOKEN
    githubToken: "",
    public: {
      // Overridden by NUXT_PUBLIC_CLIENT_URL
      clientUrl: "http://localhost:5173",
      // Overridden by NUXT_PUBLIC_BACKEND_URL
      backendUrl: "http://localhost:3000",
      // GitHub Releases page for the desktop installers: /download reads the
      // latest release of this repo and links here for the other files.
      // Overridden by NUXT_PUBLIC_DESKTOP_APP_URL.
      desktopAppUrl:
        "https://github.com/a-matyukh/pile-commander/releases/latest",
      // Overridden by NUXT_PUBLIC_ABUSE_EMAIL
      abuseEmail: "abuse@pile-commander.app",
      // Who operates the service, for /terms and /privacy. The defaults are
      // deliberately unmissable placeholders: fill them in before launch.
      // Overridden by NUXT_PUBLIC_OPERATOR_NAME
      operatorName: "[LEGAL ENTITY — beta, not yet registered]",
      // Overridden by NUXT_PUBLIC_OPERATOR_LOCATION
      operatorLocation: "[COUNTRY]",
      // Overridden by NUXT_PUBLIC_GOVERNING_LAW
      governingLaw: "[COUNTRY]",
      // Search indexing. False sends noindex (meta + X-Robots-Tag).
      // Overridden by NUXT_PUBLIC_ALLOW_INDEXING — set true to allow indexing.
      allowIndexing: false,
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: "en", "data-color-mode-forced": "light" },
      link: [{ rel: "icon", type: "image/png", href: "/app-icon.png" }],
    },
  },
});
