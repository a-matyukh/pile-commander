/**
 * Who operates the service, for the legal pages: KMCN Lab LLC. Kept in one
 * place, so a change is an env change, not an edit across /terms, /privacy
 * and /support.
 *
 * An env var that is present but empty (a copied .env.example) would otherwise
 * override the default with "", leaving a blank where the operator should be —
 * so an empty value falls back to the company.
 */
const DEFAULTS = {
  operatorName: "KMCN Lab LLC",
  operatorLocation: "Wyoming, United States",
  governingLaw: "the State of Wyoming, United States",
};

function text(value: unknown, fallback: string) {
  return String(value ?? "").trim() || fallback;
}

export function useSiteLegal() {
  const config = useRuntimeConfig();
  return {
    operatorName: text(config.public.operatorName, DEFAULTS.operatorName),
    operatorLocation: text(config.public.operatorLocation, DEFAULTS.operatorLocation),
    governingLaw: text(config.public.governingLaw, DEFAULTS.governingLaw),
    abuseEmail: String(config.public.abuseEmail),
  };
}
