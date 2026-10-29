# Explorer: what is left of stage 4

The new interface (Explorer) replaced the old window in release 2.3. `feature/explorer` was merged into `main` with stages 0–3 and steps 4.1 and 4.3 done (4.3: Gallery is stored as "gallery", "grid" still reads as Gallery, see `folder_view_from_stored` in `apps/client/src/domain/Widget.ts`). The integration plan (`EXPLORER_PLAN.md`) was deleted before the merge. One step was postponed (written 2026-10-29): **4.2. Remove the old window**, below. It is one commit, made by the owner after review. Agents do not commit, push or merge.

## 4.2. Remove the old window

### Where things stand

- The new interface (Explorer) is on by default since step 4.1. `store/explorer/enabled.ts` keeps the flag `pile_commander_explorer`, default `true`, and the switch in Explorer settings.
- `ui/app/AppShell.vue` renders `ExplorerShell` when `explorer_enabled && !explorer_public_open`, otherwise the old `WorkspaceWindow`.
- `explorer_public_open` (`store/explorer/public_view.ts`) is true for two screens the Explorer has no page for yet:
  - `cloud.invite_view`: an invitation link `/invite/<token>`, rendered by `ui/workspace/InviteView.vue`;
  - `cloud.public_not_found`: a publication link that no longer exists.
- The app has not been released with the old window to anyone but the owner. **No data migration is needed.** Browser-storage folders keep their on-disk names (`/browser-desktops/<uuid>`); a person renames them by hand if they want.

### What goes

An import graph from `src/main.ts`, with and without `ui/workspace/WorkspaceWindow.vue`, shows 23 files (~3,300 lines) reachable only through the old window (all under `apps/client/src/`):

- `ui/workspace/WorkspaceWindow.vue`
- `ui/workspace/InviteView.vue` (only after its replacement exists, see below)
- `ui/workspace/sidebar/Sidebar.vue`
- `ui/workspace/sidebar/SyncStatusButton.vue`
- `ui/workspace/sidebar/TrashDialog.vue`
- `ui/workspace/sidebar/workspace-tree/TreeItemChildren.vue`, `TreeItemRow.vue`, `TreeList.vue`, `WorkspaceTree.vue`, `treeDragState.ts`
- `ui/workspace/sidebar/workspaces-list/AccountPanel.vue`, `CloudWorkspaceItem.vue`, `OpenLocalFolder.vue`, `SettingsPanel.vue`, `WorkspacesList.vue`, `WorkspacesPopover.vue`
- `ui/workspace/menu/ConfirmDialog.vue`
- `ui/workspace/folder-container/ImportProgressOverlay.vue` (check first, see below)
- `ui/hub/AuthorCard.vue`, `HubCard.vue`, `HubReportButton.vue`, `HubView.vue`, `ProfileView.vue`

**Keep** everything else under `ui/workspace/`: the Explorer uses it. That includes `folder-container/*` (board, canvas, stack, masonry, slides, previews), `menu/*` (rendered in the new style through `ui/kit/ItemsMenu.vue` when `explorer_mounted`), `ShareDialog`, `PublishDialog`, `BridgeDialog`, `ProfileDialog`, `QuotaWallDialog`, `SyncKeptHiddenToast`, `workspaceDialogs.ts`, `workspaces-list/AuthForm.vue`, `workspaces-list/PasswordDialog.vue`, `useWorkspace.ts`.

Re-run the graph script after the change (below) to confirm nothing else became unreachable, and delete any test files that only cover deleted code.

### Steps

#### 1. The two screens in the Explorer

Before `WorkspaceWindow` can go, the Explorer shows:

- **Invitation** (`cloud.invite_view`). Move what `InviteView.vue` does (show the invite, sign in if needed, accept or decline, then open the folder) into an Explorer page, e.g. `ui/explorer/pages/InvitePage.vue`, in the Explorer's style (`ui/kit` buttons, `Modal`, `t()` strings in `i18n/ru.ts` and `i18n/en.ts`). After accepting, open the cloud folder through `explorer_navigation.open_folder`. The cloud open hook in `store/explorer/public_view.ts` already handles "invite" for navigation; check it covers this path.
- **Publication not found** (`cloud.public_not_found`). A small Explorer page with the message and a "Back to Hub" button that opens the Hub page (`explorer_navigation.open_page('hub')`).

Then `explorer_public_open` is no longer needed: remove it and its uses. Add the page names to the `ExplorerPage` type and `ExplorerShell.vue`.

#### 2. Remove the flag

- `AppShell.vue`: render `ExplorerShell` always; drop the `WorkspaceWindow` import and the `explorer_enabled` branches (the OS folder drop around line 33, the open flow around lines 51 and 59; the Explorer behavior becomes the only one).
- Delete `store/explorer/enabled.ts` and `enabled.test.ts`; remove the switch from `ui/explorer/pages/SettingsPage.vue`; update `services/navigatePublic.ts` and `store/explorer/public_view.ts`, which read the flag.
- Grep for `explorer_enabled` and `EXPLORER_ENABLED_KEY` until nothing is left.

#### 3. Delete the old window's files

`git rm` the list above. Then:

- remove now-unused i18n keys if any were only for those files (the old window is mostly English literals, so likely none);
- remove `open_folder_in_new_tab` from `ui/workspace/menu/FolderMenu.vue`'s non-Explorer branch and any `explorer_mounted` branching that only existed to keep the old window working. Keep it simple: where a component has an "old look" branch and an "Explorer" branch, the Explorer branch becomes the only one (`NodeMenuShell.vue`, `FolderContainerCtxMenu.vue`, `FolderSpatialActionsMenu.vue`, `FolderChrome.vue`, `FileMenu.vue`, `FolderMenu.vue`, `RemoveDialog.vue`, `SlideSwitcher.vue`, `DefaultWidgetContent.vue`, `BoardWidgetShell.vue`, `MasonryWidgetShell.vue`, `Slides.vue`, `StackDefaultRow.vue`, `FolderPreview.vue`, `useFolderContainerMenuItems.ts`, `useCanvasNodes.ts`). This part is optional for 4.2: the branches are harmless with `explorer_mounted` always true, and folding them is a larger diff. Prefer doing it as a separate follow-up commit if time is short.

#### 4. Clean the old storage keys

Once on startup (e.g. in `store/explorer/` next to the list migration), remove the old interface's `localStorage` keys. Find them by grepping `useStorage(` and `localStorage` in the deleted files and in `store/workspaces_list.ts`; at least `workspaces_list_bookmarks`, `workspaces_list_last_opened`, and the old window's tab and sidebar keys. Also the `pile_commander_explorer` flag key itself. Do not touch keys the Explorer still reads (`pile_commander_explorer_*`, `show_hidden_files`, AI settings, experiments).

The old list migration (`start_explorer_list_migration`, step 0.8) reads `workspaces_list_*`. After the cleanup there is nothing to migrate: delete the migration and its `pile_commander_explorer_lists_migrated` key too, unless `store/workspaces_list.ts` is still the source of the browser and cloud roots (check `store/explorer/drives.ts` deps: `browser_workspaces()` reads it). Keep whatever the drives read.

#### 5. Import progress

`ImportProgressOverlay.vue` (progress of a file import) is mounted only in `WorkspaceWindow`. Check whether the Explorer shows import progress anywhere (drop files from the OS onto a folder, "Import files…" in the Add menu). If it does not, mount the overlay in `ExplorerShell.vue` (or `FolderContent.vue`) instead of deleting it, restyled with Explorer tokens.

#### 6. Not in 4.2

- Workspace tabs inside the store (`createWorkspaceStore.ts`: the tab stack, `open_folder_in_new_tab`, `next_tab_id`). The Explorer does not show tabs; cutting them touches the store every view uses. Record in `BACKLOG.md` for 2.3.x.
- Renaming browser-storage folders to readable names: not done (see above).

### Checks

From the repo root:

```bash
bun run test
```

```bash
cd apps/client && node_modules/.bin/vue-tsc --noEmit
```

```bash
git diff --check
```

The import graph (Node script, run from `apps/client/src`; it follows `@/` and relative imports from `main.ts` and prints files reachable only through the given file):

```js
// node reach.mjs "$PWD"
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
function reach(entries, skip) {
  const seen = new Set(); const stack = [...entries]
  while (stack.length) {
    const f = stack.pop(); if (seen.has(f) || skip.has(f)) continue; seen.add(f)
    const text = fs.readFileSync(f, 'utf8')
    for (const m of text.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g)) {
      const r = resolve(f, m[1] || m[2] || m[3]); if (r) stack.push(r)
    }
  }
  return seen
}
const all = reach([path.join(src, 'main.ts')], new Set())
const ww = path.join(src, 'ui/workspace/WorkspaceWindow.vue')
const without = reach([path.join(src, 'main.ts')], new Set([ww]))
console.log([...all].filter(f => !without.has(f)).map(f => path.relative(src, f)).sort().join('\n'))
```

After step 3, run it with no file skipped and compare against `git ls-files 'apps/client/src/**/*.vue' 'apps/client/src/**/*.ts'` (minus tests) to list files nothing imports.

Manual, in the browser preview (`.claude/launch.json` → `client`) and in the desktop app:

- the app starts in the Explorer, last folder restored;
- an invitation link `/invite/<token>` shows the new page; accept opens the cloud folder;
- a publication link that does not exist shows "not found", "Back to Hub" works;
- `/demo` and a real publication still open as read-only folders;
- dropping a folder from the OS onto the top bar bookmarks it, elsewhere opens it; dropping files imports them (with progress, step 5);
- Settings has no "New interface" switch.

### Commit

One commit, written by the owner after review, e.g.:

```
Explorer step 4.2: the old window, its sidebar, tree, workspace list and Hub are gone; invitation and missing-publication screens live in the Explorer; old storage keys are cleared.
```

## Out of scope (product backlog after 2.3)

From the integration plan, not planned for 2.3:

- Dashboard view.
- Manual folder order in the tree.
- Folder search and "Open in browser" (behind iteration flags in the prototype).
- Dragging between `~` and the cloud: the tree shows one drive at a time; needs spring-loaded source buttons and a move-or-copy decision.
- Sort by date modified: no `FileManager` reports a modification date yet.
- Folder aliases (shortcuts).
- Nested sync.
- New drive kinds (S3, media servers): the `Drive` abstraction allows them; none is built.
