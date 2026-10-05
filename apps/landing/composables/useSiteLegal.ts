/**
 * Identity of whoever operates the service, for the legal pages. Kept in one
 * place because the beta ships with placeholders: swapping them for a real
 * entity is an env change, not an edit across /terms, /privacy and /support.
 *
 * An env var that is present but empty (a copied .env.example) would otherwise
 * override the default with "", leaving a blank where the operator should be —
 * so an empty value falls back to the visible placeholder.
 */
const PLACEHOLDER = {
  operatorName: "[LEGAL ENTITY — beta, not yet registered]",
  operatorLocation: "[COUNTRY]",
  governingLaw: "[COUNTRY]",
};

function text(value: unknown, fallback: string) {
  return String(value ?? "").trim() || fallback;
}

export function useSiteLegal() {
  const config = useRuntimeConfig();
  return {
    operatorName: text(config.public.operatorName, PLACEHOLDER.operatorName),
    operatorLocation: text(config.public.operatorLocation, PLACEHOLDER.operatorLocation),
    governingLaw: text(config.public.governingLaw, PLACEHOLDER.governingLaw),
    abuseEmail: String(config.public.abuseEmail),
  };
}
