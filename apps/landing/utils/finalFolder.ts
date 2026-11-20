/** The one folder the final landing shows: ~/Pictures/Harbor moodboard, its
 *  place in the home folder and its nine views. Names, icons and colours are
 *  the app's own (apps/client: FOLDER_VIEWS in domain/Widget.ts,
 *  FOLDER_VIEW_META in store/explorer/folder_header.ts, the labels in
 *  i18n/en.ts, STANDARD_FOLDERS in store/explorer/folder_cover.ts). */

export type ViewId = "list" | "grid" | "board" | "canvas" | "3d" | "stack" | "masonry" | "dashboard" | "slides";

export interface ViewMeta {
  id: ViewId;
  label: string;
  icon: string;
  /** null: monochrome, as List is in the app */
  color: string | null;
  /** One line under the window */
  caption: string;
}

/** The app's view menu, in its order */
export const FOLDER_VIEWS: ViewMeta[] = [
  { id: "list", label: "List", icon: "i-tabler-list", color: null, caption: "Rows with names and sizes, like any file manager." },
  { id: "grid", label: "Gallery", icon: "i-tabler-layout-grid", color: "#D4537E", caption: "Tiles with previews, like any file manager, in the size you like." },
  { id: "board", label: "Board", icon: "i-tabler-template", color: "#534AB7", caption: "Place anything anywhere: resize, leave space, layer things over each other." },
  { id: "canvas", label: "Canvas", icon: "i-tabler-artboard", color: "#1D9E75", caption: "An endless canvas: zoom out, connect things, draw over them with the pen." },
  { id: "3d", label: "3D", icon: "i-tabler-3d-cube-sphere", color: "#0F96A8", caption: "The board in space: the same places, plus height. Orbit around it." },
  { id: "stack", label: "Stack", icon: "i-tabler-layout-rows", color: "#BA7517", caption: "One column you reorder by dragging. Notes and pictures open in full." },
  { id: "masonry", label: "Masonry", icon: "i-tabler-layout-cards", color: "#D85A30", caption: "Columns of cards: each next one goes to the shortest column." },
  { id: "dashboard", label: "Dashboard", icon: "i-tabler-layout-dashboard", color: "#3B6FB6", caption: "A twelve-column grid: cards snap to it and resize." },
  { id: "slides", label: "Slides", icon: "i-tabler-presentation", color: "#639922", caption: "One thing at a time, full size. The folder remembers where you stopped." },
];

export const viewMeta = (id: ViewId) => FOLDER_VIEWS.find(v => v.id === id)!;

/** What the folder holds, in name order as List shows it */
export const FOLDER_ITEMS = [
  { name: "References", kind: "folder", size: "—" },
  { name: "jellyfish.jpg", kind: "image", size: "51.4 KB", src: "/landing-alt2/jellyfish.jpg" },
  { name: "lemon-tea.jpg", kind: "image", size: "41.5 KB", src: "/landing-alt2/lemon-tea.jpg" },
  { name: "Mood.md", kind: "text", size: "52 B" },
  { name: "pink-blossom.jpg", kind: "image", size: "86.2 KB", src: "/landing-alt2/pink-blossom.jpg" },
  { name: "raspberries.jpg", kind: "image", size: "62.9 KB", src: "/landing-alt2/raspberries.jpg" },
  { name: "sea-horizon.jpg", kind: "image", size: "126.4 KB", src: "/landing-alt2/sea-horizon.jpg" },
  { name: "Title.md", kind: "text", size: "71 B" },
] as const;

export interface TreeRow {
  name: string;
  icon?: string;
  color?: string;
  depth?: number;
  open?: boolean;
  selected?: boolean;
}

/** The sidebar: a typical home folder; the open folder shows its view's icon */
export function homeTree(view: ViewId = "board"): TreeRow[] {
  const v = viewMeta(view);
  return [
    { name: "Applications", icon: "i-tabler-apps", open: false },
    { name: "Desktop", icon: "i-tabler-device-desktop", open: false },
    { name: "Documents", icon: "i-tabler-file-text", open: false },
    { name: "Downloads", icon: "i-tabler-download", open: false },
    { name: "Library", icon: "i-tabler-building-warehouse", open: false },
    { name: "Movies", icon: "i-tabler-movie", open: false },
    { name: "Music", icon: "i-tabler-music", open: false },
    { name: "Pictures", icon: "i-tabler-photo", open: true },
    // List is the plain folder in the tree, as in the app
    { name: "Harbor moodboard", icon: view === "list" ? "i-tabler-folder-open" : v.icon, color: v.color ?? undefined, depth: 1, open: true, selected: true },
    { name: "References", icon: "i-tabler-layout-grid", color: "#d4537e", depth: 2 },
    { name: "Projects", open: false },
    { name: "Public", icon: "i-tabler-users", open: false },
  ];
}

export function homeBookmarks(view: ViewId = "board"): TreeRow[] {
  const v = viewMeta(view);
  return [
    { name: "Harbor moodboard", icon: view === "list" ? "i-tabler-folder" : v.icon, color: v.color ?? undefined, selected: true },
    { name: "Projects" },
    { name: "Downloads", icon: "i-tabler-download" },
  ];
}
