# Security model and hardening log

Auth is JWT + RLS; this server only issues short-lived presigned URLs, creates
blob rows, re-keys forked blobs, runs GC and account deletion. The public
`VITE_BACKEND_URL` is not a secret.

```mermaid
flowchart LR
  client[Client] -->|Bearer JWT| backend[apps/backend]
  backend -->|user client + RLS| supabase[Postgres]
  backend -->|service role: upload tickets, re-key, GC, previews| supabase
  backend -->|presign PUT/GET, staging copy| b2[B2 bucket]
  client -->|direct PUT to staging / GET| b2
```

Schema: `packages/file-manager/src/schema.sql`, RPCs: `rpc.sql`. Regression
suite for grants/policies/RPCs: `packages/file-manager/src/rls.test.sql`
(runs in a transaction and rolls back; every row must be `ok = true`).

### Advisors

After every schema change, `get_advisors` (security + performance) should
show only these intentional INFOs. Anything else is a regression.

| lint | why it stays |
| --- | --- |
| `rls_enabled_no_policy` (`billing_events`, `blob_deletions`, `feedback`, `egress_daily`, `download_daily`, `egress_notices`, `entry_derivatives`, `moderation_mail`, `moderation_digest_state`) | service-role-only tables: RLS on, no client policies. Do not add anon/authenticated policies to "fix" the lint. |

---

## Invariants the code relies on

- **Deleted bytes are counted until they are really gone.** A purge takes
  bytes out of `entries` at once, but the objects wait in `blob_deletions`
  for the GC (`GC_MIN_AGE_HOURS`, about a day). Each queue row carries the
  owner and the size (`entries_queue_blob_deletion`,
  `workspaces_queue_blob_deletion` for a workspace deleted whole,
  `replace_blob_entry` for the bytes a new version replaced), and
  `private.owner_usage` adds them to `used_bytes` beyond one turnover of the
  plan's room (or 1 GiB if that is more): emptying the trash to make room
  works at once, a loop of upload → purge → upload (or fork → copy → purge)
  does not hold storage above about twice the quota. A row the GC could not
  clear in three days stops counting. Keys that were in nobody's quota
  (covers, previews, orphans) and a deleted account's blobs have no owner.
- **A client never holds write access to a referenced object.** Bun's
  `s3.presign` signs neither `content-length` nor arbitrary headers (`type` /
  `contentDisposition` become `response-*` GET overrides), and B2 offers no
  POST policy here — so its PUT URL can cap nothing, and it stays replayable
  until it expires. (For uploads the size is signed by our own code
  instead; see "Presigned PUT".) It is therefore only ever issued for a **staging** key,
  `uploads/<blob|hub_preview>/<workspace_id>/<uuid>[.ext]`, minted by the
  service-role-only `register_upload` together with a row in
  `private.upload_sessions` binding it to the uploader, the workspace and a
  TTL. `/finalize` copies staging to a **fresh key the client has never been
  able to write** and records only that copy, so replaying the PUT afterwards
  changes an object nothing references. Nothing is trusted about the source
  except its bytes: the `stat` is a preflight (size and ETag), and the copy
  runs inside the storage — S3 CopyObject, signed in `src/s3_copy.ts`, no
  bytes through the backend — only while staging still has that ETag
  (`x-amz-copy-source-if-match`; B2 honours it, checked live), so a PUT
  replayed in between fails the copy with 409. The copy's metadata is the
  server's (`REPLACE`), never the uploader's headers. The stored object is
  `stat`ed again, and the entry is written only if that size is within the
  limit and equals the measured one — the guard that holds even on a store
  that ignored the condition. Every attempt writes its own key, so
  concurrent or retried finalizes never collide. `POST /presign/upload` is 30/min per account, `/finalize` 60/min.
  `size_bytes` in the presign body remains a client claim used for the quota
  preflight only.
  Residual, accepted: the copy's Content-Type is `entries.mime`, a client
  claim, so a presigned GET can still serve an attacker-chosen Content-Type —
  from the B2 host, which is a different origin from the app, under a
  15-minute URL. The staging object keeps whatever the uploader sent, and is
  never served.
- **A finalize is idempotent and never deletes.** `prepare_upload` binds the
  ticket to the first request body it sees (a mismatched retry is
  `upload_conflict`, 409) and `complete_upload` writes the entry and the
  receipt in one transaction, so a repeat returns the original entry instead
  of a second one. Nothing on the failure path deletes an object: an RPC error
  can mean a committed transaction whose response was lost, and the old
  `delete on refused insert` could therefore reclaim a blob a live row already
  pointed at. Unused copies and consumed staging keys are left to reconcile.
- **A doomed finalize copies nothing, and a ticket is spent after 5 tries.**
  `prepare_upload` runs the real `create_blob_entry` / `replace_blob_entry`
  on a placeholder key and size 0 in a subtransaction it always rolls back,
  so whatever the insert would refuse (folder, id, name, `client_id`, entry
  cap) is refused before the copy. It answers `used_bytes` / `quota_bytes`
  and, for a replace, `replaced_bytes`, so the backend refuses a file whose
  growth would break the quota after its stat and before the copy (the
  database still decides under the billing lock). Right before the copy the
  backend calls `begin_upload_copy`, which bumps `upload_sessions.attempts`
  in its own transaction; past 5 copies without a result the ticket is
  `upload_expired`, and a finalize that stops earlier costs nothing. One
  finalize per ticket runs at a time in the process (`with_ticket_lock`):
  parallel ones would each copy to a key of their own. Without these, a
  failing `complete_upload` rolled back and left the ticket fresh: every
  retry was a new copy living ~49 h. `/blobs/copy-clones` runs one call per
  account at a time; every copy (that route and the GC re-key) takes its
  row in a process-wide in-flight set and re-reads it first, so nothing is
  copied twice. The re-key sweep skips trashed rows and workspaces. Forks are
  20 an hour per account, counted and recorded under one advisory lock.
- **Reconcile owns every abandoned object.** It runs **hourly** and treats a
  managed key with no row as an orphan once it is older than
  `max(RECONCILE_GRACE_HOURS, PRESIGN_PUT_TTL_SECONDS + 30 min)`
  (`orphan_grace_hours` in `src/gc.ts`) — an object cannot be written after its
  PUT URL expires, and that floor also covers a ticket's life, so past it the
  object is abandoned rather than in-flight. `uploads/` is a managed family in
  `is_managed_key` but deliberately **not** in `KEY_SOURCES`: no row ever
  references staging, so every staged object is reclaimed after the grace,
  finalized or not. End to end an object still lives for detection latency +
  that grace + `GC_MIN_AGE_HOURS`: with the defaults (hourly, 24, 24) about
  49 h. The grace dominates, so `RECONCILE_GRACE_HOURS` is the lever if that
  has to shrink — and lowering it is safe, because the
  `PRESIGN_PUT_TTL_SECONDS + 30 min` floor keeps it above the life of an
  upload URL no matter what it is set to. `GC_MIN_AGE_HOURS` is the deliberate
  recovery window for an accidental workspace or account delete and is a
  separate decision.
- **GC asks per key, never by counting rows.** `blob_references` is a
  service-role-only RPC returning one JSON object with an explicit boolean for
  every queued key. A plain `select … in (keys)` was wrong: PostgREST caps the
  response at `max_rows` (1000), so a single key with 1000 copies filled it and
  the one live reference to a different key fell off the end — and GC deleted a
  live blob. Any missing key, non-boolean answer or failed call keeps the whole
  batch. Raising `max_rows` would only move the threshold.
- **Blob rows are server-made.** Clients cannot mention `storage_key` or
  `size_bytes` at all (column-level INSERT/UPDATE grants on `entries`).
  `create_blob_entry` is service-role-only and checks the key prefix
  (`<workspace_id>/…`), the caller's write access, the owner quota and the row
  ceiling in one transaction — the same transaction that consumes the ticket.
- **Text rows are made by `create_text_file`** (entries + entry_contents in
  one transaction). Direct client INSERTs on `entries` are folders only.
- **One writer at a time reshapes a workspace tree.** A transaction is atomic
  but not serializable here: `rename_entry` / `move_entry` / `copy_entry` and
  friends read a subtree's paths, then rewrite descendants by cutting a prefix
  of the *old* length. Two of them interleaved produced paths like
  `/otherong/file.txt` — a real corruption, not a lost update. Every
  structural RPC now calls `private.lock_entry_workspace` **before its first
  read**, and a direct folder INSERT takes the same lock through the
  `entries_00_tree_lock` trigger (it sorts first, so it runs before
  `entries_derive_paths` observes the parent). `purge_expired_entries` gives
  the pg_cron sweep the same discipline. The lock is `for no key update` on
  `workspaces`, not `for update`: a plain text save takes a `key share` FK
  lock on the same row while holding the owner's billing lock, and the
  stronger mode would deadlock against it. Lock order is
  workspace → ticket/billing → entries, everywhere. Payload and xattr UPDATEs
  take no workspace lock at all, so notes keep saving while a folder is being
  renamed — `postgres.test.ts` asserts both halves with two connections.
- **No client hard delete.** `remove()` is `delete_entry` (soft); hard
  deletes happen only via `purge_entry`/`purge_trash`, pg_cron (30 days) and
  FK cascades. **Deleting for good is the owner's alone**: `purge_entry`,
  `purge_trash`, the hard half of `delete_moved_entry` and
  `sweep_pile_images` check `is_workspace_owner`. An editor's call is
  refused (the purges), ends in the trash (a move) or does nothing (the
  sweep), so whatever an editor removes the owner can restore for 30 days.
  The trash page offers "delete forever" only in the user's own folders. The GC executes queued blob deletions only after
  `GC_MIN_AGE_HOURS` (default 24) — the recovery window for an accidental
  workspace/account delete. Preview rows (`entry_derivatives`) are retired
  by `prune_entry_derivatives` in the daily reconcile once no entry
  references their blob — a sweep, because a fork's re-key drops the last
  reference with an UPDATE, not a DELETE; the row delete queues the object.
- **A trashed workspace is not a workspace.** `workspaces.deleted_at` hides the
  row from every ordinary check — `readable_workspace_ids`,
  `writable_workspace_ids`, `is_workspace_member` / `is_workspace_owner`,
  `workspaces_select` (including anon on `is_public`), and the RPCs that
  read `workspaces` directly (`fork_workspace`, upload, share, invites).
  The owner sees it only through `trash_workspace`, `restore_workspace`,
  `purge_workspace`, `list_trashed_workspaces`, and `workspace_state`
  (`trashed` for the owner or a member, `gone` for anyone else). Members
  and invites stay; the public link and Hub card do not. After 30 days
  `purge_expired_workspaces` deletes the row, and the entry cascade queues
  blobs as a hard delete does today. The client has no `DELETE` on
  `workspaces` (no policy, no grant): an unfinished copy and a root moved
  into another root leave through `trash_workspace` + `purge_workspace`,
  which takes the tree lock and hard-deletes only a trashed workspace of the
  caller. A stolen token still can do that in two calls; what is gone is the
  one-request delete that skipped the trash and the lock.
- **Trash is for writers.** Readers (anon on a public board, viewers) see
  live rows only; `GET /presign` refuses trashed rows. A 2-minute grace after
  `deleted_at` lets the soft-delete Realtime event reach readers. This covers
  `entries`, `entry_contents`, **and** `folder_strokes` / `folder_connections`:
  their SELECT policies scoped by workspace alone until 0001, so a plain
  PostgREST read returned the ink and edges of a trashed folder for the 30 days
  before the hard delete. All four now carry the same live-entry branch.
- **Nobody joins a board unasked.** No client INSERT on `workspace_members`
  or `workspace_invites`. `add_workspace_member` makes a pending invite
  (14-day token) for every address, registered or not, with the same answer
  either way, so it says nothing about who has an account. The invite turns
  into a membership only through `accept_workspace_invite`, from a session
  whose address is **confirmed** (`email_confirmed_at`): an unconfirmed
  signup may be anyone who typed the address. Signup converts nothing.
  `decline_workspace_invite` drops it, `leave_workspace` takes a member out,
  `list_my_invites` is the in-app list. `claim_workspace_invites()` is a
  no-op kept for older desktop builds. The owner may change `role` or remove
  a member or pending row directly. Invites come only from
  `POST /workspace/invite`: the backend checks the owner's JWT and calls the
  service-role `invite_workspace_member` with the owner's id, then sends the
  mail (Plunk), so every invite counted is a mail that went out — an
  owner-callable RPC let invites without mails spend someone else's mailbox
  budget. Expired invites are deleted 30 days later
  (`workspace-invites-prune`). The budget lives in SQL (`private.rate_events`,
  counted under advisory locks per owner and per mailbox), so a direct
  PostgREST call cannot skip it: 30 a day per owner (10 while the account is
  under a week old), the same mailbox on the same board 3 a day, one mailbox
  5 a day from everyone, 20 live pending per owner. A mailbox is the address
  without its +tag, and without dots at Gmail (`private.mailbox_of`). The
  count survives the account (`actor` is `on delete set null`). The backend
  adds 10 / hour / user and 30 / hour / IP.
- **A new account passes a CAPTCHA; signing in does not.** Supabase Auth's
  "Before User Created" hook calls `POST /auth/before-user-created`
  (Standard Webhooks, `SIGNUP_HOOK_SECRET`), which checks the sign-up form's
  Cloudflare Turnstile token (`TURNSTILE_SECRET_KEY`, single use) from the
  user metadata; the `on_auth_user_signup_captcha` trigger drops the token
  before the row is written. Auth's own CAPTCHA stays off: it would guard
  sign-in and password reset too and lock out the desktop window, which
  Turnstile does not vouch for; the desktop creates accounts in the browser.
  No Turnstile secret → every sign-up passes.
- **Mail that bounces or draws complaints stops its sender's invites.** Plunk
  workflows on `email.bounce` / `email.complaint` call `POST /mail/plunk-events`
  (`Authorization: Bearer PLUNK_WEBHOOK_SECRET`). Plunk's id of each invite
  mail is kept on its rate event (`note_invite_mail`), so `record_mail_event`
  finds the sender; a complaint in 30 days or 3 permanent bounces in a day
  (`private.invites_suspended`) refuses that account's invites, and the
  moderation address gets a mail. Deleting its `private.mail_events` rows
  lifts the stop.
- **An unconfirmed address is freed after a day.** Supabase Auth keeps an
  unconfirmed signup and only resends the mail when the address signs up
  again, keeping the first password. The `on_auth_user_confirmed` trigger
  empties `encrypted_password` when `email_confirmed_at` goes from null to
  set, so the password typed before the confirmation never survives it; the
  app then asks the confirmed session for a password
  (`password_prompt = 'confirm_signup'`, no "Not now"), and whoever closes
  the tab signs in through "Forgot password". The `unconfirmed-users-prune`
  cron deletes unconfirmed accounts after a day (never one that owns a
  workspace).
- **Blob sharing is by design within a workspace.** `copy_entry` clones point
  at the same immutable object; the GC keeps an object while any row
  references it. Only forks (foreign key prefix) are re-keyed — by
  `/blobs/copy-clones` right after the fork and, as the guarantee, by the GC
  tick (`list_foreign_blob_entries`). Both are idempotent.
- **The quota check locks only when something can grow.**
  `assert_owner_can_add` returns before touching `billing_accounts` when the
  delta is ≤ 0 and there is no file size to check — the shape
  `entry_contents_guard` uses on every text save. It used to take
  `FOR UPDATE` first, so every note save in every one of the owner's
  workspaces queued behind one row even when the text shrank. The growing path
  is unchanged: the lock is still held across `owner_usage` until the caller's
  insert commits, so concurrent uploads cannot overshoot.
- **Plans change only through the billing adapter.** Clients read their own
  `billing_accounts` row and never write it. A plan and all of its limits are
  written by `apply_billing_state` (service role only), from
  `private.plan_defaults` in the same transaction as the event's row in
  `billing_events` (`polar:` + the `webhook-id` header). The webhook
  (`src/billing/webhook.ts`) checks the Standard Webhooks signature, then reads
  the customer's subscriptions back from Polar and applies what it reads —
  never the event body — and a read older than the applied one is ignored, so
  repeated or reordered deliveries cannot roll a plan back. Checkout is
  created only by the backend, for the verified caller, with
  `external_customer_id` = the user id from the JWT and a product from the
  server's own mapping; the browser names neither. Account deletion deletes
  the Polar customer first (which ends its subscriptions) and stops if Polar
  cannot be reached. Lower limits never delete data: they only stop growth.
- **Metered and capped.** `billing_accounts`: `quota_bytes`, `max_file_bytes`,
  `max_hub_listings`, and the row fences `max_entries` / `max_strokes` /
  `max_connections` (trash included; null = unlimited; free seeds
  20000 / 20000 / 20000, pro is larger but finite). CHECKs cap `xattrs`
  (16 KB on entries and workspaces), names (255), stroke
  `points` (32 KiB), `position` (512 B), `color` (64), connection `props`
  (8 KiB) / `id` (2048) / `label` (500), `updated_by_client` (64), and
  telemetry mimes. Strokes and connections are also capped at 5000 per
  folder. Hub previews must pass `POST /hub-preview/finalize` (2 MB, recorded
  in `private.hub_preview_uploads`) before `set_hub_listing` accepts the key —
  and the key it records is the server-made copy that endpoint **returns**,
  never the `uploads/hub_preview/…` staging key the owner PUT to. The 2 MB cap
  is enforced twice: on the copied bytes (`min(HUB_PREVIEW_MAX_BYTES, 2 MB)`)
  and again in `record_hub_preview_upload`.
- **Hub post-moderation.** `report_hub_listing` is authenticated-only (not
  the owner; 20 reports / day). `private.hub_reports` is not in the Data
  API. Three reports from accounts older than 7 days auto-set
  `hub_publications.hidden_at`; RLS hides those rows from visitors while the
  owner still sees them, and `hub_preview_target` mirrors that — a hidden card
  stops serving its cover through `GET /hub-preview` to whoever saved the key,
  not only disappearing from the gallery. `/{username}/{slug}` stays up until an admin
  `make_private`. Owner mail and the weekly digest are drained by the
  backend (`src/moderation.ts`), not by Postgres.
- **A username is not something to squat or inherit.** Words that would
  pass for the product or its staff (`pile-commander`, `official`, `team`,
  `support`, `security`, `billing`, `moderator` and their neighbours) are
  reserved next to the app's own routes: one list in `reserved-slugs.ts`,
  `private.is_reserved_username` (the CHECK on `profiles.username`) and
  `apps/client/middleware.ts`, compared by `reserved-slugs.test.ts`. A
  username someone gave up — by changing it or deleting the account — is
  held in `private.released_usernames` for 90 days: only the account that
  released it can take it back, so links to `/<username>/<slug>` that are
  out in the world do not start opening another account's boards. To
  anyone else the name is simply taken (`unique_violation`).
- **Downloads are short capabilities.** `PRESIGN_GET_TTL_SECONDS` (900 s)
  vs `PRESIGN_PUT_TTL_SECONDS` (3600 s); `GET /presign?entry=<id>` returns
  `expires_in` and the client media cache refreshes expired URLs.
  **Those are defaults, not what a deployment necessarily runs.** Both fall
  back to the legacy single knob `PRESIGN_TTL_SECONDS`, so an environment that
  sets only that one — as the repo's own `.env` did — silently gives downloads
  the *upload* lifetime: a leaked URL then reads for an hour instead of
  fifteen minutes. `PRESIGN_TTL_SECONDS` predates the split and is why older
  environments carry it; it needs no removing, since the split knobs win
  wherever they are set. Set them explicitly and check the deployment, not the
  defaults. `PRESIGN_PUT_TTL_SECONDS` also raises the orphan window
  above (`orphan_grace_hours`), so the two are not independent.
- **Public egress is metered** (`src/egress.ts`). `GET /presign` and
  `GET /hub-preview` resolve their target through `download_target` /
  `hub_preview_target` under the caller's JWT, so access equals reading the
  row. Owners and members are never metered; anon, signed-in strangers and
  Hub visitors are charged to the owner of the ENTRY — not of the key
  prefix, which forks keep until re-keyed. Counting is at sign time, so it
  is approximate (a Range request counts the whole file, a URL can be
  fetched again for as long as its GET TTL lasts — see the presign
  invariant above, which is longer than 15 min when only the legacy knob is
  set), and in memory: flushed once a minute through
  the service-role-only `egress_sync` into `egress_daily`, so a restart
  loses at most that minute (SIGTERM flushes) and N instances overshoot by
  N flushes. Limits are `billing_accounts.egress_bytes_month` and
  `max_public_file_bytes`; thresholds are fractions of the budget (ops
  alert at ¼ per day and at the budget per month — or its first refusal,
  since a refused download is not charged — once each via `egress_notices`;
  per-visitor share 1/20 per day per IPv4 or IPv6 /64). A state reload
  leaves a flush in flight out, so the meter undercounts for a moment
  rather than refusing visitors on a double count.
  `EGRESS_ENFORCE` = `off` (count + alert) | `file_size` (the default) |
  `all`; a refusal is `media_unavailable` + `reason` (403, 429 for the
  visitor share). The author is told what `file_size` means for them: the
  publish panel says which size visitors can open
  (`billing_accounts.max_public_file_bytes`). In `all`, when an owner's
  budget starts refusing visitors, the owner gets one mail that month
  (`egress_paused_email_copy`, with the `alert_month` notice): they are
  never refused themselves, so nothing else would tell them. An
  `<img>` has no token, so Hub covers are metered for everyone, the owner's
  own views included (≤2 MiB). Database down → downloads stay open.
  Download as .pile runs the same meter on its own ledger
  (`create_download_meter`: `download_daily`, `download_sync`,
  `billing_accounts.download_bytes_month`) and charges the account that
  downloads, never the board's owner: no per-visitor share (the account is
  the visitor), no size gate, no owner mail. A refusal (`all` only) is
  `media_unavailable` + `download_budget` (403).
- **Previews go to non-members only** (`src/derivatives.ts`,
  `choose_download` in `src/blobs.ts`). Owner, editor and invited viewer
  always get the original — the decision is `download_target.is_member`,
  server-side, never a client flag. With `DERIV_ENABLE=serve` a non-member
  of a public board gets the blob's ready preview (`thumb.webp` for images,
  `poster.jpg` for video), metered at the preview's own size without the
  `max_public_file_bytes` gate; with no preview the original goes through
  the meter exactly as before, gate included. `/presign` returns `variant`:
  the client renders a poster as an image, and refuses to copy a preview
  into another store as if it were the file. `generate` fills the table
  without changing what is signed. `GET /presign?entry=<id>&original=1` is
  Download as .pile: the original, never a preview, for a signed-in caller
  only (401 otherwise), and for a non-member only where
  `download_target.allow_download` — the board is public and its author
  allows forks and downloads (403 `download_not_allowed` otherwise). The flag
  keeps originals from being pulled past the previews in bulk; it hides
  nothing a visitor can already read (text, ink, edges, originals that have
  no preview).
- **Previews are server-made and outside the quota.** Keys
  `deriv/<workspace_id>/<blob_uuid>/…` derive from the original's key
  (same-workspace copies share one preview, a fork gets its own after
  re-key) and `record_derivative` re-derives and compares them, so a row
  cannot point at another blob's object. `entry_derivatives` is
  select-only for service_role; every write goes through
  `list_pending_derivatives` / `record_derivative` / `fail_derivative` /
  `prune_entry_derivatives`, revoked from anon and authenticated (the
  private functions too). `owner_usage` / `workspace_usage` sum
  `entries.size_bytes` only. Only public workspaces are processed. The
  object is written before its row; reconcile manages the `deriv/` prefix,
  and both GC key lists read preview keys, so an object whose row insert
  failed — queued as an orphan, then regenerated under the same key — is
  kept.
- **Preview generation is bounded.** One blob at a time. Images:
  `Bun.Image` with `backend = "bun"` (development decodes exactly what
  Linux does: JPEG, PNG, WebP), `DERIV_MAX_PIXELS` checked before a pixel
  buffer exists, `DERIV_MAX_SOURCE_BYTES` before the download. Video: ffmpeg
  reads a 2-minute presigned URL (not metered) with an input seek, so Range
  requests fetch the index and one GOP; `-protocol_whitelist https,tls,tcp`
  plus a demuxer whitelist keep a playlist or a concat script renamed to
  `.mp4` from fetching what it names; `Bun.spawn` runs it without a shell,
  with `timeout`, `maxBuffer` and SIGKILL, and the signed URL is redacted
  from errors. Codec errors are skipped at once; transient failures back
  off and dead-letter after `DERIV_MAX_ATTEMPTS`. ffmpeg missing at boot →
  posters stay off, the server still starts.
- **Account deletion needs a fresh sign-in.** The session's newest `amr`
  timestamp must be younger than `ACCOUNT_DELETE_MAX_AUTH_AGE_SECONDS`
  (10 min); the client re-enters the password in the confirm dialog.
- **A token is trusted until it expires, except where that would matter
  most.** `require_user` checks signature and expiry (JWKS, `getClaims`),
  not the session: after "sign out everywhere" a token someone carried off
  works on uploads and downloads for up to an hour, the same as it does on
  the Data API. Routes that cannot be taken back or that leave a way in
  behind them ask Auth for the session row first (`require_live_user`,
  `GET /auth/v1/user`): `POST /account/delete`, `POST /billing/checkout`,
  `POST /billing/portal`, `POST /workspace/invite`. A session that was
  signed out or replaced gets 401; when Auth cannot be reached they answer
  503 and do nothing.
- **Rate limits** (`src/ratelimit.ts`): global per-IP fence plus per-route
  buckets keyed by IP and by the JWT subject; 429 + `Retry-After`. Single
  Render instance — the counters are in-process. Request bodies are capped at
  256 KB. **The client address is the `x-forwarded-for` entry
  `TRUSTED_PROXY_HOPS` from the RIGHT** (default 1 = Render), never the first:
  the header grows left to right, so the leftmost entry is whatever the client
  sent. Reading it gave any client a fresh bucket for every IP fence and a
  fresh `visitor_key` for the egress share — i.e. no fence at all. A header
  shorter than the configured depth, or a hop that is not an address
  (`is_ip_like`), falls back to the socket, never to client text. The bucket
  keyed by the JWT subject is advisory by design (`unverified_subject` decodes
  without verifying): a forged `sub` only lands in a different bucket while
  the IP one still applies. The public form (`POST /feedback` in the app) is
  5 / hour / IP; it writes `feedback` under the service role (honeypot
  `website` returns `{ ok: true }`). Feedback
  screenshots never enter this process: the JSON body only claims mime/size
  (at most five images, 5 MB each), then the browser PUTs to a two-hour
  signed upload URL on the private Storage bucket `feedback`. Drop a note with
  `storage.from('feedback').remove(paths)` and then `DELETE` the row — a SQL
  delete of `storage.objects` orphans the file. Workspace
  invites (`POST /workspace/invite`) are 10 / hour / user and 30 / hour / IP.
  The periodic sweep of quiet keys judges each key by its own rule's window:
  judging by the window of whichever rule ran the sweep (the global minute
  fence) used to empty every hourly bucket after a minute of quiet.
  `POST /auth/send-email` pays no IP fence at all (`SIGNED_ROUTES`): Supabase
  Auth is its only caller, from shared addresses, and the webhook signature is
  its gate.
  The route takes no sign-in and its `Origin` check is a header a script
  can set, so one day is capped for everyone together: `FEEDBACK_DAILY_MAX`
  notes and `FEEDBACK_DAILY_ATTACHMENTS_MAX` screenshots (300 and 200), then
  429. Screenshots are accepted with a valid access token only; a note in
  words stays open to anyone. A daily job removes the screenshots of notes
  older than `FEEDBACK_ATTACHMENT_DAYS` (90) from Storage and keeps the
  note.
- **Shutdown drains.** On SIGTERM (a Render deploy) the server stops taking
  connections, waits for in-flight requests and a running GC/reconcile
  tick, kills a preview's ffmpeg in flight (the blob stays pending, no
  attempt is burned), flushes the egress meter and exits within 25 s —
  before Render's
  SIGKILL (30 s default shutdown delay). Without the handler Bun exits on
  the spot and cuts requests mid-flight.
- **Error texts are stable.** PostgREST/Auth messages are logged, not
  returned; plan-limit RPC errors keep their JSON `detail` for the client.
- **Client side.** `open_file` never opens HTML/SVG/XML as a same-origin
  `blob:` document (served as `text/plain`); SVG previews go through
  DOMPurify's SVG profile; `vercel.json` enforces `script-src` (the app's
  own scripts, `blob:` workers, WebAssembly and the Turnstile script; no
  inline script, no event-handler attribute, no `eval`), `object-src 'none'`,
  `base-uri 'self'`, `frame-ancestors 'self'` (except `/demo`, which also
  allows the landing origin from `VITE_LANDING_URL` so the marketing hero
  can embed the live demo; `middleware.ts` answers `/demo` itself and
  replaces the header, so it repeats the same `script-src`), HSTS (two years,
  `includeSubDomains`; the `preload` token is inert until the domain is
  submitted to hstspreload.org) and ships the rest of the CSP as Report-Only;
  see "Web CSP and a custom provider address". Both `v-html` sanitizers keep
  a regex fallback for the DOM-less test environment — `parseNoteMarkdown`
  returned marked's raw output there, which was no sanitizer at all.
- **A note cannot restyle or cover the app.** Note HTML lands in the app's own
  document, so `parseNoteMarkdown` uses its own DOMPurify instance with no
  `<style>`, no `<form>` and no `class` (the app's utility classes would
  apply), and `style` keeps only text styling: color, background color,
  alignment, weight, slant, decoration (`safeInlineStyle`) — no layout, no
  `url()`. The hook sits on that instance only: shape fills live in `style`.
  A DOMPurify that finds the DOM lacking returns its input untouched, so the
  renderer checks `isSupported` and otherwise takes the regex fallback, which
  applies the same rules. `markdown.dom.test.ts` runs the shipping path under
  jsdom.
- **Nothing edits sanitized markup as a string.** SVG shapes
  (`prepare_svg_for_preview`, `services/board/shapes.ts`) run DOMPurify last,
  on an instance of their own: the url and style rules sit in its attribute
  hook, and the widget fit (`width`, `height`, `preserveAspectRatio` on the
  root `svg`) is set on DOMPurify's own tree, which is then serialized once. A
  regex pass over DOMPurify's output was an XSS (fixed 2026-11-23): the
  event-handler pattern matched inside an attribute value, ate its closing
  quote and shifted the attribute boundaries, so the browser read an `onload`
  DOMPurify had never seen. `shapes.dom.test.ts` keeps that input. Without a
  DOM (node tests) the regex fallback runs alone; a window DOMPurify cannot
  use gets no shape markup. A shape's own `<style>` is kept: imported SVGs
  color themselves with it and `apply_shape_color` edits it. It can still
  restyle the app, which isolating the shape (not removing the block) has to
  fix.
- **User text never lands unescaped in a mail subject.** Bodies go through
  `escape_html`; subjects go through `subject_text` (`src/mail.ts`), which
  strips control characters, collapses whitespace and clamps to 120 chars.
  `workspaces.name` and `profiles.display_name` are length-capped only — they
  have no control-character CHECK like `entries.name` — so a board name could
  otherwise carry a newline into a header line.

---

## Desktop window

The desktop app is one webview that shows other people's notes, shapes and
boards, and it can reach the file system. One sanitizer bug (the SVG shape
XSS was one) would let a script run in that window, so the window itself is
fenced. A page from another address cannot call the app's commands at all:
Tauri checks the origin.

- **The window runs only the app's own scripts.** `tauri.conf.json` sets
  `app.security.csp`: `script-src 'self' 'wasm-unsafe-eval' blob:` (the
  model decoders need WebAssembly and `blob:` workers), no inline script,
  no event-handler attribute, `object-src 'none'`, `base-uri 'self'`.
  `style-src` keeps `'unsafe-inline'`, and
  `dangerousDisableAssetCspModification: ["style-src"]` stops Tauri from
  adding a nonce there, which would switch `'unsafe-inline'` off. `tauri dev`
  loads the page from Vite and gets no policy.
- **It connects only to this build's hosts.** `desktopCspPlugin.ts` adds a
  second policy to `index.html` of a desktop build: `connect-src` with the
  Supabase and backend origins from the build's own environment, the
  storage host, the changelog host and the model decoder host, plus `ipc:`
  and `http://ipc.localhost`, which are how the window calls Rust. The hosts
  are not written into the repository, and the policy cannot drift from the
  bundle. `img-src` and `media-src` still allow any `https:` host, so a
  picture address remains a way to send a few bytes out.
- **It reads the home folder and writes less of it.** plugin-fs reads
  `$HOME`. Its six write commands (`capabilities/home-writes-*.json`,
  generated by `scripts/write-home-writes-capabilities.ts`) are denied
  `~/Library` (macOS), `AppData` and the PowerShell profile folders
  (Windows), and every dot entry at the top of home except `.pile`: shell
  profiles, `.ssh`, `.config`, LaunchAgents. A script must not be able to
  plant something that runs at the next login. The person sees "Pile
  Commander only reads this folder." Deeper dot folders (`project/.git`)
  stay writable: the file manager and sync work there. Known limits: a deny
  is a glob on the path as written, so a symlink that already exists in
  home and points into a protected folder is not caught for a new file;
  nothing in the app creates symlinks.
- **The app's own commands ask the same rule.** They run as the app, outside
  the plugin's scope, so each one checks its paths in
  `src-tauri/src/paths.rs`: readable means inside the fs scope (home, or a
  path the person picked in a system dialog, dropped on the window or
  opened with the app); writable means readable and not protected. A
  folder outside home that was dropped or opened is remembered in
  `granted-folders.json` in the app's config directory, which the window
  cannot write, and returns to the scope at the next launch.
  `trash_path`, `restore_trashed` (the ticket must be inside a Trash, or the
  rename would move any file anywhere), `export_workspace_zip`,
  `import_workspace_zip`, `pile_zip_*`, `ensure_directory`, `path_kind`.
  The xattrs plugin takes a guard from the app and reads and writes only
  readable paths; an attribute name with `:`, a separator or
  `Zone.Identifier` is refused, because on Windows an attribute is the
  stream `path:name` and `:$DATA` is the file's content.
- **The window never leaves the app.** `navigation_guard` (`lib.rs`) lets
  the webview load only the app's own pages (`tauri://localhost`,
  `tauri.localhost` on Windows, the dev server under `tauri dev`); any other
  navigation is refused, whatever started it. Before that the page itself
  sends link clicks to the system browser (`listen_external_links`): an HTML
  `<a>`, an image-map `<area>` and an SVG `<a>` with `href` or `xlink:href`,
  with or without `download`. A note has no `<map>`, `<area>` or `usemap`,
  and an `<a>` inside `<svg>` loses its address there and in SVG shapes, so
  nothing invisible covers a note or a shape with a link. The window has no
  address bar: a page from another site inside it could pass for the app.
- **A file that runs is opened only after a yes.** The window has no
  `opener:allow-open-path`. `open_path` (`launch.rs`) opens a file with its
  default app, and for a file the system would run, install or mount (by
  extension, or an executable file with no extension) it first asks in a
  system dialog, which the page cannot draw over or click.
- **Uploads go to this build's bucket.** `put_presigned_*` accepts the
  storage host only, and with `PILE_STORAGE_URLS` set at build time
  (release.yml) only a URL that starts with one of the listed prefixes, each
  ending with the bucket. Without it any bucket on the host passes.
- **A cloud folder is exported without a scratch copy.** `pile_zip_*` writes
  the archive entry by entry into `<name>.partial` and renames it over the
  target at the end, so the window needs no writable folder of its own (it
  used to unpack into `~/Library/Caches`) and a failed export leaves an
  older archive untouched.

What a script in the window can still do: read any file in home through
plugin-fs, change files outside the protected places, and use the signed-in
session. The policy above is what keeps a script out; these are the reasons
it matters.

---

## AI provider

The desktop app talks to a provider from Rust (`apps/client/src-tauri/src/ai.rs`).
The web app uses `fetch` from the page. Neither path is a backend route.
Results are ordinary renames and `.md` notes; nothing is written to the database.

- **The key does not come back to JS.** On desktop it is stored in the OS
  credential store (macOS Keychain, Windows Credential Manager, Linux Secret
  Service) under the service `app.pilecommander.ai`, with the account set to
  the provider origin. The commands are set, delete and "is a key stored";
  none of them returns the key. Rust attaches `Authorization` itself. On the
  web the key is in `sessionStorage` for that tab only, under the same origin,
  and is dropped when the tab closes. It is not written to `localStorage`.
  If the system has no password storage, or the user refuses the prompt, the
  key is not stored and there is no fallback to a file. The sentences are
  "Couldn't use the key: this system has no password storage available." and
  "Pile Commander wasn't allowed to use the password storage." Confirm both
  on a Linux machine before release; the wording is unit-tested, a real
  Secret Service is not.
- **A key is sent only over https, or to this computer.** Plain http is
  accepted for loopback (`localhost`, `127.0.0.1`, `::1`) and for a private
  address (`10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `100.64/10`,
  IPv6 unique-local and link-local, `*.local`). The key is stored and
  attached for https and for loopback http only. Plain http to another
  machine on the local network is allowed, and the key is neither saved nor
  sent. A public host over http is rejected. A bare name (`homeserver`) and
  MagicDNS are not treated as the local network, because the address cannot
  be told from the text.
- **Nothing is sent to a cloud provider without a yes.** The first request
  to an origin asks to send file names and note text. A request that actually
  carries images asks separately. A shared cloud workspace asks once, for
  that workspace, before another member's files can go out. This computer
  and the local network do not ask. The demo and a viewer have no AI actions.
- **Other script in the window cannot read the desktop key, and can still
  spend it.** On desktop the key never enters JS, so a script cannot read it.
  On the web it sits in `sessionStorage`, so script in the app origin can.
  Either way, script that runs in the window can call the same chat path and
  spend credits. There is no further confirmation after the consent above.
- **A model answer is untrusted.** Before it is shown or saved, every `<` is
  escaped, so a tag is text: a `video` poster, a `picture` source, a CSS
  `url()`, an unclosed tag. Markdown images are reduced to their alt text.
  Links are left, and load only on a click.
- **A request leaves only for a provider the app names or an address the
  person allowed.** The desktop commands that send (`ai_list_models`,
  `ai_chat_stream`) pass the six preset origins. Any other origin waits for
  a yes in a system dialog, once; the answer is kept in `ai-addresses.json`
  in the app's config directory, which the window cannot write. A script in
  the window cannot answer that dialog, so it cannot use these commands to
  post the person's files to a host of its own. See "Desktop window".
- **A local rename or move does not replace another file whose name matches
  ignoring case and Unicode composition.** `Beach.jpg` is the same name as
  `beach.jpg`, and one NFC `й` is the same as the NFD form. The check runs
  in the desktop file manager before `rename`. A rename, and a move whose
  target folder is the source folder, may change only the case of the file's
  own name. A move into another folder has no such exception: a file already
  there with that name is a different file.

### Web CSP and a custom provider address

`apps/client/vercel.json` sends two policies. The enforcing
`Content-Security-Policy` is `script-src`, `object-src`, `base-uri` and
`frame-ancestors`. It does not set `connect-src`, so a fetch to a provider
is not blocked. The full policy, including `connect-src`, is
`Content-Security-Policy-Report-Only`. `https://api.openai.com`,
`https://openrouter.ai` and `https://api.fireworks.ai` are in that
`connect-src`. Its storage host is exact; the Supabase and backend hosts
stay `*.supabase.co` and `*.onrender.com`, because the project's hosts are
kept out of the repository and a Report-Only policy restricts nothing.

A provider address the user types is not in the list. While `connect-src`
stays Report-Only, the browser still connects and may file a report. If
`connect-src` is ever enforced, that custom origin is blocked on the web.
It is left out on purpose: opening `connect-src` to every `https` host would
drop the restriction for the whole app. That is why `connect-src` is not
enforced on the web. Custom addresses keep working in the desktop app,
where the request is sent from Rust and the page policy does not apply to
it. Plain http to a private address such as
`192.168.x.x` is blocked as mixed content from the https page.
`http://localhost` and `127.0.0.1` are not: Chrome and Firefox allow them,
and only Safari blocks them. Local providers are still unavailable on the
web, because the Ollama and LM Studio presets are turned off there, and
without `OLLAMA_ORIGINS` the request fails CORS. Turning that on is not
part of this stage.

---

## Watching it run

Nothing reads the Render log until something is already wrong, so the
backend mails the operator itself (`apps/backend/src/ops.ts`), every ten
minutes, one mail per cause in 24 hours, to `OPS_ALERT_EMAIL` (or
`MODERATION_DIGEST_EMAIL`):

- five or more requests answered 500, or unhandled rejections, in ten
  minutes, with the first of them;
- deletions the GC gave up on (dead letters), and a queue whose oldest row
  has waited a day longer than `GC_MIN_AGE_HOURS`;
- the database past `OPS_DATABASE_ALERT_BYTES` (6 GiB of Supabase Pro's 8)
  and the stored files past `OPS_STORAGE_ALERT_BYTES`;
- a complaint, or five bounces, in the last day (`private.mail_events`).

The numbers come from `ops_snapshot` (service role only: counts and sizes).
Egress has its own alerts (`EGRESS_ALERT_EMAIL`), Plunk complaints stop the
account's invites (`mail_events.ts`).

What the backend cannot report is that it is down. `GET /health` answers 200
while the database answers and 503 when it does not, for a monitor outside:
point one at `<backend>/health` and one at the web app. Still panels, not
code: Render's bandwidth and deploy notifications, Supabase's own disk
alerts, the B2 caps and their 75 % mail. Errors in the client are not
collected anywhere yet.

---

## Known and deliberately not closed

### Postgres jsonb is outside the byte quota

`billing_accounts.quota_bytes` still counts `entries.size_bytes` only
(files and text). Folders, ink and edges are not in that 100 MB
on purpose — drawing must not fill the storage bar. They are bounded
separately, as abuse fences rather than advertised plan limits:

- `max_entries` (free 20000, pro 200000) covers every entries row of the
  owner's workspaces, trash included. `create_workspace` takes the same
  gate as a folder insert.
- `max_strokes` / `max_connections` (free 20000 / 20000) plus 5000 strokes
  or edges per folder. Owner-wide counts run in
  security-definer asserts so an editor cannot under-count via RLS, and
  take an advisory lock per owner (not `billing_accounts FOR UPDATE`) so a
  text save does not queue behind a stroke.
- Per-payload CHECKs: stroke `points` 32 KiB, `position` 512 B, `color`
  64; connection `props` 8 KiB, `id` 2048, `label` 500; `updated_by_client`
  64; `quota_wall_events.file_mime` / `bridge_events.largest_file_mime`
  255; `bytes_by_kind` 4 KiB.

Worst case one free account is still about 1 GB of jsonb (20k × 16 KB
`xattrs` + 20k × 32 KiB points). That is the cost of no PostgREST rate
limit, not an unbounded table. The other client-written tables are bounded
too: workspaces only through `create_workspace` / `fork_workspace` (no
INSERT grant; 1000 per account, forks 20 an hour), and row caps per account
on `quota_wall_events` (2000, 200 a day; `answer` 2000 chars, the only
column a later write may change), `bridge_events` (20000, 1000 a day) and
`sync_devices` (1000) by the `owner_rows_cap` trigger. Strokes and edges
cannot be moved by UPDATE to another workspace, nor into a folder already
holding 5000 (the count runs under an advisory lock per folder, so two
writers cannot both take the last place) (an upsert needs UPDATE on every column, so grants cannot stop
it; the guard triggers do).

### Presigned PUT

See the invariants above: a PUT URL is issued for a staging key only and
`/finalize` copies it, inside the storage, to a key the client cannot write.

What a ticket may put into staging is bounded in three places:

- **The size is signed into the URL** (`s3_presign.ts`: AWS Signature V4
  with `content-length` as a signed header). The storage refuses a body of
  any other size, so a ticket brings exactly the bytes its quota check saw.
  B2 enforces it: `bun --filter @pile-commander/backend check:signed-length`
  passed on 2026-11-24 (a longer and a shorter body got 403, the exact size
  200). The browser and the desktop app both send the length of the blob
  whose size they declared. `PRESIGN_PUT_SIGN_LENGTH=off` is the switch
  back: a ticket then accepts any size and only `/finalize` learns the real
  one. Run the check again before moving to another storage.
- **`register_upload` bounds one uploader's tickets** by the plan of the
  workspace's owner: open tickets hold at most `quota_bytes` together, a
  day's tickets at most three times that or 5 GiB, and a day has at most
  `max_entries` tickets. Past them `/presign/upload` answers 429.
- **Staging does not keep what was never finalized**: the reconcile removes
  it after its grace, and the bucket's lifecycle rule for `uploads/` (hide
  after a day, delete a day later) does so even if the worker is down.

Before these, one account could request 43 200 tickets a day and put any
number of bytes through each, which the B2 spending cap would have turned
into "nobody can upload". No file crosses Render any more,
so a 1 GB upload costs the backend one CopyObject request — which B2 takes
about a minute to answer for that size (~50 ms per MB, measured). `/finalize`
has a 240 s request timeout (`index.ts`, under Bun's 255 s ceiling; the
copy's own is 230 s) and a process-wide limit of eight concurrent copies
(`with_copy_slot`, 32 queued, then 429), which now only bounds the requests
to the storage.

---

## Still open (not launch-blocking)

Leftover from the cloud security review (plan §2, plus §1 items that were
deferred). Done work is in the invariants above.

### Schema and RPC

- `remove_xattr` is still a client read-modify-write on `entries.xattrs`
  (`set_xattr` merges server-side through `merge_entry_xattrs`); an RPC with
  `-` would close that race too.
- `list_workspace_members` shows member emails to every member; email should
  be owner-only, everyone else username / display_name.
- Enforcing the rest of the web CSP. `script-src` is enforced; `connect-src`,
  `img-src` and the others are still Report-Only in `vercel.json`.
  `connect-src` cannot be enforced while a person may type any AI address in
  the browser; see "Web CSP and a custom provider address". `img-src https:`
  stays until external pictures in notes go through a proxy or load on a
  click.
- `hub_publications.fork_count` counts every fork, not unique forkers, and
  is not rate-limited.
- `private.*` grants: the backend-only ones are revoked from
  `public, anon, authenticated` (0001) and `rls.test.sql` asserts the shape,
  because `drop function` + `create` resets EXECUTE to PUBLIC and several
  functions in `rpc.sql` are recreated that way. That assertion immediately
  found `public.add_workspace_member`, granted to `authenticated` but never
  revoked from PUBLIC — fixed.
- **20 `public.*` wrappers still carry the default PUBLIC EXECUTE** (`proacl is
  null`), so anon can call them over `/rest/v1/rpc/…`: `copy_entry`,
  `create_text_file`, `create_workspace`, `delete_entry`, `fork_workspace`,
  `get_or_create_system_workspace`, `list_trash`, `list_workspace_members`,
  `move_entry`, `purge_entry`, `purge_trash`, `remove_from_hub`,
  `rename_entry`, `restore_entry`, `set_hub_listing`, `set_workspace_private`,
  `set_workspace_public`, `set_workspace_xattr` — plus `folder_read` and
  `workspace_usage`, which anon genuinely needs for public boards. None is
  exploitable: each raises on a null `auth.uid()` or fails
  `can_write_workspace`. But they are unauthenticated endpoints that do real
  work before refusing, which is an abuse surface the rate limiter alone
  covers. Closing it means revoking anon from the 18 and tracing each
  public-board path first — `workspace_usage` in particular is reachable for a
  public board and needs checking before it is touched. Verified against
  production 2026-09-16.

### Performance and backend

- Egress: `client_ip` now reads the proxy-appended hop (`TRUSTED_PROXY_HOPS`,
  default 1) instead of the first, so a forged header no longer dodges the
  per-visitor share. Confirm the hop count against Render in production —
  the header shape is the one assumption left. `EGRESS_ENFORCE=all` mails
  the owner when their budget pauses media; it needs the Plunk env, and an
  earlier warning (say at 80 %) would need one more kind in `egress_notices`.
- Download as .pile: the allowance is per account, so several accounts from
  one address multiply it. Add an IP share on that ledger if it is abused.
- `owner_usage` is a full sum on every text save / upload; a maintained
  `billing_accounts.used_bytes` counter would make it O(1).
- Reuse one PostgREST client with a per-request `Authorization` instead of
  `createClient` each time. JWT verification is already `auth.getClaims`
  (JWKS), matching PostgREST.
- Previews: the ffmpeg poster path (whitelists, `-map 0:v:0`, mjpeg to
  stdout) is covered by unit tests with a fake spawn only — there was no
  ffmpeg to run it against. Before `DERIV_VIDEO=on`, generate posters on
  Render for a real mp4, mov and webm, and confirm in B2 that a large
  master is read by range, not whole.
- Previews: `list_pending_derivatives` groups every public blob on each
  call (once a minute); a cursor or a pending flag once public boards grow.
  Next steps from the spec: a 720p proxy, and a Cloudflare Worker in front
  of `deriv/` with a short HMAC token so the edge caches a preview once
  instead of one presign per viewer (`pricing/stage 1/1/egress.md`).

### Realtime

- **DELETE is the exception to "Realtime shows only what REST would".**
  `realtime.apply_rls` runs the RLS check per event per subscriber
  (public-board anons included) for INSERT and UPDATE — but for DELETE it
  skips it outright (`if not is_rls_enabled or action = 'DELETE'`) and instead
  trims the payload to the row's **primary key**. So whatever is in the PK of a
  published table is readable by anyone who subscribes, in any workspace. That
  is why `folder_connections` has an opaque `record_id` PK: its client-minted
  `id` is `from:handle-to:handle` over real paths, e.g.
  `/clients/secret-contract.pdf:default-/finance/budget.xlsx:default`, and it
  used to be half of a `(workspace_id, id)` PK.
- **A published table's replica identity must contain `workspace_id`.** The
  same function matches a subscriber's `workspace_id=eq.<id>` filter against
  the identity columns alone (`old_columns`, from the WAL `identity`), and a
  filter naming a column that set lacks matches *nothing*. A bare-uuid PK as
  the identity therefore drops every DELETE on the floor, including for the
  workspace that owns the row. `folder_connections` and `folder_strokes` both
  run on `replica identity using index (workspace_id, <uuid>)` for that
  reason — wide enough to be delivered, narrow enough to carry no path.
  `rls.test.sql` asserts both column sets.
- The `folder_strokes` / `folder_connections` SELECT policies also carry a
  live-entry `exists` branch, so each INSERT/UPDATE event is one more index
  lookup on a published table. At scale move to Broadcast from Database
  (`realtime.broadcast_changes` in a trigger + a private channel per workspace
  with RLS on `realtime.messages`), which also lets DELETE events carry a path
  and is the only way to authorize them at all.
- `entry_derivatives` (previews) is deliberately not in the publication: a
  preview decision changes nothing a watcher shows until its next presign,
  and the worker writes a row per blob.
- Owner, editor and invited viewer hold channels (viewers deliberately). A
  public-link visitor without membership reads the board once and holds
  none: `open_workspace_store` → `createWorkspaceStore(…, { live: false })`.
- The visitor gate is client-side only. RLS still lets anon SELECT a public
  workspace, and Postgres Changes authorizes by those SELECT policies, so a
  modified client can subscribe anyway. Nothing leaks (the same rows are
  readable over REST), but it is no server-side stop on Realtime usage. If
  one is ever needed: make the channels private (`config: { private: true }`),
  turn off "Allow public access" in Realtime Settings, and add a SELECT
  policy on `realtime.messages` that admits `realtime.topic()` only for
  members — topics carry the workspace id
  (`file-manager-<kind>:<workspace_id>:…`), and
  `private.readable_workspace_ids()` includes public workspaces, so it
  needs a members-only twin. Not tried on the project yet.
- `watch()` currently ignores Realtime DELETE (RLS strips the old row to
  the PK). Handling DELETE by `id` (id→path map from the last listing) is
  still needed if clients must drop a node without a follow-up UPDATE.

### Infra, Auth, client

- B2 bucket lifecycle must be "keep only the last version" — otherwise S3
  `DeleteObject` only hides versions and storage keeps costing.
- Dashboard (manual): leaked-password protection on (Have I Been Pwned; Pro)
  and minimum password length 8. No required character classes. If Have I
  Been Pwned is unreachable, Auth allows the password. Confirm email +
  redirect allowlist, Send Email Hook → `POST /auth/send-email` (Plunk;
  enable the hook only after the Plunk env is set).
- Desktop release: set the repository secret `PILE_STORAGE_URLS` to the
  storage prefix that ends with the bucket
  (`https://s3.us-east-005.backblazeb2.com/<bucket>/`). Without it uploads
  are checked by host only. Before the storage moves, list the new prefix
  too and release the desktop first. See "Desktop window".
- Linux AI key, before release: save a key where Secret Service is running,
  and confirm the "no password storage" sentence where it is not.

### Tests

- Handler tests with a mock S3 (size cap, rate limit) and `uploads.test.ts`
  for the finalize contract: a retry returns the first receipt, a replayed
  PUT changes staging only, concurrent attempts write distinct keys, an
  uncertain commit is recovered instead of deleted, staging replaced after
  its `stat` is not copied, and a store ignoring the ETag condition is still
  held to the final object's size. `s3_copy.test.ts` signs AWS's published
  SigV4 examples and covers the copy's responses (412, 404, an error inside
  a 200). RLS/RPC coverage is
  `rls.test.sql`; backend unit tests cover the rate limiter, step-up, the Send
  Email hook (signature + Plunk payload, no network), `POST /workspace/invite`
  (owner JWT, pending vs member, Plunk, RPC mapping), the Polar adapter
  (`src/billing`: signature, repeated and reordered deliveries, the state read
  back from Polar, checkout bound to the verified account, portal, prices),
  `POST /feedback` (validation, honeypot,
  message length, attachment claims, signed upload tickets, delete helper), the egress meter (modes, budget, visitor
  share, flush, alerts, `visitor_key`) and its downloads ledger
  (`download_ledger`, `create_download_meter`), the preview worker (plan,
  error classes, object before row, tick budget, shutdown, poster retries, URL
  redaction, the streamed source limit), `choose_download`, the GC's managed
  key shapes and its per-key reference check.
- Anything needing two database sessions — the workspace tree lock, the
  `>1000 references` GC regression, ticket binding — lives in
  `packages/file-manager/src/postgres.test.ts`, which is **skipped unless
  `TEST_DATABASE_URL` is set** (see AGENTS.md). A green `bun test` alone does
  not mean those ran.
- Not covered by any suite: real Realtime delivery. The channel tests use a
  mock, so the DELETE payload shape and the server-side filter match are
  asserted in SQL (replica identity) and by reading `realtime.apply_rls`, not
  observed. Confirm connection and stroke deletes with two independent clients
  on staging before relying on them.

---

## Rollout checklist for a fresh environment

- [ ] Apply `schema.sql` + `rpc.sql` and run `rls.test.sql` — 0 failed. The
      suite asserts function grants too, so a `drop function` that reopens a
      backend-only path fails the run instead of waiting for a review to catch
      it. (AGENTS.md: the schema is applied directly, there is no migrations
      folder in the repo.)
- [ ] Supabase Auth → JWT keys: the project must be on **asymmetric** signing
      keys. `auth.getClaims` verifies locally by JWKS only when the token is
      not `HS*` and carries a `kid`; on the legacy shared secret it silently
      falls back to `getUser()`, which is a network hop per request AND the
      session-row lookup `require_user` exists to avoid. Check by fetching
      `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`: an `EC`/`RSA` key with an
      `alg` of `ES256`/`RS256` and no `"kty":"oct"` entry means the migration
      is done. (Production was verified on 2026-09-16: one ES256 P-256 key,
      no symmetric key — nothing to do.)
- [ ] `TRUSTED_PROXY_HOPS` matches the deployment (Render = 1, the default).
      Too low and every client shares one bucket; too high and the fences fall
      back to the socket address. Verify with a request carrying a forged
      `X-Forwarded-For` (see the tests in `src/ratelimit.test.ts`).
- [ ] Backend env: `SUPABASE_SERVICE_ROLE_KEY` set (without it `/finalize`,
  `/hub-preview/finalize`, `/blobs/copy-clones`, `/account/delete`,
  `/feedback`, `/billing/*` and the GC answer 503 / stay disabled, and public
  downloads go unmetered); `PRESIGN_GET_TTL_SECONDS` **and**
  `PRESIGN_PUT_TTL_SECONDS` set explicitly, not the legacy
  `PRESIGN_TTL_SECONDS` alone (it silently applies the upload lifetime to
  downloads); `GC_MIN_AGE_HOURS`,
  `HUB_PREVIEW_MAX_BYTES`, `ACCOUNT_DELETE_MAX_AUTH_AGE_SECONDS`.
- [ ] Egress env: `EGRESS_ENFORCE` (`file_size` when unset; do not leave
  `off` on Render; `all` once the visitor share and budget should refuse), optional
  `EGRESS_ALERT_EMAIL`; `EGRESS_ALERT_DAY_FRACTION` / `EGRESS_VISITOR_FRACTION`
  default to 0.25 / 0.05.
- [ ] Preview env: `DERIV_ENABLE` — `generate` first (watch row counts by
  `status`, the `deriv/` size in B2 and instance memory), `serve` only
  after the client that reads `variant` is deployed; `DERIV_VIDEO=on` only
  after the ffmpeg check above. Limits and defaults in `.env.example`.
- [ ] Mail env: `SEND_EMAIL_HOOK_SECRET`, `PLUNK_SECRET_KEY`,
  `PLUNK_FROM_EMAIL` (without them `POST /auth/send-email` returns 503),
  `PUBLIC_APP_URL` (invite links; without it or Plunk, pending
  `POST /workspace/invite` returns 503 — adding an existing member still works).
- [ ] B2 bucket private, lifecycle keeps only the last version.
- [ ] Supabase Auth: leaked-password protection on, minimum password length 8,
  no required character classes, Confirm email on, redirect allowlist,
  Send Email Hook pointing at `POST /auth/send-email` (after mail env).
- [ ] `get_advisors` (security + performance) matches the intentional INFOs
      in Advisors above.
