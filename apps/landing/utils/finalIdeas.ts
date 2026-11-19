/** The final landing's blocks 1–7, in order: their anchors and the legend
 *  under the intro's window. The numbers match the markers on the window.
 *  Block 8 (open source) has no place in the window and no marker. */
export const finalIdeas = [
  { n: 1, id: "views", title: "Nine views", hint: "One folder, nine ways to see it" },
  { n: 2, id: "files", title: "Files come alive", hint: "Previews, covers, shapes, the pen" },
  { n: 3, id: "ai", title: "AI", hint: "Tidy a folder, make something new" },
  { n: 4, id: "sync", title: "Sync", hint: "A cloud copy of any folder" },
  { n: 5, id: "share", title: "Share", hint: "A file, a person, a link, the Hub" },
  { n: 6, id: "screens", title: "Any screen", hint: "Desktop, tablet, phone, browser" },
  { n: 7, id: "yours", title: "Yours", hint: "Files stay on your disk" },
] as const;

export type FinalIdea = (typeof finalIdeas)[number];
