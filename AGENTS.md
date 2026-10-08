# Agent Notes

## Project stage: production

The Supabase project is production and holds real user data. Do not drop
columns or tables, rewrite the schema in place, or apply `schema.sql` /
`rpc.sql` as a whole to it. Those files are the desired end state of a fresh
database (and what `postgres.test.ts` loads). A change to the live project is
a short forward diff — `alter`, `create or replace`, a new table and its
policies — applied once through `apply_migration` or the SQL editor, then
mirrored back into the files. Preserve existing rows. Ship app code that
tolerates both shapes before the diff, and code that requires the new shape
after it. Dropping a column is its own later diff, after nothing reads it.

There is no standing staging project. Do not create one unless the user asks.
Data-rewriting diffs (`not null` without a default, type changes, backfills)
are rehearsed on a throwaway restore of a production dump into the local
`pile_security_test` database, never by experimenting on the live project.
When a diff rewrites existing rows (a backfill, a column added nullable and
later set not null, a temporary default), commit that SQL in the same commit
as the schema change, as its own file. `schema.sql` and `rpc.sql` stay the
end state. Do not add a numbered migrations history for structural changes.

## Running scripts in this monorepo (bun workspaces)

`bun run <script>` resolves against the ROOT `package.json` no matter where
you are, never the nearest one. From a workspace subdirectory that means
"Script not found" or an accidental root-wide build, so reach for a package's
script with `bun --filter` instead. From the repo root `bun run <script>` is
the root script and is exactly right — that is how the full test run works:

```bash
# EVERYTHING — file-manager + backend + the client vitest suite. Root only:
# this is the root package.json script, which chains the three --filter runs
bun run test

# Bun's own runner: file-manager + backend ONLY. apps/client is excluded on
# purpose (bunfig.toml pathIgnorePatterns) because those tests need real
# Vitest — Bun's shim lacks waitFor/stubGlobal. A green run here is NOT
# "all tests pass"; it silently skips ~630 client tests
bun test

# per package, from any directory
bun --filter @pile-commander/file-manager test
bun --filter @pile-commander/backend test
bun --filter @pile-commander/client test
bun --filter @pile-commander/file-manager build   # tsc --noEmit typecheck
bun --filter @pile-commander/backend build        # tsc --noEmit typecheck

# client typecheck: vue-tsc exists only in the client's local .bin
cd apps/client && node_modules/.bin/vue-tsc --noEmit
```

Do NOT use `bunx`/`npx` for project tools (tsc, vue-tsc, vitest): it fetches
the latest version from the network, which may be incompatible with the
project's pinned dependencies. Use the locally installed binaries in
`<package>/node_modules/.bin/` instead.

## Updating Bun

Use when the user asks to bump Bun, `packageManager` is stale, or `bun
--version` does not match the pin. Do not pin Bun in GitHub Actions:
`oven-sh/setup-bun@v2` reads `packageManager` from the root `package.json`.

1. Install the **exact** target version (`curl -fsSL https://bun.com/install | bash -s "bun-vX.Y.Z"`). Do not use `bun upgrade` — it always installs latest. Confirm `bun --version`.
2. Set root `package.json` `packageManager` to `bun@x.y.z`.
3. Bump `@types/bun` to `^x.y.z` in `apps/backend` and `packages/file-manager`.
4. `bun install` so `bun.lock` picks up `@types/bun` / `bun-types`.
5. Set README Requirements to the same `x.y.z`.
6. Run `bun test` and the typechecks in the section above.

## Database (Supabase)

`packages/file-manager/src/schema.sql` and `rpc.sql` are the source of truth
(no migrations folder in the repo). The live project already has this schema;
a change goes there as the diff described in the production section above (Supabase
MCP `apply_migration` or the SQL editor) — otherwise the client gets 404 on
RPC calls. Re-applying either file whole fails on existing tables and can
destroy data. Before that diff, run `postgres.test.ts` locally (below). After
it, run `packages/file-manager/src/rls.test.sql` against the project:
it creates its own fixtures, checks grants/policies/RPCs for every role and
rolls back — every row must be `ok = true`. Use the runner (do not paste the
~100 KB script into MCP `execute_sql`):

```bash
bun --filter @pile-commander/file-manager test:rls:remote
```

It reads `packages/file-manager/.env` (git-ignored) and has two transports:

- **`SUPABASE_ACCESS_TOKEN`** (preferred when set): a personal access token
  (dashboard → Account → Access Tokens). Runs over HTTPS through the
  Management API — the same way the Supabase MCP talks to the project — so it
  works on networks that block outbound Postgres ports (the user's usual one
  does). The suite ends by raising an exception that carries the results,
  which forces the rollback. The project ref comes from `SUPABASE_PROJECT_REF`
  or is read from `SUPABASE_DB_URL`.
- **`SUPABASE_DB_URL`**: the Postgres connection string from dashboard →
  Connect → **Session pooler**. The direct `db.<ref>.supabase.co` host is
  IPv6-only (no A record) and this Mac has no IPv6 route; the transaction
  pooler on `:6543` breaks the suite's single session, and the runner refuses
  it.

It prints failures and `N/N ok`, exits 1 on any failure, and never commits.
If neither variable is set, ask the user to add one — do not fall back to
partial checks. Finish with `get_advisors` (security + performance); expected INFO
findings are listed in `SECURITY.md`, which also holds the invariants the
code relies on.

### The SQL suites locally (`postgres.test.ts`)

`packages/file-manager/src/postgres.test.ts` applies `schema.sql` + `rpc.sql`
to a throwaway PostgreSQL 17, runs `rls.test.sql` through it, and adds what a
single session cannot cover: the workspace tree lock under two concurrent
connections, and that an unrelated text save does not queue behind it. It
**skips itself** unless `TEST_DATABASE_URL` is set, so a green `bun test` says
nothing about it — run it explicitly after touching schema, RPCs or locking:

```bash
docker run -d --name pile-security-postgres -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=pile_security_test -p 127.0.0.1:56623:5432 postgres:17
```

```bash
cd packages/file-manager && TEST_DATABASE_URL="postgres://postgres@127.0.0.1:56623/pile_security_test" bun test src/postgres.test.ts
```

No Docker (daemon not running)? Postgres.app works too — a throwaway cluster
in a temp folder, not the app's own data. Its bundled version (18 at the time
of writing) runs the suite fine. `-k ''` turns off the Unix socket: a long
temp path exceeds the 103-byte socket path limit and the server refuses to
start:

```bash
PG=/Applications/Postgres.app/Contents/Versions/latest/bin
DATA=$(mktemp -d)/pgdata
$PG/initdb -D "$DATA" -U postgres -A trust
$PG/pg_ctl -D "$DATA" -o "-p 56623 -k '' -c listen_addresses=127.0.0.1" -l "$DATA.log" start
$PG/createdb -h 127.0.0.1 -p 56623 -U postgres pile_security_test
# … run the test command above …
$PG/pg_ctl -D "$DATA" stop && rm -rf "$DATA"
```

It **drops and recreates `public`, `private` and `auth`** on every run and
refuses any database not named `pile_security_test`. Never point it at the
Supabase project. pg_cron is not installed locally: the fixture stubs
`cron.schedule` into a table so the scheduled SQL can still be asserted.

When writing SQL:

- RLS policies: wrap `auth.uid()` as `(select auth.uid())`. Per-row tables
  use `private.readable_workspace_ids()` / `writable_workspace_ids()`.
- Index every foreign-key column.
- `unused_index` on a fresh project is expected; ignore it until there is
  traffic.

## Local folder sync (Auto-sync)

Two-way sync of desktop workspace folders with their cloud copies lives in
`apps/client/src/services/cloud/sync/` and `store/localSync.ts`; the link
and base snapshot are `<root>/.pile/sync.json` (v2; v1 is still read and
lifted). `LOCAL_SYNC.md` holds the rules, the safety guarantees, the limits,
the database changes and the manual check — read it before touching sync,
the board's sidecars or the blob upload RPCs.

## Landing search indexing

`apps/landing` ships closed to search engines. `NUXT_PUBLIC_ALLOW_INDEXING`
defaults to false, which sends `<meta name="robots" content="noindex, nofollow">`
and the `X-Robots-Tag: noindex, nofollow` header. Do not add a `robots.txt`
`Disallow`: crawlers must be able to fetch the page to see `noindex`.

When the user asks to allow indexing of the landing (open it to search engines):

1. Set `NUXT_PUBLIC_ALLOW_INDEXING=true` on the landing Vercel project
   (Production) and redeploy. Leave the code default `false` — a missing env
   var must keep the site closed.
2. Confirm the home page has no `robots` meta `noindex` and no
   `X-Robots-Tag: noindex` response header.
3. Tell the user to add the site in Google Search Console and request
   indexing of `/`.

## Demo pack (`/demo`)

The web demo, the desktop "Open demo workspace" and the landing's `.pile`
downloads all come from the local `piles/` folder (git-ignored). After
editing `piles/` (the demo-piles skill, or layout in the app) or
`packages/file-manager/src/demo-content.json` (the Sandbox folder) or the start page copy in `apps/client/scripts/export-demo-pack.ts`, publish:

```bash
bun run demo:publish          # save layout → rebuild → commit only the pack
bun run demo:publish --push   # … and push (main only): deploys the web demo
```

`bun run demo:pack` is the rebuild alone. It first runs the skill's
`pile_attrs.py save`, so layout edited in the app is never published stale.
It writes `apps/client/public/demo-pack/` and `apps/landing/public/demos/*.pile`
byte-for-byte deterministically (an unchanged `piles/` commits nothing), and it
refuses to publish any local path. The desktop app gets the new demo only with
its next release. See `DEMO_FROM_PILES.md`.
