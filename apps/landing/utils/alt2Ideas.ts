/** The page's six ideas, in order: their anchors, the header's short names,
 *  and the legend under the hero's map. The numbers match the map's markers. */
export const alt2Ideas = [
  { n: 1, id: "views", short: "Views", title: "Nine views", hint: "From a list to 3D, per folder" },
  { n: 2, id: "ai", short: "AI", title: "AI", hint: "Your model or your agent" },
  { n: 3, id: "sync", short: "Sync", title: "Cloud copy", hint: "Sync any folder" },
  { n: 4, id: "share", short: "Share", title: "Share and Hub", hint: "People, a link, a gallery" },
  { n: 5, id: "devices", short: "Any screen", title: "Any screen", hint: "Desktop, tablet, phone" },
  { n: 6, id: "disk", short: "Your disk", title: "Your disk", hint: "Stays after you delete the app" },
] as const;

export type Alt2Idea = (typeof alt2Ideas)[number];
