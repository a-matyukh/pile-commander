# Desktops: an experiment in the beta

Desktops and windows ship in the beta as an **experimental, opt-in** feature.
They may be removed. This document records why, what we watch to decide, the
rules that keep removal cheap, and the removal plan itself.

Related: [PILE_ABSTRACTION.md](PILE_ABSTRACTION.md) — a possible long-term
model that would replace both desktops and workspaces.

## Status

- Off by default. The app starts in the single-workspace mode: one workspace,
  full screen, no window controls.
- Turned on per device in **Settings → Experimental → Show desktops and
  windows** (`apps/client/src/ui/workspace/sidebar/workspaces-list/SettingsPanel.vue`).
  The switch lives in localStorage (`apps/client/src/store/experiments.ts`).
- Next to the switch the user is told that the feature may be removed, that
  their desktops' folders and files would become regular workspaces (nothing
  is lost), and where to leave feedback (landing `/feedback`).
- While it is off: window controls are hidden, Cmd/Alt+N does nothing,
  `store.enter_desktops_mode()` is a no-op, and a saved desktops mode starts as
  the fullscreen app. Turning it off inside desktops mode
  (`store.exit_desktops_mode()`) keeps the focused workspace open full screen;
  desktops and their windows stay stored and come back when it is turned on.

## What a desktop is today

A desktop plays three roles at once:

1. **A container of workspaces.** Folders on a cloud desktop's board are real
   workspaces with `workspaces.desktop_id` set.
2. **A place for loose files.** Files dropped on a cloud desktop's board are
   entries under `/desktop-<id>` in the owner's hidden system workspace
   (`workspaces.is_system`).
3. **A saved window layout.** `desktops.windows` (jsonb, `AppWindow[]`), plus
   presentation in `desktops.xattrs` (background, grid, snap).

Local desktops live in localStorage, with their children in a real folder on
disk (`~/Pile Commander/desktops/<id>` or a folder the user picked). Browser
desktops keep their children in IndexedDB.

The fullscreen mode does not depend on this machinery:
`ui/desktop/DesktopShell.vue` renders `WorkspaceWindow` directly when
`desktops.mode === 'fullscreen'`. The only shared piece is the mode flag.

## Why desktops may go

- **They overlap with workspaces + folder previews.** A workspace is already a
  folder with a view; a nested folder already opens as a preview. A desktop is
  mostly "a workspace that holds workspaces", with its own rules.
- **An extra concept layer.** Users have to learn desktop → workspace → folder,
  and windows next to folder previews. The original model was simpler: local or
  cloud workspaces, and that is it.
- **They break the product's promise.** The landing says "plain folders all the
  way down". Loose files on a cloud desktop are the one exception: they live in
  a hidden system workspace, not in a folder the user sees.

## The case for keeping them

A personal **home surface over things with different owners**. Example: a
"music" desktop with three tracks — one I write alone, one shared with a
producer, one shared with two other people. Workspaces cannot express this:
someone else's shared workspace cannot live inside mine.

**The current schema does not support this either.** `desktop_id` is a column
of the workspace itself, set by its owner, and a workspace pins to at most one
desktop. So a track someone else owns cannot sit on my desktop, and a track I
share cannot sit on my collaborator's desktop. The real version needs per-user
**links/aliases** — which can live inside a workspace just as well (see the
rules below and PILE_ABSTRACTION.md).

## Decision signals

Measured only from what signed-in accounts already store in the cloud. There is
no event log and no client analytics: the privacy page promises no trackers.

- `private.desktops_opt_ins` — one row per account that turned the switch on
  (first time only; never cleared). Written by `mark_desktops_opt_in()` when the
  switch goes on and on sign-in while it is on. A private table, not a
  `profiles` column: profile rows with a username are public.
- `desktops_experiment_report()` — admins only (`private.is_admin()`). One row:

  | column | question it answers |
  | --- | --- |
  | `opted_in_users` | how many turned it on at all |
  | `users_with_desktops`, `users_with_2plus_desktops` | is one desktop enough? |
  | `desktop_workspaces`, `users_with_2plus_desktop_workspaces` | do people gather workspaces on a desktop? |
  | `users_with_loose_files` | do people put files on the desktop itself? |
  | `users_with_2plus_windows`, `max_windows` | do people really use several windows? |
  | `active_14d` | is it used, or tried once? |

  Run it from the SQL editor or the app as an admin:
  `select * from public.desktops_experiment_report();`

Local and browser desktops never reach the server, so they are not counted;
for those users we rely on feedback.

**Kill criteria (a starting point):** most opted-in users have one desktop, one
window and no loose files, and the feedback does not name a scenario workspaces
cannot cover. Then remove desktops.

## Rules while the experiment runs

Removal cost must not grow. So:

- **No new dependencies on desktops.** Do not add features that only work on a
  desktop or read desktop state.
- **Build at the workspace level.** Shortcuts, links/aliases (including links
  to other people's workspaces and to programs), and saved window/session state
  belong to workspaces — e.g. a session attribute on the workspace root. They
  work in both modes and survive the removal.
- **No new desktop/workspace distinctions** in the schema or the UI vocabulary.

Why: every feature built on desktops either blocks their removal or has to be
rewritten during it. A feature built on workspaces is free either way.

## Removal plan

Pre-production rules (AGENTS.md) apply until there are users; after that, each
step needs a data migration, not a drop.

### 1. Data

- Workspaces on cloud desktops: `update workspaces set desktop_id = null` —
  they are already regular workspaces and already appear in workspace lists.
- Loose cloud desktop files: for each `/desktop-<id>` folder in a system
  workspace, create a regular workspace named after the desktop and move the
  entries into it (blob keys are reused; mind quotas and `node_path`). One RPC,
  run once.
- `desktops.windows`, `desktops.xattrs`: session state, dropped.
- Local desktops: their children already sit in a real folder
  (`~/Pile Commander/desktops/<id>` or the picked one) — it simply stays a
  folder the user can open as a workspace.
- Browser desktops: turn each IndexedDB desktop root into a browser workspace.

### 2. Client (`apps/client/src`)

- App root becomes `WorkspaceWindow` (or a thin shell around it); remove
  `ui/desktop/DesktopShell.vue`'s desktops branch.
- Delete `ui/desktop/*` (except the updater UI, which is about the desktop
  *app*), `ui/window/*`, `store/desktops.ts`, `store/desktopChildren.ts`,
  `services/cloud/desktops.ts`, `desktopBoards.ts`, `desktopBoardFileManager.ts`,
  `desktopRemoval.ts`, `systemWorkspace.ts`, `desktopsExperiment.ts`,
  `services/desktop/desktopFolders.ts`, `browserDesktopFolders.ts`,
  `store/experiments.ts` and the Settings switch.
- Remove the `mode === 'desktops'` and `window_context` branches
  (`store/index.ts`, `store/cloud.ts`, `store/workspaceRegistry.ts`,
  `services/navigatePublic.ts`, `services/publicRoute.ts`, `WorkspaceWindow.vue`,
  `WorkspacesPopover.vue`) and the desktop GC calls in `main.ts`.
- Note: "desktop" also names the Tauri desktop *app* (`isDesktop.ts`, updater) —
  that stays.

### 3. Schema (`packages/file-manager/src`)

- Drop `public.desktops`, `workspaces.desktop_id`, `workspaces.is_system` (after
  the file migration), the `p_desktop` parameter of `create_workspace`,
  `get_or_create_system_workspace`, `assert_owner_desktops`, `max_desktops` in
  plan defaults, `private.desktops_opt_ins`, `mark_desktops_opt_in`,
  `desktops_experiment_report`.
- Update `rls.test.sql`, `postgres.test.ts`, `SECURITY.md`.

### 4. Copy

- Landing: `apps/landing/components/home/WhereItLives.vue` ("Desktops saved in
  this browser", "The same desktops on every device") and any other mention of
  desktops.
