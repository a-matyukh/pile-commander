# Diffs applied to the live database

Each file here was applied once to the production Supabase project, as one
forward diff. This is a log, not a migration chain: nothing runs these files,
a fresh database is built from `../src/schema.sql` and `../src/rpc.sql`
alone, and a file that has been applied is neither edited nor applied again.
A correction is a new file. The rules are in `AGENTS.md`, "Project stage:
production".

A new diff goes here in the same commit as the change it belongs to, named
`<date written>-<what>.sql`, and gets a row below once it is applied.

| File | What | Applied |
|---|---|---|
| `2026-10-26-drop-desktops.sql` | Desktops removed (v2.2.2) | not recorded; committed 2026-10-26 |
| `2026-11-04-workspace-trash.sql` | A workspace goes to the trash before it is deleted | not recorded; committed 2026-11-04 |
| `2026-11-04-hub-tags-any-script.sql` | Hub tags in any script | not recorded; committed 2026-11-04 |
| `2026-11-24-cloud-blockers-1-5.sql` | Cloud plan, blockers 1–5 | 2026-11-24 |
| `2026-11-24-captcha-and-plunk.sql` | Sign-up CAPTCHA hook, Plunk bounce and complaint tracking | 2026-11-24 |
| `2026-11-24-cloud-p1.sql` | Cloud plan, П1 | 2026-11-24 |
| `2026-11-25-cloud-p2.sql` | Cloud plan, П2 | 2026-11-25 |
| `2026-11-25-cloud-p2-backfill.sql` | The row update of П2 on its own (it is also inside the file above) | 2026-11-25, as part of П2 |
| `2026-11-26-cloud-p3.sql` | Cloud plan, П3 | 2026-11-26 |

The four cloud-plan diffs and the CAPTCHA one were kept next to the plan in
the product repository until 2026-11-26 and are copied here byte for byte.
What each one closes, and how it was rehearsed and verified, is in that
plan's README.
