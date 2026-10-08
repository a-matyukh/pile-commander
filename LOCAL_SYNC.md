# Local folders that stay in sync (Auto-sync)

Status: **phase 1 is shipped in the client** (one-way, local → cloud, desktop
only, no database changes). **Phase 2** (two-way, plus the database changes
below) is not started. This document is the hand-off for an agent with
Supabase access. Follow `AGENTS.md` → "Project stage: production" for every
database step.

The landing promises the feature on /vision ("Local folders that stay in
sync"). "Copy to cloud…" stays a one-off copy; Auto-sync is a separate
switch under it in the workspace Share menu.

## Phase 1: what exists

| Piece | Where |
| --- | --- |
| Types, `sync.json` shape | `apps/client/src/services/cloud/sync/types.ts` |
| Three-way plan (pure) | `…/sync/reconcile.ts` |
| Local walk and layout read | `…/sync/localScan.ts` |
| One pass: plan → actions → base → layout | `…/sync/syncPass.ts` |
| Scheduling (watch, debounce, interval, backoff) | `…/sync/syncEngine.ts` |
| `.pile/sync.json` parsing and ownership | `…/sync/stateFile.ts` |
| Tests | `…/sync/sync.test.ts` |
| App store: links, engines, Tauri fs, cloud wiring | `apps/client/src/store/localSync.ts` |
| First upload | `store/bridge.ts`, door `'sync'` (BridgeDialog.vue) |
| Menu switch, status popover | `ui/workspace/sidebar/Sidebar.vue`, `SyncStatusButton.vue` |
| Cloud helpers | `packages/file-manager/src/supabase.ts`: `list_workspace_entries`, `purge_entry_id` |

### Flow

1. Share → **Auto-sync** on a local desktop workspace opens the bridge dialog
   (door `sync`): measure, quota wall, upload into a **new** cloud workspace.
   If the folder was copied before, "Sync with that copy instead" links to
   that workspace without uploading.
2. `link_folder()` writes `<root>/.pile/sync.json` and registers the link in
   localStorage (`local_sync_links`, keyed by folder path) so the app syncs
   the folder from launch on, whether a window shows it or not.
3. `create_sync_engine()` runs a pass at start, ~2 s after the watcher goes
   quiet, every 5 minutes, and after a failure with backoff (30 s → 5 min).
   Passes never overlap. Nothing runs while the app is closed; the next
   launch catches up (the base snapshot makes that exact).
4. A pass reads the folder (tree, size, mtime, xattrs, ink, edges). When
   nothing differs from the base it stops there: **no network call**.
   Otherwise it lists the cloud workspace once, plans, acts, lists again for
   the new base, then pushes the layout.

### `sync.json`

```json
{
  "version": 1,
  "workspace_id": "<cloud workspace>",
  "user_id": "<account>",
  "device_id": "<client_instance_id()>",
  "root_path": "/Users/me/Harbor moodboard",
  "exclude": ["video/huge.mov"],
  "adopt_before": 1791459000000,
  "entries": {
    "board/note.md": { "kind": "file", "size": 7, "mtime_ms": 1791459000000,
      "cloud_id": "<entries.id>", "cloud_modified_at": "<content_modified_at>",
      "xattrs_hash": "1x2y3z" }
  },
  "layout": { "board": { "strokes_hash": "…", "connections_hash": "…" } },
  "root_xattrs_hash": "…",
  "last_synced_at": 1791459000000
}
```

A file whose `root_path`, `device_id`, `user_id` or `workspace_id` do not
match the link is ignored. A folder copied elsewhere carries the file along,
and must not push into the original's workspace. `.pile` is skipped by the
watcher filter, the bridge and the `.pile` export (`workspace_pack.rs`).

### Rules (reconcile.ts)

| Here (vs base) | Cloud (vs base) | Action |
| --- | --- | --- |
| new | nothing at that path | create folder / upload |
| new | same kind and size at that path | adopt (link, no upload) |
| new | different size; untouched since `adopt_before` | update |
| new | anything else at that path | conflicted copy |
| edited (size or mtime) | unchanged (`content_modified_at`) | update: text in place; binary replaced (below) |
| edited | changed | upload as `name (conflicted copy YYYY-MM-DD HHMM).ext`; the link then follows the copy |
| edited | gone | upload again |
| unchanged | changed / gone | nothing: cloud edits are kept |
| gone | unchanged | soft delete (trash, 30 days); a folder only if nothing in it would be lost |
| gone | changed | forget the link |
| same size and mtime under a new path (unique pair) | — | rename / move, keeping the id |
| folder gone, a new folder holds all its files unchanged | — | rename / move |
| empty folder gone, exactly one new folder beside it with the same subfolders | — | rename |

Left out (reported, never deleted): names the cloud refuses
(`is_cloud_name`), files over the plan's per-file limit, `exclude`, and
everything under such a folder.

Safety:

- A pass that would trash at least 20 files **and** over half of the copy
  pauses ("mass_delete"). The popover asks before trashing them. This covers
  an emptied or unmounted folder.
- Three failed actions in a row end the pass. The error is shown and the
  pass is retried with backoff.
- A plan refusal (`quota_exceeded`, `file_too_large`) pauses the pass. What
  went up before it is kept in the base.

Layout:

- xattrs push only keys whose value differs from the cloud row. The first
  push of an entry only adds keys; later pushes also remove keys removed here.
- Ink is a diff by id. Cloud ids are `derived_uuid(workspace_id, local_id)`,
  stable per workspace and unique across workspaces.
- Edges are a diff by id. Root-relative endpoints are rebased onto cloud
  paths, and deterministic ids are recomputed.
- Layout pushes are one-way too: a changed local layout of a folder replaces
  that folder's cloud ink and edges.

### Phase 1 limits (and why)

- **Binary edits change the cloud id.** No RPC replaces a blob in place, so a
  pass does three things: soft-delete, `purge_entry_id` (the trash counts
  toward the quota), then upload. The entry's xattrs and its folder's edges
  are pushed again, because the purge cascades the edges. Fix: `replace_blob`
  below.
- **Cloud edits are not pulled.** This is one-way, and the status popover
  says so.
- **mtime + size detect local edits.** A same-size edit that restores the old
  mtime is missed. A hash would fix that (optional item 4 below).
- **`bridge_events` is not written for door `sync`.** The `door` check
  constraint does not list it. `record()` in `store/bridge.ts` returns early;
  see item 1.
- **Echo window.** The second listing absorbs a cloud edit made by someone
  else between our write and that listing. The next local edit of that file
  then overwrites it. The window is about a second per pass.

## Database changes (for the agent with Supabase access)

Each is a short forward diff on the live project, applied once with
`apply_migration` and then mirrored into `schema.sql` / `rpc.sql`. Before the
diff, run `postgres.test.ts` locally. After it, run
`bun --filter @pile-commander/file-manager test:rls:remote` (every row
`ok = true`), then `get_advisors`. Add `rls.test.sql` checks for every new
function: anon, a non-member, a viewer and an editor are refused or allowed
as the table below says.

### 1. `bridge_events.door` accepts `'sync'`

```sql
alter table public.bridge_events drop constraint bridge_events_door_check;
alter table public.bridge_events add constraint bridge_events_door_check
    check (door in ('share', 'publish', 'device', 'list', 'tile', 'pile', 'sync'));
```

Check the real constraint name first (`\d public.bridge_events`). Then
extend `BridgeEventInput['door']` in `supabase.ts` and drop the early return
for `sync` in `record()` (`apps/client/src/store/bridge.ts`).

### 2. Replace a blob in place (`replace_blob_entry`)

Goal: a binary edit keeps `entries.id` (so edges, layout and links survive)
and does not hold the old bytes in the trash.

- **Request.** Keep upload kind `'blob'`, so `assert_upload_access` and
  `register_upload` stay as they are. `/finalize` accepts an optional
  `replace` (entry id) in the request body. `prepare_upload` binds the ticket
  to the whole body as before.
- **`private.complete_upload`.** When `p_request ? 'replace'`, call
  `private.replace_blob_entry(...)` instead of `create_blob_entry`.
- **New `private.replace_blob_entry(p_entry uuid, p_workspace uuid,
  p_storage_key text, p_size_bytes bigint, p_mime text, p_user uuid,
  p_client_id text)`**, `security definer`. It must:
  - call `private.lock_entry_workspace(p_entry)`, then re-read the row;
  - refuse unless the row is live, `kind = 'file'`, belongs to `p_workspace`,
    and `private.can_write_workspace` holds for `p_user`;
  - check the quota with the **delta** against the old size:
    `private.assert_owner_can_add(owner, p_size - coalesce(old.size_bytes, 0), p_size)`;
  - if the row held text, delete its `entry_contents` row first. Check that
    `entries_payload_check` and `entry_contents_guard` allow the switch in one
    transaction;
  - `update public.entries set storage_key = p_storage_key, size_bytes = p_size,
    mime = p_mime, content_modified_at = now(), updated_by = p_user,
    updated_by_client = p_client_id where id = p_entry`.
    Set `content_modified_at` **explicitly**: `entries_touch` treats a key
    swap on a row that already had a blob as a fork re-key and leaves it
    alone;
  - enqueue the old key:
    `insert into public.blob_deletions (storage_key) values (old.storage_key)`.
    Only a hard delete enqueues one today. Confirm that
    `apps/backend/src/gc.ts` skips keys still referenced by another row
    (same-workspace copies share keys);
  - return the row as `create_blob_entry` does.
- **Idempotent retries.** The `p_kind = 'blob'` "result is not null" branch
  of `prepare_upload` re-reads the entry by `result->'entry'->>'id'`. That
  works for a replace too, since the id is unchanged.
- **Backend.** `apps/backend/src/blobs.ts` `/finalize` passes `replace`
  through. `uploads.ts` copies staging to the final key as today.
- **Client.** Add `replace_file(id, data, mime, onProgress)` to the cloud FM:
  presign → PUT → finalize with `replace`. In `PassRun.update`
  (`syncPass.ts`), use it for blobs. When finalize answers 404/400 for an
  unknown field, keep the phase 1 fallback, so code that ships before the
  diff still works.
- **Tests.**
  - `postgres.test.ts`: quota delta; viewer refused; trashed row refused;
    text → blob switch; old key enqueued; `content_modified_at` moves.
  - `rls.test.sql`: replace through the public wrapper refused for anon and
    non-members.

### 3. Incremental listing (needed for phase 2 pull)

`entries_select` already lets writers see rows trashed in the last
2 minutes, but not older ones. Two-way sync needs every change since a
cursor, deletes included:

```sql
create or replace function public.entries_changed_since(p_workspace uuid, p_since timestamptz)
returns setof public.entries   -- or a slim column list
language sql stable security definer set search_path = public, extensions as $$
    select * from public.entries
     where workspace_id = p_workspace
       and p_workspace in (select private.readable_workspace_ids())
       and greatest(updated_at, coalesce(deleted_at, updated_at)) > p_since
     order by updated_at;
$$;
```

The usual hardening applies: revoke from `public` and `anon`, grant to
`authenticated`, and add a covering index on `(workspace_id, updated_at)` if
`get_advisors` asks.

### 4. Optional: content hash

Add nullable `entries.content_sha256 text`. The backend computes it for blobs
at finalize; `entry_contents_touch` computes it for text with
`encode(sha256(convert_to(content, 'UTF8')), 'hex')`. It gives exact "same
file" decisions on adopt and rename, and catches a same-size edit. App code
must tolerate `null` (old rows).

## Phase 2: two-way (client)

- **Pull.** Subscribe to `entries` Realtime of the linked workspace (the
  cloud FM `watch`), and on `resync` read `entries_changed_since(cursor)`.
  Apply cloud-only changes to the folder through the local FM:
  - write files;
  - trash deletions with `trash_path` (the OS trash);
  - rename and move by `cloud_id`.
- **Rules become symmetric:**
  - unchanged here + changed there → download;
  - changed on both → the cloud version comes down as a local conflicted copy.
- **Echo.** Each side ignores its own writes: the local watcher during a
  download, and cloud events with `updated_by_client = client_instance_id()`.
- **Layout from the cloud** into xattrs and `.pile/strokes.json` /
  `connections.json`. Cloud ink ids map back through a reverse map stored in
  `sync.json`.
- **UI.**
  - per-card sync badges (the /vision mock);
  - "Synced with <device>" on the cloud workspace;
  - a conflicts list.

## Manual check (desktop app)

1. A local workspace → Share → Auto-sync → Start sync. The cloud workspace
   appears once, and the folder stays open locally.
2. Edit a note in another editor. Within seconds the cloud copy shows it, the
   file keeps its id (open the workspace in the web app) and no new workspace
   appears.
3. Check that each of these reaches the cloud copy:
   - add an image;
   - rename a folder;
   - move a card on the board;
   - draw ink;
   - connect two cards.
4. Delete a file; it is in the cloud trash.
5. Edit the same note in the web app and locally. A conflicted copy appears,
   and the web edit stays.
6. Empty the folder. Sync pauses and asks before trashing the files.
7. Quit and edit a file. On the next launch it syncs.
