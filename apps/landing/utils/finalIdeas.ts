/** The final landing's blocks 1–6, in order: their anchors and the legend
 *  under the intro's window. The numbers match the markers on the window. */
export const finalIdeas = [
  { n: 1, id: "views", title: "Nine views", hint: "One folder, nine ways to see it" },
  { n: 2, id: "files", title: "Files and folders come alive", hint: "Notes, previews, covers, the pen" },
  { n: 3, id: "ai", title: "AI", hint: "Summarize, rename, sort, ideas" },
  { n: 4, id: "sync", title: "Sync & cloud", hint: "Sync any folder, or keep it only in the cloud" },
  { n: 5, id: "share", title: "Share", hint: "A file, a person, a link, the Hub" },
  { n: 6, id: "screens", title: "Any screen", hint: "Desktop, tablet, phone, browser" },
] as const;

/** Every block for the pinned menu: 1–6, then 7 and 8, which have no place
 *  in the window and so no marker on it, then the demo (Demo.vue), which
 *  is not a numbered block: Play on its marker */
export const finalBlocks = [
  ...finalIdeas,
  { n: 7, id: "yours", title: "Your files stay yours", hint: "On your disk and in the cloud" },
  { n: 8, id: "code", title: "Source available", hint: "The code, open to read" },
  { n: 9, id: "demo", title: "Play with the demo", hint: "19 use cases in your browser", icon: "i-tabler-player-play-filled" },
] as const;

export type FinalIdea = (typeof finalIdeas)[number];
