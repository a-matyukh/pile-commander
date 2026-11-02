# Removing the old interface

The new interface (Explorer) has been the default since 2.3; `main` is at 2.4.0. The old window (`WorkspaceWindow`) is still in the code, behind a flag and two screens. This plan removes it in three commits, on a new branch from `main` (suggested name: `chore/remove-old-window`).

Paths are under `apps/client/src/` unless they start from the repo root. Line numbers are left out on purpose: find things by the names given here.

## How we work

1. Cursor reviews this plan once and writes objections as questions, with file and scenario. Claude answers; if the plan changes, this file changes.
2. Cursor does one commit's worth of work, runs the checks below and leaves the changes uncommitted.
3. Claude reviews the uncommitted changes by the code, not by a description. One round: fix what breaks ordinary use, anything rarer goes to `BACKLOG.md` (it is git-ignored and local to the owner).
4. The owner checks the desktop app and commits. The next commit starts only after that.

Agents do not commit, push or merge. If the plan and the code disagree, stop at that step and ask; do not guess.

Decisions already taken:

- **No data migration.** Only the owner used the old window with real data. Browser-storage folders keep their on-disk names (`/browser-desktops/<uuid>`), and a person renames them by hand if they want.
- **Behavior of the new interface does not change,** except what is listed here. This is a removal, not a redesign.

## Where things stand

- `store/explorer/enabled.ts` keeps the flag `pile_commander_explorer` (default on); its only switch is in `ui/explorer/pages/SettingsPage.vue`.
- `ui/app/AppShell.vue` renders `ExplorerShell` when `explorer_enabled && !explorer_public_open`, otherwise `WorkspaceWindow`.
- `explorer_public_open` (`store/explorer/public_view.ts`) is true for two screens the Explorer does not have yet: `cloud.invite_view` and `cloud.public_not_found`.
- `ImportProgressOverlay` (progress of a file import) is mounted only in `WorkspaceWindow`, so **the Explorer shows no import progress today**.

## Commit 1. Everything the old window still does for the Explorer

Nothing is deleted here; afterwards the Explorer no longer needs the old window at all.

**Keep the gate.** `explorer_public_open` stays: while an invitation or a missing publication is up, the shell is not mounted at all. That is what avoids a race on a cold start (`apply_public_route` runs before mounting, `take_explorer_start` knows neither screen, and `open_at_launch` would run beside `accept_invite`), and it leaves no header, sidebar or bookmarks to navigate away with while the flag stays set. Accepting already writes `explorer_return` through `go_to`, so the folder opens when the shell mounts; that flow does not change. Only what is drawn instead of the shell changes.

**The screen.** New `ui/explorer/pages/PublicScreen.vue`, whose root has the class `explorer` and the window classes, because kit modals and menus portal into `.explorer` and the tokens live under it. Move `window_classes` out of `ExplorerShell.vue` so both share it, import `tokens.css`, and set `document.documentElement.lang` as the shell does. It renders one of:

- **Invitation** (`cloud.invite_view`), doing what `ui/workspace/InviteView.vue` does: loading state, who invited whom to what and as which role, the error, signed-in state with sign out, `AuthForm` when signed out, accept. Explorer style: `ui/kit` buttons, `t()` strings in both `i18n/ru.ts` and `i18n/en.ts`. Keep the `redirect_to` logic as it is. **New:** an "Open the app" button, so a failed acceptance (another email, an error) has a way out. It calls a new `leave_invite()` in `store/explorer/public_view.ts`: `cloud.invite_view = null` and `leave_public_address()`.
- **Publication not found** (`cloud.public_not_found`): "not found", the path `/{{ cloud.public_not_found }}` in the mono font, and a button calling the existing `back_to_explorer_hub()`. That clears the state, sets `explorer_return` to the Hub and leaves the address, so a reload does not bring the page back and the tab title follows. Today's text is in `WorkspaceWindow.vue`, search for `Workspace not found`.

In `AppShell.vue`:

```vue
<ExplorerShell v-if="explorer_enabled && !explorer_public_open" />
<PublicScreen v-else-if="explorer_public_open" />
<WorkspaceWindow v-else />
```

Update the comment on `explorer_public_open`, which still says these show "in the current app's screens". `FolderActionsPanel.vue` reads `cloud.public_not_found` for its `publicMode`; leave that as it is.

**Import progress.** Mount `<ImportProgressOverlay :progress="store.workspace?.import_progress ?? null" />` in `ExplorerShell.vue` inside `.pv` (as `WorkspaceWindow` has it, read through `workspace.value?.import_progress`). Move its colors to Explorer tokens. `.pv` has `isolation: isolate`, so the overlay stays under the phone drawer; that is fine.

Commit message:

```
Explorer: invitation and missing-publication pages, import progress; the old window is no longer needed for them.
```

## Commit 2. Remove the flag, the old window and its storage keys

**The flag.** Delete `store/explorer/enabled.ts` and `enabled.test.ts`, and remove:

- the switch and its row in `SettingsPage.vue`;
- in `AppShell.vue`: the `WorkspaceWindow` import and branch, leaving `ExplorerShell` or `PublicScreen`. In `on_folder_drop`, `open_dropped_folder` and `open_pile`, the `explorer_enabled` checks go and only the Explorer's path stays. Also update the comment above them, which mentions the workspace window;
- in `services/navigatePublic.ts`: `open_demo_workspace` becomes a no-op, or goes from `ApplyPublicRouteDeps` if nothing else needs it (the Explorer opens `/demo` itself);
- in `store/explorer/public_view.ts`: the `explorer_enabled` branch of the `set_open_workspace` hook, and the flag in `explorer_public_open`, which stays as `!!(cloud.public_not_found || cloud.invite_view)`.

Grep for `explorer_enabled` and `EXPLORER_ENABLED_KEY` until nothing is left. **Keep `explorer_mounted`** in `public_view.ts` for now: it also tells flows that start before the shell mounts where to go.

**Delete** (reachable only through `WorkspaceWindow`, confirmed by the import graph on 2026-11-02):

- `ui/workspace/WorkspaceWindow.vue`, `ui/workspace/InviteView.vue`
- `ui/workspace/sidebar/Sidebar.vue`, `SyncStatusButton.vue`, `TrashDialog.vue`
- `ui/workspace/sidebar/workspace-tree/`: `TreeItemChildren.vue`, `TreeItemRow.vue`, `TreeList.vue`, `WorkspaceTree.vue`, `treeDragState.ts`
- `ui/workspace/sidebar/workspaces-list/`: `AccountPanel.vue`, `CloudWorkspaceItem.vue`, `OpenLocalFolder.vue`, `SettingsPanel.vue`, `WorkspacesList.vue`, `WorkspacesPopover.vue`
- `ui/workspace/menu/ConfirmDialog.vue`
- `ui/hub/`: `AuthorCard.vue`, `HubCard.vue`, `HubReportButton.vue`, `HubView.vue`, `ProfileView.vue`

`ImportProgressOverlay.vue` stays (commit 1). **Keep** everything else under `ui/workspace/`, the Explorer uses it: `folder-container/*`, `menu/*`, `ShareDialog`, `PublishDialog`, `BridgeDialog`, `ProfileDialog`, `QuotaWallDialog`, `SyncKeptHiddenToast`, `workspaceDialogs.ts`, `workspaces-list/AuthForm.vue`, `workspaces-list/PasswordDialog.vue`, `useWorkspace.ts`. Delete test files that only cover deleted code. Run the import graph (below) and report anything else it lists rather than deleting it silently.

**Old lists and storage keys.** Delete the two lists `bookmarks` and `last_opened` (`workspaces_list_bookmarks`, `workspaces_list_last_opened`) from `store/workspaces_list.ts`, with everything that reads or writes them, in this commit, or the keys come back:

- **Writers:** `store/cloud.ts` (`rename_in_workspaces_lists`, `remove_workspace_from_lists`, `sync_cloud_workspaces_list`), `main.ts` (`sync_workspaces_list`), `store/index.ts` (`add_to_bookmarks`, `add_to_last_opened`, `remove_from_bookmarks`, including the call inside `load_workspace`, which stays as the fallback of `set_open_workspace`).
- **Readers:** `legacy_browser_folder_name` and `browser_workspaces()` (`store/explorer/tree.ts`, with their tests), `legacy_display_name` and the migration (`migrate_explorer_lists`, `start_explorer_list_migration`, `pile_commander_explorer_lists_migrated` in `store/explorer/bookmarks.ts`, its call in `ExplorerShell.vue`).
- **The rest of `workspaces_list.ts` stays** as long as something uses it: `on_cloud_workspaces_synced`, `register_cloud_workspaces_refetch`, `filter_existing_workspaces`, `workspace_existence_checks`. Delete what no longer has a caller.

Agreed consequences: a browser folder shows its on-disk name (a uuid) in the tree and on its bookmark until it is renamed; a profile whose migration never ran loses its old bookmarks.

**So a top-level browser folder must be renamable.** `is_legacy_browser_folder` blocked renaming and dragging it only because the old interface found it by its path. Delete it and its checks (`store/explorer/folder_menu.ts`, `store/explorer/tree.ts`, `ui/explorer/sidebar/TreeRow.vue`): such a folder then behaves like any other, and gets Rename, Ungroup, Icon, Cover and Move to trash in its menus. A bookmark on it follows a rename, as on a nested folder.

**One thing must not show a uuid:** a cloud bookmark's name. `bookmark_name` falls back from `cloud.workspaces` to the old list, then to `root_id`, and `cloud.workspaces` is empty until it loads. Replace those fallbacks with a generic string, `t('bookmarks.cloud_folder')` ("Облачная папка" / "Cloud folder").

**Clean up on startup.** Remove the keys nothing reads any more: `workspaces_list_bookmarks`, `workspaces_list_last_opened`, `pile_commander_explorer`, `pile_commander_explorer_lists_migrated`, and every `workspace-sidebar-*` key. For the last one, delete `services/window/workspaceSidebarStorage.ts` and its call in `main.ts`, which deliberately keeps `workspace-sidebar-main` for the old window. Also grep `useStorage(` and `localStorage` in the deleted files. A few lines in one place, with a small test using a stubbed storage. **Do not touch** the other `pile_commander_explorer_*` keys, `pile_commander_show_hidden_files`, AI settings or experiments.

Commit message:

```
The old window, its sidebar, tree, workspace list and Hub are gone; the Explorer is the only interface, and old storage keys are cleared.
```

## Commit 3. Fold the old branches

With the Explorer always on, every "old look / Explorer" branch has one live side. Remove the dead side and the `explorer_mounted` import in:

| File | What stays |
| --- | --- |
| `ui/workspace/menu/NodeMenuShell.vue` | `ItemsDropMenu` and `ItemsCtxMenu`; `UDropdownMenu` and `UContextMenu` go |
| `ui/workspace/menu/FolderContainerCtxMenu.vue` | `ItemsCtxMenu` |
| `ui/workspace/menu/FolderMenu.vue` | The Explorer's groups; the color submenu and `open_folder_in_new_tab` item go |
| `ui/workspace/menu/FileMenu.vue` | The `explorer-color` item with `ColorPanel` |
| `ui/workspace/menu/RemoveDialog.vue` | Kit `Modal` |
| `ui/workspace/menu/useFolderContainerMenuItems.ts` | The `explorer-color` item |
| `ui/workspace/folder-container/FolderSpatialActionsMenu.vue`, `FolderChrome.vue` | `ItemsDropMenu` |
| `ui/workspace/folder-container/FolderPreview.vue` | Title with the icon |
| `ui/workspace/folder-container/slides/Slides.vue`, `SlideSwitcher.vue`, `stack/StackDefaultRow.vue` | Explorer icon, `IconButton` |
| `ui/workspace/folder-container/widgets/DefaultWidgetContent.vue` | The `ex-*` markup and styles; `default-*` go |
| `ui/workspace/folder-container/widgets/BoardWidgetShell.vue`, `MasonryWidgetShell.vue` | `1px solid var(--border)` |

**Multi-selection color.** `ui/workspace/menu/useSelectionMenu.ts` builds a "Background" item through the old `preset-colors` and `color-picker` slots, so selecting several items still shows the old panel inside the new menu. `FileMenu.vue` and `FolderMenu.vue` both return `selectionMenuItems` before their own branches, and either can open it (right click on a file or on a folder).

Do not reuse the `explorer-color` slot: it colors one file in `FileMenu.vue` and does not exist in `FolderMenu.vue`. Give the selection its own raw slot, `selection-color`, and render it in **both** menus: `ColorPanel` with `sharedBackground` (return it from `useSelectionMenu`) as the value, the selection's `applyColor` on `set`, `t('style.background_color')` as the label, `t('style.remove_background')` as the reset, no `picture` (the old selection menu had no link field). This is the one visible change in this commit. Then `useColorSubmenu.ts` can drop its picker and custom-value state, as long as `PRESET_COLORS` and `apply` stay.

**Delete what this frees**, once the graph confirms nothing imports them: `PresetColorsMenuSlot.vue`, `ColorPickerMenuSlot.vue`, `BackgroundValueMenuSlot.vue`, `ViewMenuTrailing.vue`, `MenuSwatchDot.vue`.

**Store methods only the old window called.** The graph cannot see methods. Grep each; remove it if nothing but its own tests calls it: `store.open_local_workspace`, `store.import_workspace_pack`, `store.open_demo_workspace`, `store.load_workspace`. Report the result for each: some may be used by flows this plan does not know about. Removing one is optional; leaving one with a note is fine.

Commit message:

```
The old look's branches and the components only they used are gone; several selected items take the new color panel.
```

## Checks

For every commit, from the repo root:

```bash
bun run test
```

```bash
cd apps/client && node_modules/.bin/vue-tsc --noEmit
```

```bash
git diff --check
```

After commits 2 and 3, list source files nothing reaches from `main.ts`. Save as `reach.mjs` outside the repo and run with `node reach.mjs "$PWD"` from `apps/client/src`. Treat the output as a list to look at: it does not follow glob imports, and test files and test helpers appear in it.

```js
import fs from 'node:fs'; import path from 'node:path'
const src = process.argv[2]
const exts = ['', '.ts', '.vue', '/index.ts']
function resolve(from, spec) {
  let base
  if (spec.startsWith('@/')) base = path.join(src, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec)
  else return null
  for (const e of exts) { const p = base + e; if (fs.existsSync(p) && fs.statSync(p).isFile()) return p }
  return null
}
const seen = new Set(); const stack = [path.join(src, 'main.ts')]
while (stack.length) {
  const f = stack.pop(); if (seen.has(f)) continue; seen.add(f)
  const text = fs.readFileSync(f, 'utf8')
  for (const m of text.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g)) {
    const r = resolve(f, m[1] || m[2] || m[3]); if (r) stack.push(r)
  }
}
const all = []
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|vue)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) all.push(p) } }
walk(src)
console.log(all.filter(f => !seen.has(f)).map(f => path.relative(src, f)).sort().join('\n'))
```

Manual, in the browser preview (`.claude/launch.json`, `client`) and in the desktop app:

**Commit 1**
- `/invite/<token>`, signed out and signed in: the new page; accepting opens the cloud folder.
- An invitation that cannot be accepted (another email): the error and "Open the app", which leads to the last folder with the address `/`.
- A publication link that does not exist: the new page; the button opens the Hub, the address is `/`, a reload stays there.
- Both links with the app closed: the last folder does not open underneath, and accepting ends in the invited folder.
- Importing several files: progress shows and goes away.

**Commit 2**
- The app starts in the Explorer with the last folder restored; Settings has no "New interface" switch.
- `/demo`, a real publication and `/<username>` open in the Explorer.
- A folder dropped from the OS on the top bar is bookmarked, elsewhere it opens. Files dropped import into the open folder. A `.pile` opens.
- `localStorage` no longer has the removed keys, and they do not come back after opening, renaming and removing folders. Bookmarks are still there.
- A cloud bookmark right after launch shows its name or "Cloud folder", never a uuid.

**Commit 3**
- Board, Canvas, Stack, Masonry and Slides: right click and "⋯" on a file, a folder and empty space; Rename, Remove, Preview; Cover and Background.
- Several items selected, right click on a file and on a folder: Background with the new panel colors all of them; Remove.

## Not in this plan

- **Workspace tabs inside the store** (`createWorkspaceStore.ts`: the tab stack, `open_folder_in_new_tab`, `next_tab_id`). The Explorer shows none, but every view uses this store, so cutting them is its own task after commit 3, with its own review.
- **`RenameDialog.vue` and `BulkRemoveDialog.vue`** are still Nuxt UI modals inside the new interface. They work; moving them to the kit `Modal` is a separate look-and-feel change.
- **English strings in the color presets' names** (`PRESET_COLORS`, shown as tooltips in `ColorPanel`).

## Out of scope (product backlog)

From the integration plan, not planned:

- Dashboard view.
- Manual folder order in the tree.
- Folder search and "Open in browser" (behind iteration flags in the prototype).
- Dragging between `~` and the cloud: the tree shows one drive at a time; needs spring-loaded source buttons and a move-or-copy decision.
- Sort by date modified: no `FileManager` reports a modification date yet.
- Folder aliases (shortcuts).
- Nested sync.
- New drive kinds (S3, media servers): the `Drive` abstraction allows them; none is built.
