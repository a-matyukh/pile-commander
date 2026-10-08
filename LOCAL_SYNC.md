# Local folders that stay in sync (Auto-sync)

Status: **two-way sync is built** in the desktop app (branch
`feature/local-auto-sync`). The database changes it needs are applied to
the live project. Follow `AGENTS.md` → "Project stage: production" for any
further database step.

The landing promises the feature on /vision ("Local folders that stay in
sync"): a workspace folder on disk and its cloud copy, changes travelling
both ways, and on either side the folder is still a board or a canvas.

## Entry points

- **A local workspace → Share → Auto-sync.**
  - Opens the bridge dialog with door `sync`: measure, quota wall, upload
    into a new cloud workspace.
  - "Sync with that copy instead" links to an earlier "Copy to cloud" copy
    without uploading.
  - "Copy to cloud…" stays a separate one-off copy.
- **A cloud workspace → Share, or the workspaces list → "Sync to a folder on
  this computer…"** (owners and editors, desktop only).
  - Asks for a parent folder (inside the home folder; `~/Pile Commander` is
    suggested) and makes a new empty folder named after the workspace.
  - Links the folder and opens it; the first pass downloads the workspace.
  - Once linked, the item reads "Open synced folder".
- **The cloud icon** in a synced folder's header opens the status popover:
  - progress, last sync, conflicts, skipped and failed items;
  - Sync now, Open cloud copy, Turn off Auto-sync;
  - the two mass-delete confirmations.

Only a signed-in desktop app syncs; nothing runs while it is closed. The
next launch catches up exactly, from the base.

## Code map

| Piece | Where |
| --- | --- |
| Types, `sync.json` shape | `apps/client/src/services/cloud/sync/types.ts` |
| Entries: three-way plan (pure) | `…/sync/reconcile.ts` |
| Layout: three-way merges (pure) | `…/sync/layoutSync.ts` |
| Local walk and layout read | `…/sync/localScan.ts` |
| One pass: plan → actions on both sides → base → layout | `…/sync/syncPass.ts` |
| Scheduling: watchers, debounce, interval, backoff, progress | `…/sync/syncEngine.ts` |
| `sync.json` parsing and ownership | `…/sync/stateFile.ts` |
| The folder for "Sync to a folder…" | `…/sync/syncToFolder.ts` |
| Tests | `…/sync/sync.test.ts` |
| App store: links, engines, Tauri fs, `LocalWriter`, cloud wiring | `apps/client/src/store/localSync.ts` |
| First upload of a local folder | `store/bridge.ts`, door `sync` (`BridgeDialog.vue`) |
| Menu items, status popover | `ui/workspace/sidebar/Sidebar.vue`, `SyncStatusButton.vue`, `workspaces-list/WorkspacesList.vue` |
| Cloud reads and signal | `packages/file-manager/src/supabase.ts`: `list_workspace_entries`, `list_workspace_strokes`, `list_workspace_connections`, `watch_workspace`, `replace_file`, `purge_entry_id` |

## How it runs

**Links.** `link_folder()` writes `<root>/.pile/sync.json` and records the
link in localStorage (`local_sync_links`, by folder path).
- The app starts an engine for every link of the signed-in account, whether
  a window shows the folder or not.
- One cloud workspace syncs with one folder per account on a device; a
  second link is refused.

**Engine (`syncEngine.ts`).** One per linked folder. Passes never overlap; a
change during a pass queues one more. A pass runs:
- at start;
- ~2 s after the folder watcher goes quiet;
- ~2 s after a cloud event (`watch_workspace`: entries, ink, edges and
  reconnects, from any other client);
- every 5 minutes;
- on Sync now;
- after a failure, with backoff from 30 s to 5 min.

Realtime events only *wake* a pass; nothing is applied from an event.

**Pass (`syncPass.ts`).**
1. Read the folder: tree, size, mtime, xattrs, ink, edges.
2. If nothing differs from the base and the cloud may not have changed,
   stop. No network call.
3. Otherwise list the cloud in three paged reads: entries, strokes, edges.
4. Plan the entries (`reconcile.ts`). Pause on a mass delete (see Safety).
5. Carry the actions out on both sides.
6. List the entries again for the new base.
7. Read the folder's layout **again** (moves and downloads changed it) and
   merge the layout both ways (`layoutSync.ts`).

The base records both sides as the writes left them, so the pass that the
writes' own echoes wake finds nothing to do.

## `sync.json` (v2)

```json
{
  "version": 2,
  "workspace_id": "<cloud workspace>",
  "user_id": "<account>",
  "device_id": "<client_instance_id()>",
  "root_path": "/Users/me/Harbor moodboard",
  "exclude": ["video/huge.mov"],
  "adopt_before": 1791459000000,
  "entries": {
    "board/note.md": {
      "kind": "file", "size": 7, "mtime_ms": 1791459000000,
      "cloud_id": "<entries.id>", "cloud_modified_at": "<content_modified_at>",
      "xattrs": { "position": "{\"x\":1,\"y\":2}" }
    }
  },
  "layout": {
    "board": {
      "strokes": { "<cloud stroke id>": { "local_id": "<id here>", "hash": "…", "downloaded_at": 1791459000000 } },
      "connections": { "board/a.md|default|board/b.md|default": { "hash": "…" } }
    }
  },
  "root_xattrs": { "view": "board" },
  "last_synced_at": 1791459000000
}
```

- **Ownership.** A file whose `root_path`, `device_id`, `user_id` or
  `workspace_id` do not match the link is ignored. A folder copied elsewhere
  or to another device carries the file but is not linked.
- **`.pile` is never synced.** The watcher filter, listings, the bridge and
  the `.pile` export (`workspace_pack.rs`) all skip it.
- **Reading a v1 file.** It is still read, and its first pass lifts it:
  - where the ink and xattrs here still match the hashes v1 last pushed,
    they become the base (ink under `derived_uuid`);
  - otherwise the merge starts without a base.

  `exclude`, `adopt_before` and the entries carry over.

## Rules: entries (`reconcile.ts`)

Planned in three phases:
1. Moves made here go to the cloud.
2. Moves made in the cloud come here.
3. Each entry is decided against the base.

| Here (vs base) | Cloud (vs base) | Action |
| --- | --- | --- |
| unchanged | new / edited | download (folders: `download_folder`) |
| unchanged | renamed / moved (same `cloud_id`) | `local_move` (the local FM rebases `.pile/connections.json`) |
| unchanged | deleted | `local_trash`: system trash, only inside the root |
| edited (size or mtime) | unchanged | update: text in place, a blob via `replace_file` |
| edited | edited | `local_conflict` (below) |
| edited | deleted | upload again |
| deleted | unchanged | cloud trash (30 days) |
| deleted | edited | download it back |
| deleted | deleted | forget |
| new | nothing there | create folder / upload |
| new | the same kind and size there | adopt |
| new | a different size; untouched since `adopt_before` | update |
| new | anything else there | `local_conflict` |
| same size and mtime under a new path | — | move in the cloud, keeping the id |
| a folder whose files all moved along | — | move in the cloud |
| an empty folder, exactly one new folder beside it | — | rename in the cloud |

**`local_conflict`: the cloud version keeps the name on both sides.**
1. The file here is renamed to `name (conflicted copy YYYY-MM-DD HHMM).ext`,
   and the link of the name is dropped and saved at once.
2. The copy goes up as a new cloud file.
3. The cloud version comes down under the name.

**Folders** are removed on either side only when nothing in them would be
lost. Otherwise the folder comes back, or is recreated, and its entries are
decided one by one.

**Left out** (reported, never deleted):
- names the cloud refuses (`is_cloud_name`), and cloud names this device
  cannot write (`is_local_name`);
- files over the plan's per-file limit;
- `exclude`;
- everything under such a folder;
- a move onto a path that something else holds (`occupied`, retried later).

## Rules: layout (`layoutSync.ts`)

- **xattrs (cards: position, size, view…).** Merged key by key:
  - a change on one side goes to the other;
  - changed on both, the cloud wins;
  - a removed key is removed on the other side;
  - with no base yet, keys are united and the local value wins where the
    two differ.
- **Ink.** By cloud id; the base maps it to its id here.
  - Ink drawn here goes up as `derived_uuid(workspace_id, local id)`.
  - Ink that came down keeps its cloud id here, so it is never re-hashed
    into a duplicate.
- **Edges.** By `from|from_handle|to|to_handle`, with root-relative ends.
  - On disk: absolute ends and the board's deterministic id, so reading the
    sidecar never "heals" (rewrites) it.
  - In the cloud: cloud paths and the cloud id.
  - An edge counts only when both ends exist on both sides.
- **For both ink and edges:**
  - a change goes across; changed on both, the cloud wins;
  - erased on one side, it is erased on the other;
  - ink and edges of folders in the cloud trash are ignored.
- **An open board can overwrite what just came down.** A local sidecar
  write is read back, and only what landed enters the base. Ink or an edge
  that came down less than **10 s** ago and vanished was written over by
  the board: it comes down again instead of being erased in the cloud. The
  window runs from the first download.

## Safety

- **Mass delete pauses, separately per side.** A pass that would trash at
  least 20 files **and** over half of one side pauses:
  - `mass_delete_cloud`: the folder was emptied or unmounted here;
  - `mass_delete_local`: the cloud workspace was emptied.

  Each has its own confirmation in the popover, and confirming one does not
  confirm the other.
- **The system trash is only reached inside the root.** `local_trash` never
  touches the root itself or a `.pile` path, and `store/localSync.ts` checks
  the path again before calling `trash_path`.
- **Downloads never show half-written.** The file is written under
  `<folder>/.pile`, renamed over the target, then its xattrs are set back
  (a new file gets the cloud's, a replaced one keeps its own), then it is
  stat'ed for the base.
- **An interrupted pass does not misread its own writes.** The base is
  saved during the pass:
  - moves, deletes, folder downloads and conflicts at once;
  - content writes at most every 2 s;
  - the whole state at the end.
- **Failures.** Three failed actions in a row end the pass; the error is
  shown and retried with backoff. A plan refusal (`quota_exceeded`,
  `file_too_large`) pauses; what synced before it stays in the base.

## Why it is built this way

- **One reconciling pass, no event-driven apply.** Realtime delete events
  are partial: edge deletes need a prior listing, stroke deletes have no
  folder. A full three-way pass from three cheap listings has no ordering,
  echo or lost-event problems.
- **The cloud keeps the name on a conflict.** That version may already be
  seen by collaborators; nothing is lost, and both sides end up identical.
- **Ink ids are mapped, not re-derived.** `derived_uuid` is a one-way hash.
  Re-deriving ink that came down would duplicate it every cycle.
- **"Sync to a folder…" only takes an empty folder.** There is no content
  hash, so files of the same size in an existing folder would be adopted
  unread.
- **One folder per workspace per device.** Two engines would write each
  other's files.

## Limits

- **The app must be open.** There is no background agent or tray.
- **Size and mtime detect edits here.** A same-size edit that restores the
  old mtime is missed (a content hash, item 4 below, would fix it).
- **Echo window.** The re-listing after the actions absorbs a cloud edit
  made by someone else in between (about a second per pass); that edit is
  then treated as already synced.
- **A folder inside iCloud/Dropbox linked on two machines is not
  supported.** Both engines would write the same files.
- **An old backend changes the cloud id on a binary edit.** It does not
  echo `replace`, so the pass falls back to trash, purge and one upload; the
  entry's layout and edges are pushed again.
- **The board does not lock its sidecars.** The 10 s window covers the race
  for ink and edges that just came down, not an arbitrary later one.

## Database changes

Each change is a forward diff on the live project, applied with
`apply_migration` and mirrored into `schema.sql` / `rpc.sql`. Run:
- `postgres.test.ts` locally before;
- `test:rls:remote` and `get_advisors` after.

1. **`bridge_events.door` accepts `'sync'`.** Done. `record()` in
   `store/bridge.ts` writes Auto-sync funnel steps.
2. **`replace_blob_entry`.** Done; a binary edit keeps `entries.id`.
   - **Locking.** `lock_workspace_tree`, then a plain read of the row, then
     the quota by size delta, then the `UPDATE`. The order is workspace →
     billing → row; a `FOR UPDATE` before billing deadlocks with a text save
     of the same entry (covered by `postgres.test.ts`).
     `lock_entry_workspace` is not used: it checks `auth.uid()`, which is
     null under the service role.
   - **Content.** Text is dropped before the key is set.
     `content_modified_at` is set explicitly, and the old key goes to
     `blob_deletions` (GC and previews need no change).
   - **Wiring.** `complete_upload` branches on `p_request ? 'replace'`.
     `/presign/upload` echoes `replace` and charges the size delta;
     `/finalize` takes `replace` without a parent or name.
   - **Client.** The client checks the echo before the PUT and remembers an
     old backend for the session.
   - **Deploy.** The backend change is in this branch, not deployed.
     `BACKGROUND_WORKERS=off` runs a local backend without the GC,
     reconcile, preview, moderation and egress jobs.
3. **`entries_changed_since`.** Not needed: a pass reads the workspace whole.
   It is worth it only if large workspaces make full listings slow.
4. **Optional: `entries.content_sha256`.** For exact adopt and rename
   decisions, and to catch a same-size edit. Not started.

## Manual check (desktop app)

Run the dev app against a local backend (no deploy):

```bash
cd apps/backend && BACKGROUND_WORKERS=off bun run dev
```

```bash
VITE_BACKEND_URL=http://localhost:3000 bun run dev:desktop
```

Quit the installed app first: it may share the dev build's storage and links.

1. A local workspace → Share → Auto-sync → Start sync. One cloud workspace
   appears, and the folder stays open.
2. Make each of these here and check it in the web app:
   - edit a note in another editor;
   - add an image;
   - rename a folder;
   - move a card;
   - draw ink;
   - connect two cards.
3. Make each of these in the web app; within seconds it shows on the local
   board:
   - edit a note;
   - add a file;
   - rename;
   - move a card;
   - draw;
   - connect.
4. Rotate an image in macOS Preview and save. The cloud row keeps its id
   (new `storage_key`), and the image refreshes on both boards.
5. Delete a file in the web app. It goes to the macOS Trash. Delete one
   here; it goes to the cloud trash.
6. Edit the same note here and in the web app. The web version keeps the
   name on both sides; yours sits beside it as a conflicted copy.
7. Empty the cloud workspace in the web app. Sync pauses and asks before
   moving files here to the Trash. Empty the folder here: it asks before the
   cloud trash.
8. Turn Auto-sync off for the folder. On the cloud copy choose "Sync to a
   folder on this computer…": a new folder downloads the whole workspace,
   with layout, ink and edges.
9. Quit, edit a file, relaunch. It syncs.
