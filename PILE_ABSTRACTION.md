# Idea: one "pile" instead of desktop + workspace

Status: **a thought for a future major version**, not a plan for the next
releases. Written down so later decisions keep it cheap.

## The idea

Today there are three nested concepts — desktop → workspace → folder — plus
windows next to folder previews. They could collapse into one:

> A **pile** is a heap of files, folders and links that its user — the
> commander — organizes. That is all.

The product is already called Pile Commander. The name describes the model.

## What it unifies

| today | as piles |
| --- | --- |
| workspace | a pile |
| desktop | the user's root pile (on Linux: `~/Desktop`, just a folder) |
| workspaces on a desktop | piles inside a pile, or links to them |
| loose files on a desktop | files in the root pile — no hidden system workspace |
| windows | folder previews + a saved session on the pile |
| shortcuts to programs | link entries (`.desktop` on Linux, alias on macOS, `.lnk` on Windows) |
| "aliases" (future) | link entries to other piles, including other people's |

The multi-owner scenario from [DESKTOPS_EXPERIMENT.md](DESKTOPS_EXPERIMENT.md)
— a "music" pile with my own track, one shared with a producer and one shared
with two others — becomes three links inside my pile. Each collaborator keeps
their own links in their own piles. Nothing needs a separate desktop layer.

## Why it fits

- **One mental model.** No desktop vs workspace vs folder; no windows vs
  previews.
- **"Plain folders all the way down" without exceptions.** Every pile is a
  folder with extended attributes (xattrs on macOS/Linux, NTFS streams on
  Windows); links are files too.
- **The Linux desktop vision** (/vision) needs exactly this: the desktop is a
  folder, workspaces are piles, programs are link files.

## Cost and timing

More expensive than simply removing desktops, which is why it belongs to a
major version:

- vocabulary across the UI, docs and landing ("workspace" → "pile");
- schema: rename/merge `workspaces`, membership and invites, publishing, Hub,
  forks and `.pile` archives (the archive name already fits);
- permissions for links (below);
- migration of existing workspaces and, if they survive the beta, desktops.

## What to do now to keep it cheap

- Don't add new distinctions between desktops and workspaces.
- Build new features (links/aliases, shortcuts, saved sessions) at the
  **workspace** level, as entries and attributes — they carry over to piles
  unchanged.
- Keep "a workspace is a folder with attributes" true everywhere.

## Open questions

- **Links and permissions.** A link to a pile I cannot read: hidden, shown as
  locked, or offered as "request access"?
- **Public piles.** How does a published pile show links to private piles —
  omitted, or as placeholders?
- **Link identity.** By id (survives renames) or by path (portable in `.pile`
  archives and on disk)? Probably both: an id plus a readable fallback.
- **Naming in the UI.** "Pile" everywhere, or "pile" as the concept and
  "workspace" kept for the top level? Test with users.
- **Local vs cloud.** A local pile linking to a cloud pile (and back) — what
  happens offline, and on another device?
