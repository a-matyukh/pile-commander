# Demo pack: the web demo from piles/

The demo workspace (`/demo` on the web and "Open demo workspace" in the
desktop app) shows the full `piles/` content. The landing hero embeds `/demo`
(`apps/landing/components/DemoFrame.vue`), and TryDemos links to it and to
the `.pile` downloads.

Status: **done** (2026-09-28), apart from the follow-ups at the end.

## Layout

The root board is a start page, sized to read in the landing hero iframe
(~700 × 460 px of board):

- **`Welcome.md`**: a greeting, and how to open folders and go back.
- **Features** and **Use cases**: from `piles/`, with colored covers and a
  caption note under each.
- **Sandbox**, below them: the old small demo from
  `packages/file-manager/src/demo-content.json`, with a note next to it. In the pack, its
  `Welcome.txt` becomes `Start here.txt`.

Positions, covers and every word of the copy live in `ROOT_FOLDERS`,
`ROOT_NOTES` and `SANDBOX_START` in the exporter. Edit them there, not in `piles/`.
The fallback demo (no pack) still shows demo-content.json at the root.

## Update cycle

Edit `piles/` in the desktop app or with the demo-piles skill, then:

```bash
bun run demo:publish          # save layout → rebuild → commit only the pack
bun run demo:publish --push   # … and push (main only): deploys the web demo
```

`apps/client/scripts/publish-demo-pack.ts`:

1. Runs the rebuild below.
2. Stops with "up to date" when the output did not change.
3. Otherwise commits just `apps/client/public/demo-pack/` and
   `apps/landing/public/demos/` as "Update demo pack", with a pathspec commit:
   other staged or modified work is left alone.
4. With `--push` it pushes, and only from `main`, which is where the web deploys from.

The desktop app picks up the new demo only with its next release, because the
pack ships inside the bundle.

The promo video and ProductHunt slides are not part of this cycle. Regenerate
them by hand when the demo has changed enough (`apps/landing/promo/README.md`).

## Rebuild

```bash
bun run demo:pack
```

It starts with the skill's `pile_attrs.py save`. Layout edited in the app lives
in xattrs, and `piles/.pile/attrs.json` mirrors it only after a save. Before
this step a stale layout was published silently: two slide folders had drifted.

The output is deterministic. Zip entries carry a fixed timestamp, and sips
re-encodes identically. An unchanged `piles/` rebuilds byte-identical files, so
`demo:publish` commits nothing.

`apps/client/scripts/export-demo-pack.ts` (macOS: it uses `sips`) writes:

- **`apps/client/public/demo-pack/manifest.json`**: a `DemoContent` with the whole tree.
  - Text files (md/txt/svg/json/csv) are inlined.
  - Binaries get `src: /demo-pack/files/…` and `size`.
  - `folder_connections` / `folder_strokes` carry the `.pile/` sidecars.
- **`apps/client/public/demo-pack/files/…`**: the binaries.
  - Photos (jpg) are resized to at most 1600 px at q80. The original is kept when it is smaller.
  - Byte-identical files are served once: demos reuse media.
- **`apps/landing/public/demos/features.pile`, `use-cases.pile`**: archives the desktop import reads.
  - Each has one root folder, the files and `.pile/attrs.json`.
  - The layout is collected with `collectPileAttrs` from the same in-memory demo the app shows.

**Author paths never leave the machine.** `.pile/connections.json` stores absolute
paths. The exporter rewrites endpoints (and deterministic ids) relative to their
folder, and fails if `/Users/`, `/home/` or a drive path survives anywhere in the manifest.

Commit the regenerated files. They live in git by decision (simple, versioned
with the code, served by Vercel's CDN): ~6.6 MB of pack and ~9 MB of `.pile`.

## Runtime

- **`packages/file-manager/src/fake.ts`**: an entry can be URL-backed (`seed_url_file`).
  - `get_media_src` returns the URL itself, so media renders straight from it.
  - `entry_size` answers from the manifest.
  - `read_text_file` fetches on demand.
  - Copies stay URL-backed; a save replaces the URL with text.
  - Nothing is prefetched. Opening `/demo` loads only `manifest.json`; a folder
    loads only the media it shows.
- **`packages/file-manager/src/demo.ts`**: `createDemoFileManagerFrom(content)` seeds it.
  Relative connection endpoints are healed onto the demo root by `resolve_folder_connections`.
- **`apps/client/src/services/demoPack.ts`**: `create_demo_file_manager()` fetches
  `/demo-pack/manifest.json`. On failure it falls back to the bundled
  `demo-content.json` (Sandbox's content at the root).
  `store/helpers/openWorkspaceStore.ts` uses it for `type: 'demo'`.
- **Desktop**: the pack ships inside the app bundle (`public/` goes into
  `dist`), so the desktop demo works offline. The cost is +~6.6 MB of app size.
  The button is in `WorkspacesList.vue` for both builds.
- **The promo recorder** (`apps/landing/promo/`) records the real `/demo`.

Edits in the demo stay in memory and are lost on reload. That is intended.

## Tests

- `packages/file-manager/src/demo.test.ts`: URL-backed entries, relative
  connections, strokes.
- `apps/client/src/services/demoPack.test.ts`: loading the pack and the fallback.
- Manual check, done 2026-09-28:
  - Every `.pile` was unzipped, imported into a fake FM with `applyPileAttrs`
    and compared with the demo. Children, xattrs, all 39 connections and the ink matched.

## Follow-ups

- **Deep links**: `/demo/<path>`, e.g. `/demo/Use cases/Kanban`, parsed in
  `apps/client/src/services/publicRoute.ts`. With that, the TryDemos "Open online"
  buttons could open Features / Use cases directly; today both open `/demo`.
- **TryDemos preview images** (`image` in `TryDemos.vue`): the promo stills in
  `apps/landing/promo/.work/stills/` would do.
- **Desktop check**: "Open demo workspace" and the `.pile` import were not run
  in a real Tauri build yet. The archive format was checked against `applyPileAttrs` only.
