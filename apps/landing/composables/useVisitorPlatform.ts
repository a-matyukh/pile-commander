export type VisitorOs = "mac" | "windows" | "linux" | "mobile" | "unknown";
export type MacArch = "arm" | "intel";

function osFromUserAgent(ua: string): VisitorOs {
  // iPadOS reports itself as a Mac; touch points tell them apart on the client.
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return "mobile";
  if (/Mac OS X|Macintosh/i.test(ua)) return "mac";
  if (/Windows/i.test(ua)) return "windows";
  if (/Linux|X11|CrOS/i.test(ua)) return "linux";
  return "unknown";
}

type UaData = { getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }> };

async function detectMacArch(): Promise<MacArch | null> {
  const uaData = (navigator as Navigator & { userAgentData?: UaData }).userAgentData;
  try {
    const values = await uaData?.getHighEntropyValues?.(["architecture"]);
    if (values?.architecture === "arm") return "arm";
    if (values?.architecture === "x86") return "intel";
  } catch {}
  // Safari and Firefox always say "Intel Mac OS X"; the GPU name does not lie.
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    const renderer = info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    if (/Apple M\d|Apple GPU/i.test(renderer)) return "arm";
    if (/Intel|AMD|Radeon|NVIDIA/i.test(renderer)) return "intel";
  } catch {}
  return null;
}

/**
 * The visitor's OS from the User-Agent — read from the request on the server
 * and from navigator on the client, so the first paint already has the right
 * button. Mac architecture is refined after mount; Apple silicon is the
 * default when nothing tells.
 */
export function useVisitorPlatform() {
  const ua = import.meta.server
    ? (useRequestHeaders(["user-agent"])["user-agent"] ?? "")
    : navigator.userAgent;
  const os = ref<VisitorOs>(osFromUserAgent(ua));
  const macArch = ref<MacArch>("arm");

  onMounted(async () => {
    if (os.value === "mac" && navigator.maxTouchPoints > 1) {
      os.value = "mobile";
      return;
    }
    if (os.value === "mac") macArch.value = (await detectMacArch()) ?? "arm";
  });

  return { os, macArch };
}
