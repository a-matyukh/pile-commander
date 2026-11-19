/** The final landing's blocks 1–6, in order: their anchors and the legend
 *  under the intro's window. The numbers match the markers on the window.
 *  Blocks 7 (your files stay yours) and 8 (open source) have no marker. */
export const finalIdeas = [
  { n: 1, id: "views", title: "Nine views", hint: "One folder, nine ways to see it" },
  { n: 2, id: "files", title: "Files come alive", hint: "Notes, previews, covers, the pen" },
  { n: 3, id: "ai", title: "AI", hint: "Summarize, rename, sort, ideas" },
  { n: 4, id: "sync", title: "Sync", hint: "A cloud copy of any folder" },
  { n: 5, id: "share", title: "Share", hint: "A file, a person, a link, the Hub" },
  { n: 6, id: "screens", title: "Any screen", hint: "Desktop, tablet, phone, browser" },
] as const;

export type FinalIdea = (typeof finalIdeas)[number];
