/** Tagline options under review (?tag=1|2|3, ReviewSwitch.vue). The second
 *  part is the accent. Once the owner picks one, this file and the switch go. */
export const finalTaglines = [
  { id: "1", lead: "A file manager.", accent: "A creative space." },
  { id: "2", lead: "File manager.", accent: "Creative space." },
  { id: "3", lead: "Your file manager", accent: "& creative space." },
] as const;

export function useFinalTagline() {
  const route = useRoute();
  return computed(() => finalTaglines.find(t => t.id === route.query.tag) ?? finalTaglines[0]);
}
