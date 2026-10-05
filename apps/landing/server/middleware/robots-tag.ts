export default defineEventHandler((event) => {
  if (useRuntimeConfig(event).public.allowIndexing === true) return;
  setHeader(event, "X-Robots-Tag", "noindex, nofollow");
});
