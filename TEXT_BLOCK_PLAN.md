# Text block: plan

A plain text block for board and canvas, like the Text tool in FigJam or
Excalidraw. Today the user makes a Note and strips its background. The goal is a
real "Text" item, but with no new file kind.

## Decision

A text block is a **note file with one more xattr**. It is still a `.md` file on
disk, so it is searchable, syncs, exports and opens in any editor.

- `Text N.md` is the file name, like `Note N.md` and `Shape N.svg`.
- A new boolean xattr, `is_text`, marks the file as a text block.
- `is_preview` keeps its meaning: preview on, the file is a widget; preview off,
  the file is its cover (a file card).

| `is_preview` | `is_text` | Board / canvas shows                                   |
| ------------ | --------- | ------------------------------------------------------ |
| true         | false     | Note (as now)                                          |
| true         | true      | Text block                                             |
| false        | any       | File cover (`DefaultWidgetContent`), `is_text` is kept |

`is_text` is **not** cleared when preview goes off. "Show as file" and "Show as
text" are then a round trip: the file comes back as a text block, not as a note.
`is_text` is only meaningful on `.md` / `.txt`; the cloud and local sync already
merge xattrs key by key, so nothing there changes.

No database change: xattrs are a `jsonb` column with no whitelist
(`schema.sql`: `xattrs jsonb ... <= 65536` bytes). An old client that does not know
`is_text` shows the file as a plain note, which degrades safely.

## Scope of the first version

In:

- a text block on **board and canvas**;
- the same markdown editing and preview as a note (bold, italic, lists,
  headings, links), in a fixed box with `overflow: visible`;
- create from the menu and with the `T` hotkey (board); remove when left empty;
- convert note <-> text, and text <-> file cover.

Out (follow-ups, see the end):

- **Dashboard** text look. The dashboard shows a text block as a note, like
  stack, masonry and slides. Its cell is fixed, and an auto-height block is the
  only reason to give it a different look.
- **Auto height** (the block growing with its text), width-only resize, hugging
  the glyphs.
- **The formatting popup** (Figma-style: text color, size, bold, italic,
  strikethrough, link, list, align), acting on a **selected range** of text.
  The first version only has to leave room for it (see item 4, "Formatting
  stays"). How the range style is stored is not decided yet.

## Where it shows

- **Board, canvas:** the text block (own shell and look).
- **Dashboard, stack, masonry, slides:** the same content as a note today
  (`NoteWidgetContent` in the dashboard, `StackNoteRow`, `MasonryCard`,
  `SlidesNote`). `is_text` is ignored there.
- **Cover:** `is_preview = false` gives the file card in every view, as now.

## Conversions

Rule for every conversion: **the fill and the size are not touched.** A yellow
220x80 note converted to text stays a yellow card of the same size; the user
changes the fill from the Background menu. There is no re-measure on convert.

- Note -> Text: set `is_text = true`. Text -> Note: `is_text = false`. The file
  does not change, only the flag. Menu items: "Convert to text" / "Convert to
  note".
- Text -> file cover: the existing preview toggle (`is_preview = false`), label
  "Show as file". The flag `is_text` stays.
- File cover -> Text: "Show as text". One store call (see "Store") sets
  `is_preview = true` and `is_text = true` and writes `TEXT_DEFAULT_SIZE` only if
  the entry has no `size`.
- A `.md` cover with no `is_text` keeps its current "Preview" item (becomes a
  note) and gains "Show as text".

## Work items

### 1. Model and helpers

- [apps/client/src/domain/Widget.ts](apps/client/src/domain/Widget.ts): add `is_text?: boolean` to `FileXattrs`.
- [apps/client/src/services/workspace/folderContainer.ts](apps/client/src/services/workspace/folderContainer.ts): add `is_text` to the file `pick(attrs, [...])` in `child_from_entry`.
- [apps/client/src/services/board/layout.ts](apps/client/src/services/board/layout.ts):
  - `is_text_widget(widget)`: file, `is_preview === true`, `is_text === true`, name ends with `.md` / `.txt`.
  - `is_note_widget` stays true for text blocks, so masonry (it uses `is_note_widget`) and the rest keep working without a change. A `is_plain_note_widget` ("a note that is not text") only where a view needs the difference.
  - `TEXT_DEFAULT_SIZE = { width: 200, height: 50 }` and a branch in `board_size`, **before** the note branch. The height is not below 50 on purpose: on the canvas the minimum is 100x50 in two places (`NodeResizer` in `CanvasWidgetNode.vue`, `minNodeSize` in `useCanvasNodes.ts`), and this version does not add a separate minimum for text.
  - `board_size` returns a stored `size` first, so it never reaches the text branch for an entry that already has one. That is why "Show as text" needs its own store method (below) instead of going through `change_is_preview`.
- [apps/client/src/services/mcp/read.ts](apps/client/src/services/mcp/read.ts) and `types.ts`: `layout` gets `is_text` the same way as `is_preview` (line ~282).
- Nothing to change in `dashboardLayout.ts`: the dashboard keeps the note size.

### 2. Naming

- [apps/client/src/services/naming/uniqueName.ts](apps/client/src/services/naming/uniqueName.ts): `resolve_text_block_filename` = `resolve_numbered_filename('Text', '.md', ...)`.
- `NOTE_FILENAME_PATTERN` becomes `^(Note|Text) \d+\.md$`, and the renumbering loop keeps the matched prefix. A copy of `Text 1.md` becomes `Text 2.md`, not `Text 1 (1).md`.
- Tests in `uniqueName.test.ts`: `Text 1.md`, gaps, copy renumbering, and that `Note 1.md` and `Text 1.md` do not collide.

### 3. Store

- [apps/client/src/domain/Store.ts](apps/client/src/domain/Store.ts) and [createWorkspaceStore.ts](apps/client/src/store/createWorkspaceStore.ts):
  - `create_text(folder_id, position?)`: a copy of `create_note` (line ~1844) with `resolve_text_block_filename`, xattrs `is_preview: 'true'`, `is_text: 'true'`, `size: TEXT_DEFAULT_SIZE`, optional `position`. Seed `content_caches.notes` with `''`, same as a note.
  - `change_is_text(id, is_text)`: one `persist_workspace_xattr` call, like `change_is_preview` (line ~1737). It does nothing if the value is already the same. Used by "Convert to text / note".
  - `show_as_text(id)`: **one** method for the cover -> text case. It sets `is_preview` and `is_text`, and writes `TEXT_DEFAULT_SIZE` when the entry has no `size`, whatever the folder view is. Reason: `change_is_preview(true)` fills a missing size only on a board, and it asks `board_size` about the widget as it was *before* `is_text` reached the model, so a two-call version writes the note size.
  - `change_is_preview` stays as is.
- The `remove(id)` action (line ~2429) is what the empty-text cleanup uses (item 6).
- Tests in `workspaceStore.test.ts` / `createNoteReactivity.test.ts`:
  - `create_text` returns `/ws/Text 1.md`, writes the xattrs, a second one is `Text 2.md`;
  - `change_is_text` round trip;
  - `is_text` survives `change_is_preview(false)` then `(true)`;
  - `show_as_text` on a cover without `size` writes `TEXT_DEFAULT_SIZE`, on one with a `size` leaves it.

### 4. Render (board and canvas)

- [widgetRegistry.ts](apps/client/src/ui/workspace/folder-container/widgets/widgetRegistry.ts): new `WidgetRole` `'text'`, resolved **before** `'note'`. No shared "is note-like" helper: the two places below need different answers.
- [WidgetTypeSwitch.vue](apps/client/src/ui/workspace/folder-container/widgets/WidgetTypeSwitch.vue): today one `isNote` serves the stack and the board branches. Split it:
  - stack branch: role `note` **or** `text` -> `StackNoteRow`;
  - board / canvas branch (`layout === 'board'`): role `text` -> `TextWidgetContent`, checked before `note` -> `NoteWidgetContent`;
  - dashboard branch (`layout === 'dashboard'`): role `text` or `note` -> `NoteWidgetContent`.
- [Slides.vue](apps/client/src/ui/workspace/folder-container/slides/Slides.vue) (line ~62): `isNote` must accept role `text` too. [MasonryCard.vue](apps/client/src/ui/workspace/folder-container/masonry/MasonryCard.vue) needs no change (`is_note_widget`).
- New `TextWidgetContent.vue`, next to `NoteWidgetContent.vue`. It reuses `useNoteEditor` and `NoteBody`, so editing, blur, the soft keyboard and the exit handler stay the same. Differences:
  - **Formatting stays.** A text block is edited and rendered exactly like a note: `isMarkdown` is unchanged (`endsWith('.md')`, `useNoteEditor.ts` line 37), the preview is the markdown HTML, and Cmd+B / Cmd+I keep working through `wrapMarkdownSelection` in `NoteBody.vue`. `NoteBody` gets an `appearance: 'note' | 'text'` prop only for the look (no fade, theme color, no padding), not for behavior.
  - **Keep one entry point for format commands.** Bold / italic go through `wrapMarkdownSelection` today, called from `onTextareaKeydown`. Pull that call into one function (`applyFormat(marker)`) that the keyboard handler and, later, the popup both call. That is the only preparation for the popup in this version.
  - **Raw text while editing, rendered text after blur.** The textarea shows `# title` and `**bold**`; the preview shows a large heading and bold. In a fixed box the frame does not move, only the glyphs change size. To keep the first line from jumping, the text preview drops the top margin of its first child and the bottom margin of its last (the note preview keeps them). Accepted for this version.
  - No padding, no shadow, no `note-preview--fade`, and `overflow: visible` (the note root has `overflow: hidden`). Text longer than the box spills out of it; auto height is a follow-up.
  - Text color from the theme, not the hard-coded `rgb(23 23 23)` in `NoteBody.vue` (check [main.css](apps/client/src/main.css) tokens), through the same `appearance` prop.
  - The "Background" menu stays: a text block can still get a fill if the user sets one.
- **Shell: a branch with no fill and no border.** [BoardWidgetShell.vue](apps/client/src/ui/workspace/folder-container/widgets/BoardWidgetShell.vue), lines ~230-246: with no fill the shell always sets `backgroundColor: 'white'` and a `1px solid var(--border)` border, and `border` is written again *after* `extraStyle`, so a class or an `extraStyle` cannot make it transparent. A `text-widget` root class alone gives a white card with a border. Add a branch like the media-chrome one above it: for a text block with no fill, `backgroundColor: 'transparent'` and `border: 'none'`; with a fill, the same as a note with a fill. The note-only `isNoteWidget` outline logic must not apply to text.
- [CanvasWidgetNode.vue](apps/client/src/ui/workspace/folder-container/canvas/CanvasWidgetNode.vue): text needs `nodrag nopan` while editing, as a note does.
- `DashboardWidgetShell.vue`: no change (the dashboard shows the note).

### 5. Create and delete

- [useFolderContainerMenuItems.ts](apps/client/src/ui/workspace/menu/useFolderContainerMenuItems.ts): "Text" item in the "New" submenu, right after "Note", calling `create_text` at the pane position. Same `armNoteCreateFromMenu()` call before the await, and `setRegisteredEditingNoteId` after, so the block opens in edit mode with the keyboard on touch.
- Same item for the Explorer's add menu: [add_menu.ts](apps/client/src/store/explorer/add_menu.ts) (`add_text`), [FolderChrome.vue](apps/client/src/ui/workspace/folder-container/FolderChrome.vue), and the icon and label in [items_menu_labels.ts](apps/client/src/ui/kit/items_menu_labels.ts), `i18n/en.ts`, `i18n/ru.ts`.
- **Hotkey `T`, then a click on the pane**, the same way `L` / `A` work for lines in [useLineDrawMode.ts](apps/client/src/ui/workspace/folder-container/useLineDrawMode.ts), through `createTextAt` in [useFolderPaneActions.ts](apps/client/src/ui/workspace/folder-container/useFolderPaneActions.ts). A double click stays "Note". No Alt + double click. Show the `T` hint in the menu only on the board (lines do the same: `lineKbds` is `undefined` on the canvas). Check that `T` is free in `CANVAS_TOOL_HOTKEYS`.
- **Empty text is removed.** The check goes **inside the existing exit handler** in `useNoteEditor.ts` (line ~183), after `await save()`: if the widget is a text block and the content is only whitespace, call `ws.remove(id)`.
  - Do not register a second `onNoteEditExit` for it: `useEditingNoteId.ts` keeps **one handler per id** in a `Map`, so a second one would replace the save handler.
  - `useNoteEditor` gets the `isText` input (it currently knows only the id and the file name); a plain empty note is left as now.
  - A save that runs after the file is gone does not bring it back: `save_note_content` swallows a missing-path error.
  - Test: create a text block from the menu, blur at once, the file is gone; the same for a note, the file stays.

### 6. Menu

- [FileMenu.vue](apps/client/src/ui/workspace/menu/FileMenu.vue): for `.md` / `.txt`:
  - on a note: "Convert to text" (`change_is_text(id, true)`); on a text block: "Convert to note" (`change_is_text(id, false)`);
  - the preview toggle label for a text block: "Show as file" (`get_preview_toggle_label` in `services/board/media.ts` gets an `is_text` argument);
  - for a cover whose file has `is_text`: "Show as text" (`show_as_text`);
  - for a plain `.md` cover: "Preview" and "Show as text".
- Nothing to change: `ItemMenu.vue` (it toggles preview for pictures only), the file icon and the AI summary (`is_note_name` takes any `.md` / `.txt`).

### 7. Later (not in the first version)

- Dashboard: a text look, once there is auto height or another answer for a fixed cell.
- **The formatting popup** (selection-driven, like Figma's). It styles **a range the user selects, down to two letters**, in a note or in a text block, not the whole block. What each control writes:
  - bold, italic, strikethrough, link, list: markdown marks in the file, through `applyFormat` (item 4);
  - color, size and the like for a range: markdown has no form for them, so the plan is **inline `style`** on the range (`<span style="color: ...">text</span>` inside the `.md`). The exact form is decided when the popup is designed; the first version does not write it;
  - this is not stored as block xattrs (`text_color`, `font_size`, `text_align`): those would color the whole block. Block-level props, if wanted at all, are a separate later question.
  - What the inline-style route needs, to keep in mind and not to build now:
    - `parseNoteMarkdown` ([markdown.ts](apps/client/src/ui/workspace/folder-container/widgets/markdown.ts)) passes marked's HTML through `DOMPurify.sanitize(html)` with the default config. Check whether a `<span style>` already survives it. Notes come from shared and public boards, so a style must be limited to a short list of properties (color, background color, font size, ...) with safe values, not any CSS (`position`, `url(...)`, huge sizes); the same care as `strip_dangerous_styles` in `services/board/shapes.ts`;
    - the file stays valid markdown but has HTML in it: another editor shows the `<span>` tags raw or ignores the style;
    - `wrapMarkdownSelection` handles symmetric markers (`**`, `*`); a span needs an opening and a closing tag of different text, plus merging, nesting and un-styling a part of an already styled range. A rich-text editor (next item) does this better than editing the string by hand;
    - the AI summary and the MCP read return the raw file text, with the tags in it. Decide whether to strip them there.
- **An editor that shows formatting while typing** (contenteditable or a small rich-text editor over the same markdown). It removes the raw-vs-rendered difference and is what auto height needs; it also fits a selection popup better than a textarea (the popup needs selection rectangles and live marks). It replaces the textarea in `NoteBody` for `appearance: 'text'`, so the file format does not change.
- Auto height: the block grows with its text and writes `size`. Blocked on the point above: with raw text in the textarea and HTML in the preview the height differs on every enter and exit. On the canvas the node size is the stored `size` (`useCanvasNodes`) and the resize is `NodeResizer` (min 100x50), so this needs a decision per view; a width-only handle on `BoardWidgetShell` does not touch the canvas. Also hugging the glyphs and a smaller minimum for text.
- Font size presets (S / M / L / XL) and a corner handle that scales the font like Excalidraw. Whether the size is a range style, a block prop, or both is part of the popup decision.
- `useCombineSelectedWidgets.ts` creates a note; decide whether a selection of text blocks combines into a text block.

## Implementation notes

First version is in. Where it differs from the items above:

- The frame has a `4px` inset (`.board-widget.text-widget` in `BoardWidgetShell.vue`), not none: the selection ring and the caret would sit on the glyphs.
- Text color stays `rgb(23 23 23)`: the app has no dark theme tokens to read, and the pane is white or light gray.
- No extra margin rule for the first and last child in the preview: `prose` already drops them.
- A text block's textarea grows with its text (the stack note's autosize, `growsWithText` in `NoteBody.vue`), so typing past the frame looks like the preview does.
- `T` is `useTextPlaceMode.ts`, on the board and on the canvas; the click on empty pane is handled in `Board.vue` and `Canvas.vue` through `createTextAt` in `useFolderPaneActions.ts`. It is exclusive with the line hotkeys and shape placement. On the canvas it arms only with the hand or select tool (with the pen or the lasso a click is a stroke) and drops when the tool changes; the text cursor is forced on the Vue Flow pane (`.canvas-flow--text-place`), because the pane has its own grab cursor.
- The text block's root class keeps `note-widget` next to `text-widget`, so the pane's click-outside exit and the edit shadow need no change.
- "Text" is in the pane "New" menu, the Explorer's Add menu, and `FolderChrome` ("New text").
- Empty-text removal test: `useNoteEditor.test.ts` (run through an effect scope, no DOM).

### Second pass: the box follows the text (as in Excalidraw and FigJam)

The first version was a note without a fill. This pass is what makes it a text block:

- **Auto width, auto height.** A new block grows to the right while typing and breaks a line only at Enter; the height always follows the lines. Editing: the textarea shares one grid cell with a hidden copy of its text (`.note-grow` in `NoteBody.vue`), no script. Preview: `max-content` with no wrapping.
- **Fixed width.** Dragging the left or right handle sets xattr `text_width: 'fixed'`; `size.width` is then the width and the text wraps inside it. The height is still the text's. A small button right of a selected fixed block (`.text-reset-width`) writes `text_width: 'auto'` again.
- **Model.** `size` stays stored (the measured box, written after a typing session and at the end of a resize) so the board extent and the other views keep working; it is never what lays the block out. `text_box_css` in `layout.ts` is the one place that turns a block into a CSS width and `auto` height, for the board (`useBoardWidget.ts`) and the canvas (`nodeStyle`).
- **Handles.** Board: `boardTextResize.ts` (interactjs, left and right edge selectors; the left edge also moves `x`). Canvas: two `NodeResizeControl`s in `CanvasWidgetNode.vue` and `onTextResizeLive/End` in `useCanvasNodes.ts`. No corner resize on a text block. Handles show on a selected block that is not being typed in.
- **Born selected and open.** `create_text` selects the block; every entry point also opens it for typing. Without a click point (pane menu, `FolderChrome`, the Explorer's Add menu) it starts at the pane's center (`resolvePaneCenterPosition`). While typing, the frame is the selection ring (not the note's shadow), so an empty block is visible.
- `childSignature` in `useCanvasNodes.ts` now includes `is_text` and `text_width`: before, a Note -> Text conversion did not reach a canvas node.
- Not done on purpose: a handle during typing, grid snap for the side handles, reading `size` back for stale extents between sessions.

## Checks

Per the repo rules, no dev server or clicking through the UI; the user checks it.

- `bun --filter @pile-commander/client test`: new and changed tests above.
- `cd apps/client && node_modules/.bin/vue-tsc --noEmit`.
- `bun --filter @pile-commander/file-manager build` only if `file-manager` is touched (it should not be).
- Manual (user): create text on board and canvas (menu and `T`); type, blur, empty it and blur (the file is deleted); convert note <-> text (fill and size stay); Show as file and Show as text; open the same folder in stack, masonry, slides, dashboard (all show a note); rename and copy `Text N.md`; sync a folder with an auto-synced local root.

## Risks

- Role order: `text` must win over `note` in `resolveWidgetRole`, and the stack branch of `WidgetTypeSwitch` and `Slides.vue` must still match it. A missed spot shows a text block as a file card.
- Note-only styling is keyed on class names in the shells; a text block must not pick up the note outline or white card by accident (the shell branch in item 4).
- A fixed box with `overflow: visible` lets long text cover its neighbours and hit-test as the box, not as the glyphs. Accepted for the first version.
- Raw markdown in the editor and rendered HTML after blur differ in height and in glyph size (a `# title` is one small line while typing and a large one after). A fixed box hides the frame jump but not the glyph jump; auto height and the popup are what remove it (see "Later").
- Range color and size are not in this version. When they come, they are inline `style` in the `.md`, which needs a restricted style whitelist in the sanitizer (notes can come from other users) and an editor that can apply and remove a span cleanly.
- The exit handler is shared: the empty-text check and the save live in one function. Keep the order save -> check -> remove.
- `Text N.md` shows in the Explorer list next to notes. Fine for v1; a group or a badge can come later.
