-- ============================================================================
-- Pile Commander — cloud schema (Supabase / Postgres)
-- ============================================================================
--
-- Architectural decisions captured in this schema:
--
-- 1. Identity: the FileManager interface exposes `id` = text path
--    (entries.path). The internal PK is a uuid; the path is a materialized
--    column. Renames/moves never touch the PK or blobs in storage.
--
-- 2. ltree: entries.node_path is a structural path made of UUIDs (hex without
--    dashes), NOT of file names: ltree labels allow only [A-Za-z0-9_], so
--    arbitrary file names cannot be used. ltree gives single-query subtree
--    operations (rename/move/copy/remove) and a GiST index for <@ / @>.
--
-- 3. Content: text files (by mime, including SVG) are stored in
--    entry_contents (a separate table, one row per text file) with an
--    8 MB limit. The limit is enforced by the entry_contents_guard
--    trigger in the DB — clients write content directly via PostgREST
--    (bypassing the backend), so the client-side MAX_TEXT_CONTENT_BYTES
--    in supabase.ts is only UX, not the real gate. Content lives outside
--    entries so realtime never broadcasts megabytes (see 6) and
--    folder_read does not pull payloads with the children list;
--    entry_contents_touch mirrors changes into entries (size_bytes,
--    content_modified_at) as a slim UPDATE. Media files live in
--    Backblaze B2, entries.storage_key = "<workspace_id>/<uuid>[.ext]"
--    (the uuid is minted per upload by the backend, not the entry id).
--    The key is bound to the uuid, so rename/move never touches blobs.
--    The media size limit is the owner's billing_accounts.max_file_bytes,
--    enforced on /presign + /finalize and in entry_contents_guard.
--    There is no separate env ceiling.
--    A file's payload is exactly one of: an entry_contents row (text)
--    or storage_key (blob) — cross-table, so the folder side is a CHECK
--    and the file side is enforced by entry_contents_guard. size_bytes
--    accounts for BOTH text and blobs (one honest quota): for text the
--    touch trigger computes octet_length, for blobs the backend's
--    /finalize creates the row through create_blob_entry (rpc.sql) with
--    the size it stat'ed in B2 — clients never write storage_key or
--    size_bytes (column-level INSERT/UPDATE grants).
--
-- 4. Sharing: whole workspaces only (workspace_members). No per-folder
--    sharing. Roles: 'editor' can write, 'viewer' is read-only; the owner
--    can always write. Enforcement lives in private.can_write_workspace —
--    every RPC and RLS policy goes through it. An email with no auth.users
--    row is a workspace_invites pending (not a member): handle_new_user
--    converts live rows after signup. Clients never INSERT either table.
--
-- 5. Visibility: a workspace starts private (owner + workspace_members).
--    set_workspace_public flips is_public and sets slug on THE SAME row —
--    no snapshot clone. URL: /<username>/<slug> (slug unique per owner;
--    reserved-slugs.ts protects usernames). Anons read the live workspace;
--    the owner and editors keep writing. set_workspace_private clears the
--    link (and delists Hub). Sharing by email works on private and public.
--
-- 6. Profiles + Hub + billing: every account gets a profiles row and a
--    billing_accounts row (plan = free) via handle_new_user. /<username>
--    shows Hub listings (not every public/unlisted board). hub_publications is
--    the gallery at /hub: tags + description + optional preview_key (B2
--    object hub/<workspace_id>/<uuid>.ext) per listed workspace (FK =
--    that workspace; requires is_public). Readable by anon unless hidden_at
--    is set (post-moderation: three qualified reports or a moderator).
--    Hidden listings leave /<username>/<slug> up; make_private clears the
--    slug. Delisting Hub leaves the public URL intact; the preview blob is
--    queued for GC. Free may list at most billing_accounts.max_hub_listings
--    boards (a hidden row still occupies a slot).
--    Owner quota is sum(entries.size_bytes) across all workspaces
--    including the system workspace (desktop board files) and trash.
--    Egress is separate fair use, not quota: egress_daily counts bytes the
--    backend presigned for non-members of the owner's public boards
--    (billing_accounts.egress_bytes_month / max_public_file_bytes), and
--    download_daily the originals an account took from other people's
--    public boards with Download as .pile (download_bytes_month): the
--    downloader pays for those, never the board's owner.
--
-- 7. Realtime: replica identity full so UPDATE events carry the old row
--    (rename = old.path <> new.path, trash = old.deleted_at is null) and
--    so the workspace_id filter applies to DELETE events too. Under RLS,
--    Realtime trims a DELETE's old record to the primary key (RLS cannot
--    be evaluated for a row that no longer exists), so hard deletes never
--    deliver a path — which is fine: rows are hard-deleted only from the
--    trash, i.e. after their soft-delete UPDATE already removed them from
--    every view. entries is added to the supabase_realtime publication.
--    The row is slim: content lives in entry_contents, which is NOT
--    published, so saving a large text file only broadcasts a small
--    UPDATE (entry_contents_touch mirrors size_bytes/content_modified_at
--    into entries; watchers refetch the payload on demand). A column
--    list is still impossible with replica identity full (PG
--    restriction), but no longer needed. Clients filter events by path
--    prefix and suppress their own echoes in-memory (per instance, NOT
--    via updated_by/updated_by_client). Folder ink lives in
--    folder_strokes (one row per stroke) and canvas edges in
--    folder_connections (one row per edge) — both tables ARE published:
--    per-row events are small and merge by id, which is the foundation
--    for collaborative drawing.
--
-- 8. Structural columns (name, parent_id, path, node_path, workspace_id)
--    are not writable by clients: table-level INSERT/UPDATE are revoked and
--    column-level grants cover only the editable fields (blob columns are
--    backend-only, see 3). Rename/move/copy/delete go exclusively through
--    RPCs (rpc.sql, security definer in the private schema, exposed via
--    thin security invoker wrappers in public).
--
-- 9. Trash (soft delete): remove does not delete rows, it sets deleted_at
--    on the whole subtree (foundation for undo-redo and trash). Live rows
--    have deleted_at is null; unique and working indexes are partial so
--    trashed entries neither block names nor bloat indexes. Clients have
--    no DELETE privilege on entries at all: hard deletes happen only via
--    purge_entry/purge_trash, pg_cron (rows older than 30 days, daily) and
--    FK cascades. Blob keys from any hard delete land in the blob_deletions
--    queue, which the backend GC worker drains after a grace period
--    (GC_MIN_AGE_HOURS) — a recovery window at the object level. Preview
--    objects (entry_derivatives, deriv/<workspace_id>/<blob_uuid>/…) take
--    the same queue once no entry references their blob.
--
-- 10. Desktops: cloud desktops sync meta+windows via the desktops table
--    (owner-only RLS). A desktop's board has two item kinds: folders are
--    real workspaces (workspaces.desktop_id, publishable/sharable as
--    usual), files are entries under /desktop-<id> in the owner's hidden
--    system workspace (workspaces.is_system, one per user). The desktop
--    itself is private — no publish/share paths exist for it.
--
-- This file and rpc.sql ARE the source of truth: the schema is applied to the
-- Supabase project directly and there is no migrations folder in the repo
-- (AGENTS.md). Applying a change through MCP apply_migration leaves an entry
-- in the project's own history (list_migrations) — mirror every such change
-- back into these files, or the next fresh apply loses it.
-- ============================================================================

-- ltree in the extensions schema (Supabase keeps extension objects out of the
-- exposed public schema); functions resolve it through search_path
create schema if not exists extensions;
create extension if not exists ltree with schema extensions;

create schema if not exists private;

-- ----------------------------------------------------------------------------
-- desktops: cloud-synced desktops (meta + windows). Children live elsewhere:
-- board folders are real workspaces (workspaces.desktop_id below), board
-- files are entries under /desktop-<id> in the owner's hidden system
-- workspace (workspaces.is_system). Desktops themselves are private:
-- no publish, no share
-- ----------------------------------------------------------------------------

create table public.desktops (
    id uuid primary key default gen_random_uuid(),
    -- defaulted so client inserts stay minimal; the RLS insert policy still
    -- requires owner_id = auth.uid()
    owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    name text not null check (char_length(name) <= 255),

    -- presentation (background/grid/snap) and the serialized AppWindow[]
    -- array — client-shaped payloads, opaque to the DB. Size-capped: these
    -- columns are outside the byte quota, so without a ceiling they are free
    -- storage (see private.plan_defaults for the metered limits)
    xattrs jsonb not null default '{}' check (pg_column_size(xattrs) <= 65536),
    windows jsonb not null default '[]' check (pg_column_size(windows) <= 1048576),

    position integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create or replace function public.desktops_touch()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
    NEW.updated_at := now();
    return NEW;
end
$$;

create trigger desktops_touch
    before update on public.desktops
    for each row execute function public.desktops_touch();

-- Row ceiling for client INSERTs (desktops are written directly via
-- PostgREST). assert_owner_desktops is security definer so the count is
-- not RLS-filtered
create or replace function public.desktops_count_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
    perform private.assert_owner_desktops(NEW.owner_id, 1);
    return NEW;
end
$$;

create trigger desktops_count_guard
    before insert on public.desktops
    for each row execute function public.desktops_count_guard();

-- desktop list per user and the owner FK cascade
create index desktops_owner_idx on public.desktops (owner_id);

-- ----------------------------------------------------------------------------
-- desktops_opt_ins: accounts that turned the desktops experiment on
-- (DESKTOPS_EXPERIMENT.md in the repo root). One row per account with the
-- first opt-in time; the switch going off never clears it. Written only by
-- mark_desktops_opt_in, read only by desktops_experiment_report (admins).
-- Private, not a profiles column: profiles rows with a username are public
-- (/<username> pages), and who tries an experiment is nobody else's business
-- ----------------------------------------------------------------------------
create table private.desktops_opt_ins (
    user_id uuid primary key references auth.users (id) on delete cascade,
    opted_in_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- workspaces
-- ----------------------------------------------------------------------------

create table public.workspaces (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users (id) on delete cascade,
    name text not null check (char_length(name) <= 255),

    -- a folder child of a cloud desktop's board (null = regular workspace).
    -- Shown in the workspace lists and publishable like any other workspace;
    -- deleting the desktop cascades here. A workspace pins to at most one
    -- desktop (cross-desktop links are a future aliases feature)
    desktop_id uuid references public.desktops (id) on delete cascade,

    -- presentation attrs of the workspace-as-board-tile (position/size/color),
    -- same flat names as entries.xattrs so the board renders both tile kinds
    -- with one code path. Readable by anon when the workspace is public —
    -- never put anything private here. Size-capped like entries.xattrs
    xattrs jsonb not null default '{}' check (pg_column_size(xattrs) <= 65536),

    -- the hidden system workspace holds desktop board FILES (/desktop-<id>/):
    -- one per user, created by get_or_create_system_workspace, filtered out
    -- of workspace lists; public/remove/share are forbidden for it
    is_system boolean not null default false,

    -- public link: set only via set_workspace_public (not client UPDATE).
    -- Slug is unique per owner: the URL is /<username>/<slug>, so two users
    -- may reuse a slug. Clearing them (set_workspace_private) drops the
    -- Hub listing (FK cascade on hub_publications.source_workspace_id).
    -- allow_fork ("Allow forks and downloads as .pile") gates fork_workspace
    -- and the originals a signed-in visitor downloads (download_target)
    slug text check (slug ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
    is_public boolean not null default false,
    published_at timestamptz,
    allow_fork boolean not null default true,

    created_at timestamptz not null default now()
);

-- the board query (workspaces where desktop_id = ...)
create index workspaces_desktop_idx on public.workspaces (desktop_id) where desktop_id is not null;
-- "my workspaces", owner_usage, readable/writable_workspace_ids, owner FK cascade
create index workspaces_owner_idx on public.workspaces (owner_id);

-- one system workspace per user; makes concurrent get_or_create_system_workspace safe
create unique index workspaces_system_unique on public.workspaces (owner_id) where is_system;

create unique index workspaces_slug_per_owner
    on public.workspaces (owner_id, slug)
    where slug is not null;

-- The owner may change only name and xattrs. is_public/slug/published_at/
-- allow_fork change only via set_workspace_public/private, is_system/
-- desktop_id only via the RPCs above (security definer bypasses this).
revoke update on public.workspaces from authenticated, anon;
grant update (name, xattrs) on public.workspaces to authenticated;

create table public.workspace_members (
    workspace_id uuid not null references public.workspaces (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    role text not null default 'editor' check (role in ('editor', 'viewer')),
    created_at timestamptz not null default now(),
    primary key (workspace_id, user_id)
);

-- "workspaces shared with me" and the user FK cascade (the PK leads with workspace_id)
create index workspace_members_user_idx on public.workspace_members (user_id);

-- Pending share: the invitee has no auth.users row yet, so they cannot be a
-- workspace_members row (FK + RLS). Owner-only; converted in handle_new_user.
-- Token is for the email link (/invite/<token>) and is not granted to clients.
create table public.workspace_invites (
    workspace_id uuid not null references public.workspaces (id) on delete cascade,
    email text not null check (
        email = lower(trim(email))
        and email <> ''
        and char_length(email) <= 254
    ),
    role text not null default 'editor' check (role in ('editor', 'viewer')),
    invited_by uuid not null references auth.users (id) on delete cascade,
    token text not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '14 days'),
    primary key (workspace_id, email),
    unique (token)
);

create index workspace_invites_email_idx on public.workspace_invites (email);
create index workspace_invites_invited_by_idx on public.workspace_invites (invited_by);

-- ----------------------------------------------------------------------------
-- profiles: public identity for /<username> pages and Hub cards. One row per
-- account, created by the signup trigger; username starts unset and is
-- required before making a workspace public (enforced in
-- set_workspace_public). The root URL segment is the username, so its
-- pattern matches the slug pattern (shorter)
-- ----------------------------------------------------------------------------
-- Mirror of RESERVED_SLUGS in packages/file-manager/src/reserved-slugs.ts:
-- words taken by the app's own top-level routes. The client validates too,
-- but a direct PostgREST update must not be able to claim /hub or /login as a
-- profile address. Keep both lists in sync
create or replace function private.is_reserved_username(p_username text)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
    select p_username = any (array[
        'app', 'demo', 'hub', 'invite', 'login', 'logout', 'signup', 'register', 'auth',
        'settings', 'dashboard', 'admin',
        'api', 'p', 'public', 'static', 'assets', 'cdn', 'internal', 'health',
        'about', 'features', 'blog', 'docs', 'help', 'support', 'pricing',
        'terms', 'privacy',
        'www', 'mail', 'ftp'
    ]);
$$;

create table public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    username text unique check (
        username ~ '^[a-z0-9][a-z0-9-]{2,39}$'
        and not private.is_reserved_username(username)
    ),
    display_name text check (char_length(display_name) <= 80),
    updated_at timestamptz not null default now()
);

-- Plan numbers live here so signup, backfill, and later paid rows do not
-- drift across backend/UI constants. Free is the only seed for beta.
-- max_entries / max_strokes / max_connections / max_desktops are abuse
-- fences, not the byte quota: folders, ink and edges cost nothing against
-- quota_bytes, so without them fork/copy loops and canvas jsonb could grow
-- the tables without limit (null = unlimited). Both free and pro seed
-- numbers — paid is larger, not unbounded in Postgres.
-- egress_bytes_month / max_public_file_bytes are the public-link fair use:
-- bytes presigned for non-members of the owner's boards per UTC month, and
-- the largest original a non-member gets signed (apps/backend/src/egress.ts)
-- download_bytes_month is the other side of it: originals this account may
-- take from other people's public boards per UTC month with Download as
-- .pile. A placeholder like the egress numbers until the grid sets it
drop function if exists private.plan_defaults(text);
create or replace function private.plan_defaults(p_plan text)
returns table (
    quota_bytes bigint,
    max_file_bytes bigint,
    max_hub_listings int,
    max_entries int,
    max_strokes int,
    max_connections int,
    max_desktops int,
    egress_bytes_month bigint,
    max_public_file_bytes bigint,
    download_bytes_month bigint
)
language plpgsql
stable
set search_path = public, extensions
as $$
begin
    if p_plan = 'free' then
        return query select
            (100 * 1024 * 1024)::bigint,
            (25 * 1024 * 1024)::bigint,
            3,
            20000,
            20000,
            20000,
            20,
            (20::bigint * 1024 * 1024 * 1024),
            (10 * 1024 * 1024)::bigint,
            (20::bigint * 1024 * 1024 * 1024);
        return;
    end if;
    -- Pro per the grid (pricing/stage 2/Тарифная сетка.md): 50 GB, originals
    -- up to 1 GB — every paid tier keeps 1 GB until guests are served
    -- previews only. No account is on it until the MoR adapter switches
    -- plans; the bridge preflight shows these numbers next to Free. Paid
    -- public-link fair use is not decided: Free's numbers until the grid sets it
    if p_plan = 'pro' then
        return query select
            (50::bigint * 1024 * 1024 * 1024),
            (1024 * 1024 * 1024)::bigint,
            null::int,
            200000,
            100000,
            100000,
            50,
            (20::bigint * 1024 * 1024 * 1024),
            (10 * 1024 * 1024)::bigint,
            (20::bigint * 1024 * 1024 * 1024);
        return;
    end if;
    raise exception 'plan_defaults: unknown plan %', p_plan;
end
$$;

-- ----------------------------------------------------------------------------
-- billing_accounts: one row per account. Source of truth for plan limits
-- (not JWT, not env). Clients may SELECT their own row; writes go through
-- security-definer (signup) or service_role (webhook later).
-- ----------------------------------------------------------------------------
create table public.billing_accounts (
    owner_id uuid primary key references auth.users (id) on delete cascade,
    plan text not null default 'free'
        check (plan in ('free', 'pro', 'studio', 'max', 'ultra')),
    plan_status text not null default 'active'
        check (plan_status in ('active', 'past_due', 'canceled', 'grace')),
    quota_bytes bigint not null check (quota_bytes > 0),
    max_file_bytes bigint not null check (max_file_bytes > 0),
    -- null = unlimited (paid plans). Free seeds 3.
    max_hub_listings int check (max_hub_listings is null or max_hub_listings >= 0),
    -- entries rows across all of the owner's workspaces, trash included
    -- (null = unlimited). Free seeds 20000, pro 200000 — abuse fences
    max_entries int check (max_entries is null or max_entries >= 0),
    -- canvas jsonb outside quota_bytes (null = unlimited). Free 20000 /
    -- 20000 / 20, pro 100000 / 100000 / 50
    max_strokes int check (max_strokes is null or max_strokes >= 0),
    max_connections int check (max_connections is null or max_connections >= 0),
    max_desktops int check (max_desktops is null or max_desktops >= 0),
    -- public-link fair use (null = unlimited): bytes presigned for
    -- non-members per UTC month, and the largest original they get signed
    egress_bytes_month bigint check (egress_bytes_month is null or egress_bytes_month > 0),
    max_public_file_bytes bigint check (max_public_file_bytes is null or max_public_file_bytes >= 0),
    -- Download as .pile (null = unlimited): originals this account may take
    -- from other people's public boards per UTC month, charged to the
    -- downloader so a popular board never spends its owner's egress
    download_bytes_month bigint check (download_bytes_month is null or download_bytes_month > 0),
    grace_until timestamptz,
    external_subscription_id text,
    updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- quota_wall_events: hit the storage/file/hub ceiling. Written even when
-- the user closes the form without an answer.
-- ----------------------------------------------------------------------------
create table public.quota_wall_events (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users (id) on delete cascade,
    kind text not null check (kind in ('quota', 'file_size', 'hub_limit')),
    used_bytes bigint,
    quota_bytes bigint,
    file_bytes bigint,
    file_mime text check (file_mime is null or char_length(file_mime) <= 255),
    needed_bytes bigint,
    answer text,
    created_at timestamptz not null default now()
);

create index quota_wall_events_owner_created_idx
    on public.quota_wall_events (owner_id, created_at desc);

-- ----------------------------------------------------------------------------
-- bridge_events: the local → cloud bridge funnel — opened → preflight → wall
-- → Pro → started → completed / failed / cancelled — with the size picture
-- of what people bring (total, largest file and its type, bytes per kind):
-- the answer to the 100 MB and file size questions without surveys. "Shared
-- within an hour" needs no event: join `completed` with workspace_members /
-- workspace_invites.created_at and workspaces.published_at. Insert-only for
-- the owner; a Pro answer is a row of its own.
-- ----------------------------------------------------------------------------
create table public.bridge_events (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users (id) on delete cascade,
    step text not null check (step in (
        'opened', 'preflight', 'wall_shown', 'pro_clicked', 'started',
        'resumed', 'completed', 'failed', 'cancelled'
    )),
    door text not null check (door in ('share', 'publish', 'device', 'list', 'tile', 'pile', 'sync')),
    source_type text not null check (source_type in ('local', 'browser')),
    workspace_id uuid references public.workspaces (id) on delete set null,
    total_bytes bigint,
    file_count int,
    largest_file_bytes bigint,
    largest_file_mime text check (largest_file_mime is null or char_length(largest_file_mime) <= 255),
    bytes_by_kind jsonb check (
        bytes_by_kind is null
        or (jsonb_typeof(bytes_by_kind) = 'object' and pg_column_size(bytes_by_kind) <= 4096)
    ),
    used_bytes bigint,
    quota_bytes bigint,
    max_file_bytes bigint,
    excluded_files int,
    answer text check (answer is null or char_length(answer) <= 2000),
    created_at timestamptz not null default now()
);

create index bridge_events_owner_created_idx
    on public.bridge_events (owner_id, created_at desc);
-- FK on delete set null: a removed workspace keeps its funnel rows
create index bridge_events_workspace_idx on public.bridge_events (workspace_id);

-- ----------------------------------------------------------------------------
-- billing_events: MoR webhook idempotency (event id from the provider).
-- No client access; the backend writes under service_role.
-- ----------------------------------------------------------------------------
create table public.billing_events (
    event_id text primary key,
    received_at timestamptz not null default now(),
    payload jsonb not null default '{}'
);

-- ----------------------------------------------------------------------------
-- plan_launch_subscribers: landing /pricing notify list. Service-role writes
-- only (POST /pricing/notify). Export for Plunk:
--   select email, subscribed, source from public.plan_launch_subscribers
--   order by created_at;
-- ----------------------------------------------------------------------------
create table public.plan_launch_subscribers (
    email text primary key
        check (char_length(email) <= 254 and email ~ '^[^@]+@[^@]+\.[^@]+$'),
    subscribed boolean not null default true,
    source text not null default 'pricing' check (char_length(source) <= 32),
    created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- feedback: landing /feedback form. Service-role writes only (POST /feedback).
-- Multiple rows per email are allowed. Message length matches the form cap.
-- Optional screenshots live in the private Storage bucket `feedback` at
-- `{id}/{uuid}.ext`. Drop a note through the Storage API (remove those
-- paths) THEN delete the row — a SQL delete of storage.objects orphans
-- the object and still bills for it.
-- ----------------------------------------------------------------------------
create table public.feedback (
    id uuid primary key default gen_random_uuid(),
    email text not null
        check (char_length(email) <= 254 and email ~ '^[^@]+@[^@]+\.[^@]+$'),
    category text not null
        check (category in ('bug', 'idea', 'other')),
    message text not null
        check (char_length(message) >= 1 and char_length(message) <= 4000),
    attachments jsonb not null default '[]'::jsonb
        check (
            jsonb_typeof(attachments) = 'array'
            and jsonb_array_length(attachments) <= 5
        ),
    created_at timestamptz not null default now()
);

-- Private screenshots for /feedback. Local postgres.test.ts has no storage
-- schema: skip the bucket there. No storage.objects policies for
-- anon/authenticated — signed upload URLs and the service role are the
-- only writers.
do $$
begin
    if to_regclass('storage.buckets') is null then
        return;
    end if;
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
        'feedback',
        'feedback',
        false,
        5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    )
    on conflict (id) do nothing;
end $$;

-- ----------------------------------------------------------------------------
-- egress_daily: bytes the backend presigned for non-members of the owner's
-- public boards (anon, signed-in strangers, Hub visitors), per UTC day; a
-- month is the sum of its days. Written only through egress_sync (rpc.sql)
-- under the service role — the backend batches increments in memory and
-- flushes once a minute, so the row is never hot per request.
-- ----------------------------------------------------------------------------
create table public.egress_daily (
    owner_id uuid not null references auth.users (id) on delete cascade,
    day date not null,
    bytes bigint not null default 0 check (bytes >= 0),
    primary key (owner_id, day)
);

-- ----------------------------------------------------------------------------
-- download_daily: originals the backend presigned for Download as .pile
-- (GET /presign?original=1 by a signed-in non-member), per downloading
-- account and UTC day. The other ledger of the egress meter: egress_daily
-- charges a board's owner for its visitors, this one the account that takes
-- the files. Written only through download_sync (rpc.sql) under the service
-- role
-- ----------------------------------------------------------------------------
create table public.download_daily (
    user_id uuid not null references auth.users (id) on delete cascade,
    day date not null,
    bytes bigint not null default 0 check (bytes >= 0),
    primary key (user_id, day)
);

-- ----------------------------------------------------------------------------
-- egress_notices: "send once" ledger for the egress alerts. A duplicate
-- insert (23505) means the alert already went out, which survives backend
-- restarts. period = the UTC day for alert_day, the first day of the UTC
-- month for alert_month. Service-role only.
-- ----------------------------------------------------------------------------
create table public.egress_notices (
    owner_id uuid not null references auth.users (id) on delete cascade,
    period date not null,
    kind text not null check (kind in ('alert_day', 'alert_month')),
    sent_at timestamptz not null default now(),
    primary key (owner_id, period, kind)
);

-- Live pending invites for this address become memberships. Expired rows
-- are only deleted so a later invite can reuse (workspace_id, email).
-- handle_new_user and public.claim_workspace_invites (sign-in) both call this.
create or replace function private.claim_workspace_invites(p_user uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_email text;
begin
    if p_user is null then
        return;
    end if;
    v_email := lower(btrim(coalesce(p_email, '')));
    if v_email = '' then
        return;
    end if;
    insert into public.workspace_members (workspace_id, user_id, role)
    select i.workspace_id, p_user, i.role
      from public.workspace_invites i
      join public.workspaces w on w.id = i.workspace_id
     where i.email = v_email
       and i.expires_at > now()
       and w.owner_id <> p_user
       and not w.is_system
    on conflict do nothing;
    delete from public.workspace_invites
     where email = v_email;
end
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    insert into public.profiles (id) values (new.id);
    insert into public.billing_accounts (
        owner_id, plan, plan_status, quota_bytes, max_file_bytes, max_hub_listings, max_entries,
        max_strokes, max_connections, max_desktops,
        egress_bytes_month, max_public_file_bytes, download_bytes_month
    )
    select new.id, 'free', 'active', d.quota_bytes, d.max_file_bytes, d.max_hub_listings, d.max_entries,
           d.max_strokes, d.max_connections, d.max_desktops,
           d.egress_bytes_month, d.max_public_file_bytes, d.download_bytes_month
      from private.plan_defaults('free') d;

    -- Live pending invites for this address become memberships. Expired rows
    -- are only deleted so a later invite can reuse (workspace_id, email).
    perform private.claim_workspace_invites(new.id, new.email);
    return new;
end
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function private.handle_new_user();

-- accounts created before this table existed get their rows now
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

insert into public.billing_accounts (
    owner_id, plan, plan_status, quota_bytes, max_file_bytes, max_hub_listings, max_entries,
    max_strokes, max_connections, max_desktops,
    egress_bytes_month, max_public_file_bytes, download_bytes_month
)
select u.id, 'free', 'active', d.quota_bytes, d.max_file_bytes, d.max_hub_listings, d.max_entries,
       d.max_strokes, d.max_connections, d.max_desktops,
       d.egress_bytes_month, d.max_public_file_bytes, d.download_bytes_month
  from auth.users u
  cross join private.plan_defaults('free') d
on conflict (owner_id) do nothing;
-- The owner may change only username/display_name (updated_at via RPC-free
-- direct update; freshness is not critical)
revoke update on public.profiles from authenticated, anon;
grant update (username, display_name) on public.profiles to authenticated;

-- ----------------------------------------------------------------------------
-- hub_publications: the /hub gallery. One row per listed workspace (the
-- same row that is_public). Likes/views are future columns. Description
-- and tags are optional even when listed: ''/'{}' are valid. allow_fork
-- is mirrored from workspaces.allow_fork so Hub cards do not extra-join;
-- fork_workspace is gated by workspaces.allow_fork and bumps fork_count
-- when a listing exists. Delist (remove_from_hub) does not make the
-- workspace private. hidden_at hides the card from /hub and /<username>
-- without touching the public URL; reports_counted_after is the unhide
-- cursor so the same three reports do not hide the listing again.
-- ----------------------------------------------------------------------------
create table public.hub_publications (
    source_workspace_id uuid primary key references public.workspaces (id) on delete cascade,
    owner_id uuid not null references public.profiles (id) on delete cascade,
    description text not null default '' check (char_length(description) <= 280),
    tags text[] not null default '{}' check (cardinality(tags) <= 5),
    allow_fork boolean not null default true,
    fork_count bigint not null default 0 check (fork_count >= 0),
    listed_at timestamptz not null default now(),
    hidden_at timestamptz,
    hidden_reason text check (hidden_reason is null or hidden_reason in ('reports', 'moderator')),
    reports_counted_after timestamptz not null default '-infinity'::timestamptz,
    -- B2 key, not a URL. Served via GET /hub-preview on the backend.
    preview_key text check (
        preview_key is null
        or preview_key ~ '^hub/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
    ),
    constraint hub_publications_hidden_check check (
        (hidden_at is null) = (hidden_reason is null)
    )
);

-- /hub listing is newest-first; tag filter uses array containment
create index hub_publications_listed_at_idx on public.hub_publications (listed_at desc)
    where hidden_at is null;
create index hub_publications_tags_gin on public.hub_publications using gin (tags);
-- per-owner listing count (set_hub_listing) and the owner FK cascade
create index hub_publications_owner_idx on public.hub_publications (owner_id);
create index hub_publications_hidden_at_idx on public.hub_publications (hidden_at)
    where hidden_at is not null;

-- Hub preview objects the backend has stat'ed after the client's PUT
-- (POST /hub-preview/finalize): set_hub_listing accepts only keys listed
-- here, so an unbounded object can never become a listed preview. Lives in
-- private (not exposed); written through record_hub_preview_upload under the
-- service role. Rows of previews that never got listed are harmless
create table private.hub_preview_uploads (
    storage_key text primary key,
    workspace_id uuid not null references public.workspaces (id) on delete cascade,
    size_bytes bigint not null check (size_bytes >= 0),
    uploaded_by uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now()
);

-- FK cascades (workspace delete, account delete)
create index hub_preview_uploads_workspace_idx on private.hub_preview_uploads (workspace_id);
create index hub_preview_uploads_uploaded_by_idx on private.hub_preview_uploads (uploaded_by);

create or replace function private.record_hub_preview_upload(
    p_storage_key text,
    p_size_bytes bigint,
    p_user uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_workspace uuid;
begin
    if p_storage_key !~ '^hub/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpe?g|png|webp)$' then
        raise exception 'record_hub_preview_upload: invalid key';
    end if;
    if p_size_bytes is null or p_size_bytes < 0 or p_size_bytes > 2097152 then
        raise exception 'record_hub_preview_upload: preview exceeds 2097152 bytes';
    end if;
    v_workspace := split_part(p_storage_key, '/', 2)::uuid;
    if not exists (select 1 from public.workspaces w where w.id = v_workspace and w.owner_id = p_user) then
        raise exception 'record_hub_preview_upload: access denied';
    end if;
    insert into private.hub_preview_uploads (storage_key, workspace_id, size_bytes, uploaded_by)
    values (p_storage_key, v_workspace, p_size_bytes, p_user)
    on conflict (storage_key) do update
       set size_bytes = excluded.size_bytes;
end
$$;

-- ----------------------------------------------------------------------------
-- Post-moderation. Admins are a uid list (insert via SQL). Reports attach to
-- the workspace so they survive delist; a re-list with ≥3 qualified reports
-- auto-hides again. Mail is a queue the backend drains (Plunk) — triggers
-- never send. Digest cursor is a singleton row.
-- ----------------------------------------------------------------------------

create table private.admins (
    user_id uuid primary key references auth.users (id) on delete cascade,
    created_at timestamptz not null default now()
);

create table private.hub_reports (
    workspace_id uuid not null references public.workspaces (id) on delete cascade,
    reporter_id uuid not null references auth.users (id) on delete cascade,
    reason text not null check (char_length(reason) between 1 and 280),
    created_at timestamptz not null default now(),
    primary key (workspace_id, reporter_id)
);

create index hub_reports_reporter_created_idx
    on private.hub_reports (reporter_id, created_at);
create index hub_reports_workspace_idx on private.hub_reports (workspace_id);

create table public.moderation_mail (
    id uuid primary key default gen_random_uuid(),
    kind text not null check (kind in ('listing_hidden', 'listing_made_private')),
    workspace_id uuid not null references public.workspaces (id) on delete cascade,
    owner_id uuid not null references auth.users (id) on delete cascade,
    reason text,
    username text,
    slug text,
    workspace_name text,
    created_at timestamptz not null default now(),
    sent_at timestamptz,
    attempts integer not null default 0 check (attempts >= 0),
    last_error text
);

create index moderation_mail_pending_idx
    on public.moderation_mail (created_at)
    where sent_at is null;
create index moderation_mail_workspace_idx on public.moderation_mail (workspace_id);
create index moderation_mail_owner_idx on public.moderation_mail (owner_id);

alter table public.moderation_mail enable row level security;

create table public.moderation_digest_state (
    id integer primary key default 1 check (id = 1),
    last_sent_at timestamptz not null default '-infinity'::timestamptz
);

alter table public.moderation_digest_state enable row level security;

insert into public.moderation_digest_state (id) values (1) on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- entries
-- ----------------------------------------------------------------------------

create table public.entries (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces (id) on delete cascade,
    parent_id uuid references public.entries (id) on delete cascade,

    -- workspace root: parent_id is null and name = ''; all others forbid '/'
    name text not null,
    kind text not null check (kind in ('file', 'folder')),
    mime text, -- null for folders; decides text (content) vs media (storage_key)

    -- materialized path of names — this is the `id` from FileManager's view
    path text not null,
    -- structural path of uuid labels for subtree queries
    node_path ltree not null,

    -- client-written presentation attrs. Size-capped: xattrs are outside the
    -- byte quota and, with REPLICA IDENTITY FULL, every UPDATE broadcasts the
    -- whole row — Realtime drops events above 1 MB
    xattrs jsonb not null default '{}' check (pg_column_size(xattrs) <= 65536),

    -- text payloads live in entry_contents (separate table, see below)
    storage_key text,  -- B2 object key: "<workspace_id>/<entry_uuid>"
    -- space accounting for quotas: text is mirrored from entry_contents
    -- by entry_contents_touch, blobs are set by the backend at upload;
    -- null for folders
    size_bytes bigint check (size_bytes is null or size_bytes >= 0),

    -- soft delete (trash): null means the row is live
    deleted_at timestamptz,

    updated_by uuid references auth.users (id) on delete set null,
    -- client-instance id (a device / browser profile), an audit/presence
    -- hint: "which device changed this". Client-supplied and therefore
    -- non-authoritative; echo suppression deliberately does NOT depend on
    -- it (in-memory recent_writes in supabase.ts handles that)
    updated_by_client text check (updated_by_client is null or char_length(updated_by_client) <= 64),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    -- "content changed" (mtime analog): only payload changes count
    -- (entry_contents writes or storage_key), rename/move/xattrs do not;
    -- null for folders. Set by entries_touch / entry_contents_touch
    content_modified_at timestamptz,

    -- '.' / '..' and control characters are refused as well: paths are
    -- exported to real file systems (downloads, local sync), where they
    -- would be traversal or garbage
    constraint entries_name_check check (
        (parent_id is null and name = '')
        or (
            parent_id is not null
            and name <> ''
            and position('/' in name) = 0
            and name not in ('.', '..')
            and name !~ '[\x01-\x1f\x7f]'
            and char_length(name) <= 255
        )
    ),
    -- a file's payload is exactly one of: an entry_contents row (text) or
    -- storage_key (blob) — cross-table and therefore not expressible here;
    -- the file side is enforced by entry_contents_guard
    constraint entries_payload_check check (
        kind = 'file'
        or (storage_key is null and mime is null and size_bytes is null)
    )
);

-- Uniqueness only among LIVE rows: a file sitting in the trash does not
-- block its name for a new one
create unique index entries_path_unique
    on public.entries (workspace_id, path)
    where deleted_at is null;

create unique index entries_sibling_name_unique
    on public.entries (parent_id, name)
    where deleted_at is null;

-- one live root per workspace
create unique index entries_root_unique
    on public.entries (workspace_id)
    where parent_id is null and deleted_at is null;

-- children lookups AND the parent_id FK cascade: not partial, because hard
-- deletes of trashed subtrees walk trashed children too
create index entries_parent_idx on public.entries (parent_id);
-- all rows of a workspace, trash included: the workspaces→entries cascade and
-- assert_owner_entries need it (entries_path_unique is partial, live rows only)
create index entries_workspace_idx on public.entries (workspace_id);
create index entries_node_path_gist on public.entries using gist (node_path);
-- xattrs are never queried by content (folder_read filters by parent), so no
-- GIN index: it would be maintained on every drag for nothing
-- GET /presign and the GC reference checks look rows up by key
create index entries_storage_key_idx on public.entries (storage_key) where storage_key is not null;
-- FK on delete set null (account deletion)
create index entries_updated_by_idx on public.entries (updated_by) where updated_by is not null;
-- the cron hard delete scans via this index
create index entries_deleted_at_idx on public.entries (deleted_at) where deleted_at is not null;
-- rows whose blob still lives under another workspace's prefix (fresh forks):
-- the backend re-key sweep polls this set every GC tick, so it must be an
-- index hit, not a scan (list_foreign_blob_entries in rpc.sql)
create index entries_foreign_blob_idx on public.entries (created_at)
    where storage_key is not null and lower(left(storage_key, 36)) <> workspace_id::text;

-- UPDATE events via Realtime must carry the old row (rename/trash detection
-- in watch()), and the workspace_id filter must apply to DELETE events. Note
-- that a DELETE's old record is still trimmed to the PK under RLS (see 7)
alter table public.entries replica identity full;

-- Structural columns (name, parent_id, path, node_path, workspace_id) are
-- never client-writable: rename/move/copy/delete go through RPCs. Blob
-- columns (storage_key, size_bytes) are written only by the backend through
-- create_blob_entry / replace_blob_entry (rpc.sql) and by security-definer RPCs: a client that
-- could set them would re-point its own rows at foreign blobs (/presign
-- authorizes by row visibility) or zero its usage (owner_usage sums
-- size_bytes). Both INSERT and UPDATE are therefore column-level — a client
-- cannot even mention the other columns. Table-level grants for the roles
-- live in the privileges block at the bottom; they must stay SELECT/DELETE
-- only, otherwise these column lists are silently widened again.
revoke insert, update on public.entries from authenticated, anon;
grant insert (id, workspace_id, parent_id, name, kind, mime, xattrs, updated_by_client)
    on public.entries to authenticated;
grant update (xattrs, updated_by_client) on public.entries to authenticated;

-- ----------------------------------------------------------------------------
-- Triggers: deriving path/node_path, updated_at/updated_by
-- ----------------------------------------------------------------------------

-- Functions pin search_path = public, extensions (not ''): ltree lives in
-- the extensions schema (Supabase convention, keeps public free of extension
-- objects) and its type/operators must resolve at validation and runtime;
-- pg_temp stays out of the path and CREATE on public/extensions is revoked
-- from user roles on Supabase
--
-- Trigger functions run whether or not the calling role holds EXECUTE on
-- them (Postgres checks that privilege at CREATE TRIGGER only), so EXECUTE is
-- revoked from every trigger function below (see the privileges block): the
-- security-definer ones would otherwise be listed as callable via
-- /rest/v1/rpc — not exploitable (a trigger function cannot be invoked
-- directly), but the linter is right that nothing should be able to try

-- `entries_00_tree_lock` sorts first, so it runs BEFORE the count/quota/path
-- triggers: a direct folder INSERT takes the same workspace tree lock as the
-- structural RPCs, and takes it before entries_derive_paths reads the parent
create or replace function public.entries_tree_lock()
returns trigger
language plpgsql security definer
set search_path = public, extensions
as $$
begin
    if auth.uid() is not null and not private.can_write_workspace(NEW.workspace_id) then
        raise exception 'entries: access denied' using errcode = '42501';
    end if;
    perform private.lock_workspace_tree(NEW.workspace_id);
    return NEW;
end;
$$;
create trigger entries_00_tree_lock before insert on public.entries
    for each row execute function public.entries_tree_lock();
revoke execute on function public.entries_tree_lock() from public, anon, authenticated;

-- path and node_path are computed from the parent; clients never pass them on INSERT
create or replace function public.entries_derive_paths()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
    v_parent public.entries%rowtype;
begin
    if NEW.parent_id is null then
        NEW.path := '/';
        NEW.node_path := replace(NEW.id::text, '-', '')::ltree;
    else
        select * into v_parent from public.entries where id = NEW.parent_id;
        if not found then
            raise exception 'entries: parent % not found', NEW.parent_id;
        end if;
        if v_parent.kind <> 'folder' then
            raise exception 'entries: parent % is not a folder', NEW.parent_id;
        end if;
        if v_parent.workspace_id <> NEW.workspace_id then
            raise exception 'entries: parent belongs to a different workspace';
        end if;
        -- a live row under a trashed parent would be invisible to folder_read
        -- and unrestorable on its own; nothing legitimately inserts there
        if v_parent.deleted_at is not null then
            raise exception 'entries: parent % is in the trash', NEW.parent_id;
        end if;
        NEW.path := case when v_parent.path = '/'
            then '/' || NEW.name
            else v_parent.path || '/' || NEW.name
        end;
        NEW.node_path := v_parent.node_path || replace(NEW.id::text, '-', '')::ltree;
    end if;
    return NEW;
end
$$;

create trigger entries_derive_paths
    before insert on public.entries
    for each row execute function public.entries_derive_paths();

create or replace function public.entries_touch()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
    NEW.updated_at := now();
    -- service-role writes (create_blob_entry, the blob copy/reconcile jobs)
    -- have no JWT subject: keep the value the statement supplied (or the old
    -- one) instead of nulling the audit column
    NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
    -- mtime: file creation or a blob being attached. Text edits do not pass
    -- through here: content lives in entry_contents, and
    -- entry_contents_touch mirrors content_modified_at into entries. A key
    -- swap on a row that already had a blob is the backend re-keying a fork
    -- (same bytes, new object) — not a content change
    if TG_OP = 'INSERT' then
        NEW.content_modified_at := case when NEW.kind = 'file' then now() else null end;
    elsif OLD.storage_key is null and NEW.storage_key is not null then
        NEW.content_modified_at := now();
    end if;
    return NEW;
end
$$;

create trigger entries_touch
    before insert or update on public.entries
    for each row execute function public.entries_touch();

-- Row-count ceiling for direct client INSERTs (folders, see entries_insert).
-- Security-definer RPCs run as the table owner, so current_user is not a
-- user role there and this trigger stays out of their way — they call
-- private.assert_owner_entries themselves with the real row delta
-- (create_text_file, create_blob_entry, copy_entry, fork_workspace)
create or replace function public.entries_count_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
    v_owner uuid;
begin
    if current_user in ('authenticated', 'anon') then
        select w.owner_id into v_owner from public.workspaces w where w.id = NEW.workspace_id;
        perform private.assert_owner_entries(v_owner, 1);
    end if;
    return NEW;
end
$$;

create trigger entries_count_guard
    before insert on public.entries
    for each row execute function public.entries_count_guard();

-- ----------------------------------------------------------------------------
-- entry_contents: text file payloads, split out of entries
-- ----------------------------------------------------------------------------
-- entries is published to supabase_realtime as a whole row (REPLICA
-- IDENTITY FULL forbids a column list): with content inside, every save of
-- a large text file broadcast megabytes to all subscribers, and
-- folder_read pulled the payloads with the children list. This table is
-- NOT published; content changes surface on entries as a slim UPDATE via
-- entry_contents_touch (watchers refetch the payload on demand).
-- Cascades: hard delete of an entry (pg_cron, purge, workspace cascade)
-- removes its content row automatically.

create table public.entry_contents (
    entry_id uuid primary key references public.entries (id) on delete cascade,
    -- denormalized so RLS policies can check access without a join
    workspace_id uuid not null references public.workspaces (id) on delete cascade,
    content text not null,
    -- same audit/presence hint as entries.updated_by_client;
    -- entry_contents_touch copies it into entries on every write
    updated_by_client text check (updated_by_client is null or char_length(updated_by_client) <= 64)
);

-- the workspace FK cascade
create index entry_contents_workspace_idx on public.entry_contents (workspace_id);

-- The server-side gate on text payloads: clients write entry_contents
-- directly via PostgREST (bypassing the backend), so the limit and the
-- "text files only" invariant can only live here. The client-side
-- MAX_TEXT_CONTENT_BYTES in supabase.ts is UX only. Owner quota is
-- enforced here too — without it, notes would bypass the blob presign gate.
create or replace function public.entry_contents_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
    v_entry public.entries%rowtype;
    v_old int := 0;
    v_new int;
begin
    select * into v_entry from public.entries where id = NEW.entry_id;
    if not found then
        raise exception 'entry_contents: entry % not found', NEW.entry_id;
    end if;
    if v_entry.kind <> 'file' or v_entry.storage_key is not null then
        raise exception 'entry_contents: entry % is not a text file', NEW.entry_id;
    end if;
    if NEW.workspace_id <> v_entry.workspace_id then
        raise exception 'entry_contents: workspace_id does not match the entry';
    end if;
    v_new := octet_length(NEW.content);
    if v_new > 8388608 then -- 8 MB, mirrors MAX_TEXT_CONTENT_BYTES
        raise exception 'entry_contents: text file exceeds 8388608 bytes limit';
    end if;
    if TG_OP = 'UPDATE' then
        v_old := octet_length(OLD.content);
    end if;
    perform private.assert_owner_quota(NEW.workspace_id, (v_new - v_old)::bigint, null);
    return NEW;
end
$$;

create trigger entry_contents_guard
    before insert or update on public.entry_contents
    for each row execute function public.entry_contents_guard();

-- Content changes surface as a slim UPDATE on entries: watchers get a
-- modify event without the payload, size accounting stays honest, and
-- entries_touch on that UPDATE sets updated_at/updated_by.
-- Security definer: table-level UPDATE on entries is revoked from
-- authenticated (only column grants), and the mirror touches
-- content_modified_at, which clients may not write directly. This is
-- system bookkeeping — the write itself was already authorized by the
-- entry_contents RLS policies and validated by entry_contents_guard
create or replace function public.entry_contents_touch()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    update public.entries
       set size_bytes = octet_length(NEW.content),
           content_modified_at = now(),
           updated_by_client = NEW.updated_by_client
     where id = NEW.entry_id;
    return NEW;
end
$$;

create trigger entry_contents_touch
    after insert or update on public.entry_contents
    for each row execute function public.entry_contents_touch();

-- ----------------------------------------------------------------------------
-- folder_strokes: canvas ink, one row per stroke
-- ----------------------------------------------------------------------------
-- Strokes are immutable, id-addressable entities, so the model is per-row:
-- a pen commit is one INSERT, the eraser a DELETE, a drag an UPDATE of
-- position. Concurrent drawers merge for free (union by id); the only
-- last-writer-wins left is a single stroke dragged by two clients at once.
-- The table IS published to supabase_realtime — events carry exactly one
-- stroke, so broadcasts stay small. entry_id (uuid) survives folder
-- rename/move; trash (soft delete on entries) keeps strokes, hard delete
-- cascades. ids are client-minted uuids: optimistic insert needs no
-- round-trip remap, and realtime echoes are recognized by id.

create table public.folder_strokes (
    id uuid primary key,
    entry_id uuid not null references public.entries (id) on delete cascade,
    -- denormalized so RLS policies can check access without a join
    -- and realtime subscriptions filter by workspace
    workspace_id uuid not null references public.workspaces (id) on delete cascade,

    -- z replaces the former array index: strokes render ascending,
    -- a committed stroke gets max(z) + 1; drags never touch z
    z double precision not null,
    position jsonb not null check (pg_column_size(position) <= 512),
    points jsonb not null,
    color text not null check (char_length(color) <= 64),
    stroke_width real not null,
    width real not null,
    height real not null,

    -- same audit/presence hint as entries.updated_by_client; echo
    -- suppression deliberately does NOT depend on it (see supabase.ts)
    updated_by_client text check (updated_by_client is null or char_length(updated_by_client) <= 64),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index folder_strokes_entry_idx on public.folder_strokes (entry_id, z);
-- realtime filter / RLS by workspace and the workspace FK cascade
create index folder_strokes_workspace_idx on public.folder_strokes (workspace_id);

-- Same reason as folder_connections below: a DELETE writes only the replica
-- identity columns, and the subscriber's `workspace_id=eq.<id>` filter is
-- matched against exactly those. With the bare `id` primary key as identity
-- the filter matched nothing, so an erased stroke never reached the other
-- clients live — they only lost it on the next resync. Stroke ids are opaque
-- uuids, so the wider identity still leaks nothing.
create unique index folder_strokes_replica_idx
    on public.folder_strokes (workspace_id, id);
alter table public.folder_strokes
    replica identity using index folder_strokes_replica_idx;

-- The server-side gate on stroke payloads: clients write folder_strokes
-- directly via PostgREST (bypassing the backend), so the "folders only"
-- invariant and the abuse guard can only live here. 32 KiB per stroke is
-- unreachable by hand after simplify — it is a bug/abuse fence, not a
-- user-facing limit. Per-folder (5000) and owner (billing_accounts.max_strokes)
-- caps bound total ink; only a NEW id counts so an upsert that moves
-- existing strokes still passes at the ceiling
create or replace function public.folder_strokes_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
    v_entry public.entries%rowtype;
    v_owner uuid;
    v_new boolean;
begin
    select * into v_entry from public.entries where id = NEW.entry_id;
    if not found then
        raise exception 'folder_strokes: entry % not found', NEW.entry_id;
    end if;
    if v_entry.kind <> 'folder' then
        raise exception 'folder_strokes: entry % is not a folder', NEW.entry_id;
    end if;
    if NEW.workspace_id <> v_entry.workspace_id then
        raise exception 'folder_strokes: workspace_id does not match the entry';
    end if;
    if octet_length(NEW.points::text) > 32768 then -- 32 KiB per stroke
        raise exception 'folder_strokes: stroke exceeds 32768 bytes points limit';
    end if;
    v_new := TG_OP = 'INSERT'
        and not exists (select 1 from public.folder_strokes s where s.id = NEW.id);
    if v_new
       and (select count(*) from public.folder_strokes s where s.entry_id = NEW.entry_id) >= 5000
    then
        raise exception 'folder_strokes: folder % already holds 5000 strokes', NEW.entry_id;
    end if;
    if v_new then
        select w.owner_id into v_owner from public.workspaces w where w.id = NEW.workspace_id;
        perform private.assert_owner_strokes(v_owner, 1);
    end if;
    return NEW;
end
$$;

create trigger folder_strokes_guard
    before insert or update on public.folder_strokes
    for each row execute function public.folder_strokes_guard();

create or replace function public.folder_strokes_touch()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
    NEW.updated_at := now();
    return NEW;
end
$$;

create trigger folder_strokes_touch
    before update on public.folder_strokes
    for each row execute function public.folder_strokes_touch();

-- ----------------------------------------------------------------------------
-- folder_connections: canvas edges between a folder's children, one row each
-- ----------------------------------------------------------------------------
-- Same per-row entity model as folder_strokes: a connect is one INSERT,
-- edge removal a DELETE, a marker/animation toggle an UPDATE. Concurrent
-- connectors merge for free: the id is deterministic
-- (from:handle-to:handle, minted by the client), so two clients creating
-- the same edge collide on the PK and upsert dedups them. The id embeds
-- endpoint paths, and paths repeat across workspaces (a workspace copied
-- into the cloud twice, a pack imported twice), so the key is per workspace: a
-- table-wide id let an upsert in one workspace take over another
-- workspace's row. from_entry/
-- to_entry are real FKs: a hard delete of a widget kills its edges, while
-- trash (soft delete on entries) keeps them. All mutable edge properties
-- (handles, end markers, is_animated, …) live in the props jsonb so new
-- characteristics need no schema migration; the CHECK validates the known
-- keys and permits unknown ones (the extension window). The table IS
-- published to supabase_realtime — per-row events are tiny.

create table public.folder_connections (
    -- Realtime DELETE bypasses row policies and exposes the primary key.
    -- Only an opaque UUID may be in that payload: client ids contain paths.
    record_id uuid primary key default gen_random_uuid(),
    -- deterministic client-minted business id, unique per workspace
    id text not null check (char_length(id) <= 2048),
    entry_id uuid not null references public.entries (id) on delete cascade,
    -- denormalized so RLS policies can check access without a join
    -- and realtime subscriptions filter by workspace
    workspace_id uuid not null references public.workspaces (id) on delete cascade,
    from_entry uuid not null references public.entries (id) on delete cascade,
    to_entry uuid not null references public.entries (id) on delete cascade,

    -- everything mutable: handles, end markers (Vue Flow MarkerType),
    -- is_animated; future characteristics arrive as new keys
    props jsonb not null default '{}'::jsonb check (pg_column_size(props) <= 8192),

    updated_by_client text check (updated_by_client is null or char_length(updated_by_client) <= 64),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique (workspace_id, id),
    check (from_entry <> to_entry),
    -- minimal control: known keys are validated, unknown keys are allowed
    -- (extension window); a missing key means the default
    check (
        jsonb_typeof(props) = 'object'
        and (props->>'from_handle' is null or props->>'from_handle' in ('top','right','bottom','left'))
        and (props->>'to_handle' is null or props->>'to_handle' in ('top','right','bottom','left'))
        and (props->>'marker_start' is null or props->>'marker_start' in ('arrow','arrowclosed'))
        and (props->>'marker_end' is null or props->>'marker_end' in ('arrow','arrowclosed'))
        and (props->'is_animated' is null or jsonb_typeof(props->'is_animated') = 'boolean')
        and (props->'label' is null or (
            jsonb_typeof(props->'label') = 'string'
            and char_length(props->>'label') <= 500
        ))
    )
);

create index folder_connections_entry_idx on public.folder_connections (entry_id);
revoke insert, update on public.folder_connections from authenticated, anon;
grant insert (id, entry_id, workspace_id, from_entry, to_entry, props, updated_by_client)
    on public.folder_connections to authenticated;
grant update (id, entry_id, workspace_id, from_entry, to_entry, props, updated_by_client)
    on public.folder_connections to authenticated;

-- Replica identity, NOT an access path: it is the column set a DELETE writes
-- into the WAL, and `realtime.apply_rls` matches a subscriber's filter against
-- exactly that set (`old_columns`, built from wal `identity`). A filter naming
-- a column the set lacks matches NOTHING — with the bare `record_id` primary
-- key as the identity, `workspace_id=eq.<id>` would silently stop delivering
-- edge deletions to the very workspace that owns them. Adding workspace_id
-- restores delivery; `id` stays out, so the payload still carries no path.
create unique index folder_connections_replica_idx
    on public.folder_connections (workspace_id, record_id);
alter table public.folder_connections
    replica identity using index folder_connections_replica_idx;

-- endpoint FK cascades (a hard-deleted widget kills its edges); the
-- (workspace_id, id) unique constraint serves the workspace FK / lookups
create index folder_connections_from_idx on public.folder_connections (from_entry);
create index folder_connections_to_idx on public.folder_connections (to_entry);

-- The "folders only" invariant lives here because clients write
-- folder_connections directly via PostgREST. 8 KiB props / 2048-char id
-- are table CHECKs; per-folder (5000) and owner caps bound row count.
-- Only a NEW (workspace_id, id) counts so an upsert still passes at the ceiling
create or replace function public.folder_connections_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
    v_entry public.entries%rowtype;
    v_owner uuid;
    v_new boolean;
begin
    select * into v_entry from public.entries where id = NEW.entry_id;
    if not found then
        raise exception 'folder_connections: entry % not found', NEW.entry_id;
    end if;
    if v_entry.kind <> 'folder' then
        raise exception 'folder_connections: entry % is not a folder', NEW.entry_id;
    end if;
    if NEW.workspace_id <> v_entry.workspace_id then
        raise exception 'folder_connections: workspace_id does not match the entry';
    end if;
    if exists (
        select 1 from public.entries
        where id in (NEW.from_entry, NEW.to_entry)
          and workspace_id is distinct from NEW.workspace_id
    ) then
        raise exception 'folder_connections: endpoints must belong to the same workspace';
    end if;
    v_new := TG_OP = 'INSERT'
        and not exists (
            select 1 from public.folder_connections c
             where c.workspace_id = NEW.workspace_id and c.id = NEW.id
        );
    if v_new
       and (select count(*) from public.folder_connections c where c.entry_id = NEW.entry_id) >= 5000
    then
        raise exception 'folder_connections: folder % already holds 5000 connections', NEW.entry_id;
    end if;
    if v_new then
        select w.owner_id into v_owner from public.workspaces w where w.id = NEW.workspace_id;
        perform private.assert_owner_connections(v_owner, 1);
    end if;
    return NEW;
end
$$;

create trigger folder_connections_guard
    before insert or update on public.folder_connections
    for each row execute function public.folder_connections_guard();

create or replace function public.folder_connections_touch()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
    NEW.updated_at := now();
    return NEW;
end
$$;

create trigger folder_connections_touch
    before update on public.folder_connections
    for each row execute function public.folder_connections_touch();

-- ----------------------------------------------------------------------------
-- Access checks (security definer so RLS policies do not recurse)
-- ----------------------------------------------------------------------------

create or replace function private.is_workspace_owner(p_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, extensions
as $$
    select exists (
        select 1 from public.workspaces
        where id = p_workspace_id and owner_id = auth.uid()
    );
$$;

create or replace function private.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public, extensions
as $$
    select exists (
        select 1 from private.admins a
        where a.user_id = auth.uid()
    );
$$;

-- Auto-hide a Hub card when ≥3 distinct reporters with accounts older than
-- 7 days filed a report after reports_counted_after. No-op when there is no
-- visible listing. Enqueues listing_hidden mail for the owner.
create or replace function private.maybe_auto_hide_hub_listing(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_cutoff timestamptz;
    v_count bigint;
    v_owner uuid;
    v_username text;
    v_slug text;
    v_name text;
begin
    select h.reports_counted_after, h.owner_id, p.username, w.slug, w.name
      into v_cutoff, v_owner, v_username, v_slug, v_name
      from public.hub_publications h
      join public.workspaces w on w.id = h.source_workspace_id
      join public.profiles p on p.id = h.owner_id
     where h.source_workspace_id = p_workspace
       and h.hidden_at is null;
    if not found then
        return;
    end if;

    select count(*) into v_count
      from private.hub_reports r
      join auth.users u on u.id = r.reporter_id
     where r.workspace_id = p_workspace
       and r.created_at > v_cutoff
       and u.created_at <= now() - interval '7 days';

    if v_count < 3 then
        return;
    end if;

    update public.hub_publications
       set hidden_at = now(),
           hidden_reason = 'reports'
     where source_workspace_id = p_workspace
       and hidden_at is null;
    if not found then
        return;
    end if;

    insert into public.moderation_mail (
        kind, workspace_id, owner_id, reason, username, slug, workspace_name
    ) values (
        'listing_hidden', p_workspace, v_owner, 'reports', v_username, v_slug, v_name
    );
end
$$;

create or replace function private.hub_reports_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    perform private.maybe_auto_hide_hub_listing(NEW.workspace_id);
    return NEW;
end
$$;

create trigger hub_reports_after_insert
    after insert on private.hub_reports
    for each row execute function private.hub_reports_after_insert();

create or replace function private.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, extensions
as $$
    select exists (
        select 1 from public.workspace_members
        where workspace_id = p_workspace_id and user_id = auth.uid()
    );
$$;

create or replace function private.is_desktop_owner(p_desktop_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, extensions
as $$
    select exists (
        select 1 from public.desktops
        where id = p_desktop_id and owner_id = auth.uid()
    );
$$;

create or replace function private.is_workspace_editor(p_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, extensions
as $$
    select exists (
        select 1 from public.workspace_members
        where workspace_id = p_workspace_id
          and user_id = auth.uid()
          and role = 'editor'
    );
$$;

create or replace function private.can_read_workspace(p_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, extensions
as $$
    select exists (
        select 1 from public.workspaces
        where id = p_workspace_id
          and (owner_id = auth.uid() or is_public)
    ) or private.is_workspace_member(p_workspace_id);
$$;

-- Owner and editor members can write whether or not the workspace is
-- public. Anons and viewers are read-only. Public is a visibility flag,
-- not a freeze.
create or replace function private.can_write_workspace(p_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, extensions
as $$
    select private.is_workspace_owner(p_workspace_id)
        or private.is_workspace_editor(p_workspace_id);
$$;

-- Set-valued twins of can_read/can_write for the row-level policies on the
-- per-row tables (entries, entry_contents, folder_*). A policy written as
-- `workspace_id in (select private.readable_workspace_ids())` is evaluated
-- once per statement (uncorrelated subquery, hashed), whereas
-- `private.can_read_workspace(workspace_id)` runs two lookups for every
-- candidate row — a folder listing or a Realtime RLS check scanning many rows
-- pays per row. The RPCs keep the scalar helpers: they check one workspace
create or replace function private.readable_workspace_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public, extensions
as $$
    select w.id from public.workspaces w
     where w.owner_id = (select auth.uid()) or w.is_public
    union
    select m.workspace_id from public.workspace_members m
     where m.user_id = (select auth.uid());
$$;

create or replace function private.writable_workspace_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public, extensions
as $$
    select w.id from public.workspaces w
     where w.owner_id = (select auth.uid())
    union
    select m.workspace_id from public.workspace_members m
     where m.user_id = (select auth.uid()) and m.role = 'editor';
$$;

-- Serialize structural operations on one workspace, including direct INSERTs
-- and workspace/desktop/account cascades. NO KEY UPDATE permits FK KEY SHARE
-- locks used by ordinary text saves; FOR UPDATE here would deadlock against a
-- save holding the owner's billing lock. Lock order: workspace → ticket/billing
-- → entries. Payload/xattr UPDATEs do not acquire this workspace lock.
create or replace function private.lock_workspace_tree(p_workspace uuid)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
begin
    perform 1 from public.workspaces where id = p_workspace for no key update;
end;
$$;

create or replace function private.lock_entry_workspace(p_entry uuid)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare v_workspace uuid;
begin
    select workspace_id into v_workspace from public.entries where id = p_entry;
    if not found then raise exception 'entry: not found'; end if;
    if not private.can_write_workspace(v_workspace) then raise exception 'entry: access denied'; end if;
    perform private.lock_workspace_tree(v_workspace);
    -- The caller re-reads the entire entry AFTER acquiring this lock.
end;
$$;
revoke execute on function private.lock_workspace_tree(uuid) from public, anon, authenticated;
revoke execute on function private.lock_entry_workspace(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Owner quota. workspace_usage (rpc.sql) stays the per-board counter.
-- owner_usage sums every workspace of the owner: live + trash + system
-- (cloud desktop files). assert_owner_quota serializes on the billing row.
-- ----------------------------------------------------------------------------

create or replace function private.owner_usage(p_owner uuid)
returns table (
    used_bytes bigint,
    live_bytes bigint,
    trash_bytes bigint
)
language sql
stable
security definer
set search_path = public, extensions
as $$
    select
        coalesce(sum(e.size_bytes), 0)::bigint,
        coalesce(sum(e.size_bytes) filter (where e.deleted_at is null), 0)::bigint,
        coalesce(sum(e.size_bytes) filter (where e.deleted_at is not null), 0)::bigint
      from public.entries e
      join public.workspaces w on w.id = e.workspace_id
     where w.owner_id = p_owner;
$$;

create or replace function private.assert_owner_can_add(
    p_owner uuid,
    p_delta_bytes bigint,
    p_file_bytes bigint
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_billing public.billing_accounts%rowtype;
    v_used bigint;
begin
    -- entry_contents_guard calls this on every write to entry_contents, always
    -- with p_file_bytes null. Taking the lock below before looking at the delta
    -- made every note save in every one of the owner's workspaces queue behind
    -- one billing row, even when the text shrank — answer that case first.
    -- (A non-growing delta for an owner with no billing row now returns instead
    -- of raising: handle_new_user creates that row for every account, and
    -- refusing to shrink a file protects nothing.)
    if coalesce(p_delta_bytes, 0) <= 0 and p_file_bytes is null then
        return;
    end if;

    -- Growing, or a file size to check: lock the billing row so the check and
    -- the caller's insert are one transaction and concurrent uploads cannot
    -- overshoot the quota
    select * into v_billing
      from public.billing_accounts
     where owner_id = p_owner
     for update;
    if not found then
        raise exception 'quota_exceeded: no billing account'
            using errcode = 'P0001',
                  detail = json_build_object(
                      'kind', 'quota',
                      'used_bytes', 0,
                      'quota_bytes', 0,
                      'needed_bytes', coalesce(p_delta_bytes, 0)
                  )::text;
    end if;

    if p_file_bytes is not null and p_file_bytes > v_billing.max_file_bytes then
        raise exception 'file_too_large: % exceeds limit %',
            p_file_bytes, v_billing.max_file_bytes
            using errcode = 'P0001',
                  detail = json_build_object(
                      'kind', 'file_size',
                      'file_bytes', p_file_bytes,
                      'quota_bytes', v_billing.quota_bytes,
                      'max_file_bytes', v_billing.max_file_bytes
                  )::text;
    end if;

    if coalesce(p_delta_bytes, 0) <= 0 then
        return;
    end if;

    select u.used_bytes into v_used from private.owner_usage(p_owner) u;
    v_used := coalesce(v_used, 0);

    if v_used + p_delta_bytes > v_billing.quota_bytes then
        raise exception 'quota_exceeded: used % of % bytes, need % more',
            v_used, v_billing.quota_bytes, p_delta_bytes
            using errcode = 'P0001',
                  detail = json_build_object(
                      'kind', 'quota',
                      'used_bytes', v_used,
                      'quota_bytes', v_billing.quota_bytes,
                      'needed_bytes', p_delta_bytes,
                      'file_bytes', p_file_bytes
                  )::text;
    end if;
end
$$;

-- Row ceilings (billing_accounts.max_entries / max_strokes / max_connections
-- / max_desktops). Trash is included: a trashed row still occupies the table
-- for 30 days. Security definer so an editor's RLS cannot under-count the
-- owner's other workspaces. Advisory lock is per owner, not billing_accounts
-- FOR UPDATE — a shrinking text save must not queue behind a stroke insert.
-- Called by the creating RPCs with their real row delta and by the
-- count-guard triggers for direct client inserts
create or replace function private.assert_owner_entries(p_owner uuid, p_delta int)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_max int;
    v_count bigint;
begin
    if p_owner is null or coalesce(p_delta, 0) <= 0 then
        return;
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 42));
    select b.max_entries into v_max from public.billing_accounts b where b.owner_id = p_owner;
    if v_max is null then
        return;
    end if;
    select count(*) into v_count
      from public.entries e
      join public.workspaces w on w.id = e.workspace_id
     where w.owner_id = p_owner;
    if v_count + p_delta > v_max then
        raise exception 'entries_limit_exceeded: % of % entries, need % more',
            v_count, v_max, p_delta
            using errcode = 'P0001';
    end if;
end
$$;

create or replace function private.assert_owner_strokes(p_owner uuid, p_delta int)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_max int;
    v_count bigint;
begin
    if p_owner is null or coalesce(p_delta, 0) <= 0 then
        return;
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 42));
    select b.max_strokes into v_max from public.billing_accounts b where b.owner_id = p_owner;
    if v_max is null then
        return;
    end if;
    select count(*) into v_count
      from public.folder_strokes s
     where s.workspace_id in (select w.id from public.workspaces w where w.owner_id = p_owner);
    if v_count + p_delta > v_max then
        raise exception 'strokes_limit_exceeded: % of % strokes, need % more',
            v_count, v_max, p_delta
            using errcode = 'P0001';
    end if;
end
$$;

create or replace function private.assert_owner_connections(p_owner uuid, p_delta int)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_max int;
    v_count bigint;
begin
    if p_owner is null or coalesce(p_delta, 0) <= 0 then
        return;
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 42));
    select b.max_connections into v_max from public.billing_accounts b where b.owner_id = p_owner;
    if v_max is null then
        return;
    end if;
    select count(*) into v_count
      from public.folder_connections c
     where c.workspace_id in (select w.id from public.workspaces w where w.owner_id = p_owner);
    if v_count + p_delta > v_max then
        raise exception 'connections_limit_exceeded: % of % connections, need % more',
            v_count, v_max, p_delta
            using errcode = 'P0001';
    end if;
end
$$;

create or replace function private.assert_owner_desktops(p_owner uuid, p_delta int)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_max int;
    v_count bigint;
begin
    if p_owner is null or coalesce(p_delta, 0) <= 0 then
        return;
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 42));
    select b.max_desktops into v_max from public.billing_accounts b where b.owner_id = p_owner;
    if v_max is null then
        return;
    end if;
    select count(*) into v_count from public.desktops d where d.owner_id = p_owner;
    if v_count + p_delta > v_max then
        raise exception 'desktops_limit_exceeded: % of % desktops, need % more',
            v_count, v_max, p_delta
            using errcode = 'P0001';
    end if;
end
$$;

create or replace function private.assert_owner_quota(
    p_workspace uuid,
    p_delta_bytes bigint,
    p_file_bytes bigint default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_owner uuid;
begin
    if not private.can_write_workspace(p_workspace) then
        raise exception 'assert_owner_quota: access denied';
    end if;

    select w.owner_id into v_owner
      from public.workspaces w
     where w.id = p_workspace;
    if v_owner is null then
        raise exception 'assert_owner_quota: workspace % not found', p_workspace;
    end if;

    perform private.assert_owner_can_add(v_owner, p_delta_bytes, p_file_bytes);
end
$$;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table public.desktops enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.profiles enable row level security;
alter table public.billing_accounts enable row level security;
alter table public.quota_wall_events enable row level security;
alter table public.bridge_events enable row level security;
alter table public.billing_events enable row level security;
alter table public.plan_launch_subscribers enable row level security;
alter table public.feedback enable row level security;
alter table public.egress_daily enable row level security;
alter table public.download_daily enable row level security;
alter table public.egress_notices enable row level security;
alter table public.hub_publications enable row level security;
alter table public.entries enable row level security;
alter table public.entry_contents enable row level security;
alter table public.folder_strokes enable row level security;
alter table public.folder_connections enable row level security;

-- desktops are strictly owner-scoped (private: no public/member path at all)
create policy desktops_select on public.desktops
    for select using (owner_id = (select auth.uid()));

create policy desktops_insert on public.desktops
    for insert with check (owner_id = (select auth.uid()));

create policy desktops_update on public.desktops
    for update using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));

create policy desktops_delete on public.desktops
    for delete using (owner_id = (select auth.uid()));

create policy workspaces_select on public.workspaces
    for select using (
        owner_id = (select auth.uid())
        or is_public
        or private.is_workspace_member(id)
    );

create policy workspaces_insert on public.workspaces
    for insert with check (
        owner_id = (select auth.uid())
        and not is_public      -- is_public/slug are set only by set_workspace_public
        and not is_system      -- the system workspace is created only by get_or_create_system_workspace
        and slug is null
        -- a board child pins to the caller's own desktop
        and (desktop_id is null or private.is_desktop_owner(desktop_id))
    );

create policy workspaces_update on public.workspaces
    for update using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));

-- the system workspace dies only with the account (owner_id cascade), never
-- by a client delete
create policy workspaces_delete on public.workspaces
    for delete using (owner_id = (select auth.uid()) and not is_system);

create policy members_select on public.workspace_members
    for select using (
        user_id = (select auth.uid())
        or private.is_workspace_owner(workspace_id)
        or private.is_workspace_member(workspace_id)
    );

-- No INSERT policy: rows are added only by add_workspace_member (security
-- definer — email lookup, system-workspace and self-share checks). A direct
-- insert would let an owner attach any user id without those checks
create policy members_delete on public.workspace_members
    for delete using (private.is_workspace_owner(workspace_id));

-- the owner may change member roles (viewer <-> editor); the column grant
-- below limits the update to `role`
create policy members_update on public.workspace_members
    for update using (private.is_workspace_owner(workspace_id))
    with check (private.is_workspace_owner(workspace_id));

-- No INSERT policy: rows are added only by add_workspace_member. Members
-- must not see who was invited but has not joined.
create policy workspace_invites_select on public.workspace_invites
    for select using (private.is_workspace_owner(workspace_id));

create policy workspace_invites_delete on public.workspace_invites
    for delete using (private.is_workspace_owner(workspace_id));

create policy workspace_invites_update on public.workspace_invites
    for update using (private.is_workspace_owner(workspace_id))
    with check (private.is_workspace_owner(workspace_id));

-- profiles back /<username> pages and Hub cards, so rows with a username
-- are public (anon included). Accounts that never chose a username are not
-- enumerable — only their owner reads the row
create policy profiles_select on public.profiles
    for select using (username is not null or id = (select auth.uid()));

create policy profiles_update on public.profiles
    for update using (id = (select auth.uid()))
    with check (id = (select auth.uid()));

-- billing is private identity: the owner reads their own row. Inserts
-- come from handle_new_user (security definer); plan changes later from
-- service_role. No client writes — otherwise Free is bypassed.
create policy billing_accounts_select on public.billing_accounts
    for select using (owner_id = (select auth.uid()));

create policy quota_wall_events_select on public.quota_wall_events
    for select using (owner_id = (select auth.uid()));

create policy quota_wall_events_insert on public.quota_wall_events
    for insert with check (owner_id = (select auth.uid()));

create policy quota_wall_events_update on public.quota_wall_events
    for update using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));

-- the bridge funnel: an account records and reads its own steps, no edits
create policy bridge_events_select on public.bridge_events
    for select using (owner_id = (select auth.uid()));

create policy bridge_events_insert on public.bridge_events
    for insert with check (owner_id = (select auth.uid()));

-- billing_events / plan_launch_subscribers / feedback / egress_daily /
-- download_daily / egress_notices / moderation_mail / moderation_digest_state:
-- no policies for authenticated/anon (service_role bypasses RLS)

-- the Hub gallery is public except hidden rows; owners (and admins) still
-- see their own hidden listings so Publish can show "hidden pending review".
-- Writes go only through the hub / moderation RPCs (security definer)
create policy hub_publications_select on public.hub_publications
    for select using (
        hidden_at is null
        or owner_id = (select auth.uid())
        or (select private.is_admin())
    );

-- The trash is visible to writers only. Readers (anon on a public board,
-- viewers) see live rows: a file the owner deleted must not stay listable
-- and downloadable (GET /presign authorizes by row visibility) for the 30
-- days it waits for hard delete. The short grace after deleted_at exists
-- for Realtime: the soft-delete UPDATE is delivered only if the NEW row
-- passes this policy for the subscriber, so readers would otherwise never
-- receive the "remove" event and keep showing the file until a reload.
-- Two minutes of "still listable by name" cost nothing — the row was
-- visible a moment ago — while /presign refuses trashed rows immediately
-- Per-row tables use the set-valued helpers (see readable_workspace_ids):
-- the subquery is evaluated once per statement instead of once per row
create policy entries_select on public.entries
    for select using (
        workspace_id in (select private.writable_workspace_ids())
        or (
            (deleted_at is null or deleted_at > now() - interval '2 minutes')
            and workspace_id in (select private.readable_workspace_ids())
        )
    );

-- Direct client INSERTs are folders only: text files come from
-- create_text_file, blobs from create_blob_entry (both security definer,
-- so this policy does not apply to them). A directly inserted file row
-- would be a payload-less husk
create policy entries_insert on public.entries
    for insert with check (
        workspace_id in (select private.writable_workspace_ids())
        and kind = 'folder'
    );

create policy entries_update on public.entries
    for update using (workspace_id in (select private.writable_workspace_ids()))
    with check (workspace_id in (select private.writable_workspace_ids()));

-- No DELETE policy: clients never hard-delete. remove() is a soft delete
-- (delete_entry), hard deletes happen only via purge_entry/purge_trash,
-- pg_cron, and FK cascades

-- entry_contents mirrors the entries policies: readable wherever the
-- workspace is readable (anon included — public workspaces serve
-- text/SVG), writable wherever it is writable. Delete is not granted to
-- clients: content rows die by cascade with their entry. The payload of a
-- trashed file is readable by writers only — the inner select runs under
-- entries_select, which already encodes "live and readable"
create policy entry_contents_select on public.entry_contents
    for select using (
        workspace_id in (select private.writable_workspace_ids())
        or exists (
            select 1 from public.entries e
             where e.id = entry_id and e.deleted_at is null
        )
    );

create policy entry_contents_insert on public.entry_contents
    for insert with check (workspace_id in (select private.writable_workspace_ids()));

create policy entry_contents_update on public.entry_contents
    for update using (workspace_id in (select private.writable_workspace_ids()))
    with check (workspace_id in (select private.writable_workspace_ids()));

-- folder_strokes mirrors the entry_contents policies: readable wherever the
-- workspace is readable (anon included — public workspaces serve ink) BUT
-- only while the folder is live, writable wherever it is writable. Unlike
-- entry_contents, delete IS granted: the eraser removes individual strokes.
-- The deleted_at branch matters: without it a plain PostgREST select returned
-- the ink of folders the owner had trashed for the 30 days before the hard
-- delete, while entries_select already hid the folder itself. The inner select
-- runs under entries_select, so "live and readable" is encoded there
create policy folder_strokes_select on public.folder_strokes
    for select using (
        workspace_id in (select private.writable_workspace_ids())
        or exists (
            select 1 from public.entries e
             where e.id = entry_id and e.deleted_at is null
        )
    );

create policy folder_strokes_insert on public.folder_strokes
    for insert with check (workspace_id in (select private.writable_workspace_ids()));

create policy folder_strokes_update on public.folder_strokes
    for update using (workspace_id in (select private.writable_workspace_ids()))
    with check (workspace_id in (select private.writable_workspace_ids()));

create policy folder_strokes_delete on public.folder_strokes
    for delete using (workspace_id in (select private.writable_workspace_ids()));

-- folder_connections mirrors folder_strokes, trashed folders included:
-- readable wherever the workspace is readable (anon on a public board) while
-- the folder is live, writable wherever it is writable; delete is granted
-- (edge removal)
create policy folder_connections_select on public.folder_connections
    for select using (
        workspace_id in (select private.writable_workspace_ids())
        or exists (
            select 1 from public.entries e
             where e.id = entry_id and e.deleted_at is null
        )
    );

create policy folder_connections_insert on public.folder_connections
    for insert with check (workspace_id in (select private.writable_workspace_ids()));

create policy folder_connections_update on public.folder_connections
    for update using (workspace_id in (select private.writable_workspace_ids()))
    with check (workspace_id in (select private.writable_workspace_ids()));

create policy folder_connections_delete on public.folder_connections
    for delete using (workspace_id in (select private.writable_workspace_ids()));

-- ----------------------------------------------------------------------------
-- Realtime
-- ----------------------------------------------------------------------------
-- entries rows are slim: content lives in the separate, non-published
-- entry_contents table. Saving a large text file only broadcasts the
-- small UPDATE that entry_contents_touch writes into entries
-- (size_bytes/content_modified_at); watchers refetch the payload on
-- demand. A column list excluding content would still be impossible with
-- REPLICA IDENTITY FULL (PG restriction), but is no longer needed

alter publication supabase_realtime add table public.entries;

-- folder_strokes IS published: events carry exactly one stroke, so
-- broadcasts stay small. Both tables below run on a narrow REPLICA IDENTITY
-- USING INDEX (workspace_id, <uuid>) rather than the default: DELETE needs
-- only the row's uuid, but `realtime.apply_rls` matches the subscriber's
-- filter against the identity columns alone, so workspace_id has to be there
-- for the event to be delivered at all (see the index definitions above).
alter publication supabase_realtime add table public.folder_strokes;

-- folder_connections IS published for the same reason: one edge per event.
-- Its identity deliberately excludes the client-minted `id`, which embeds
-- endpoint paths — a DELETE payload skips row policies entirely
alter publication supabase_realtime add table public.folder_connections;

-- ----------------------------------------------------------------------------
-- Trash: scheduled hard delete + blob deletion queue for B2
-- ----------------------------------------------------------------------------

-- Keys of blobs to delete from B2. System table: RLS enabled with no
-- policies for anon/authenticated — only the backend GC worker reads and
-- writes it (service role / direct DB connection).
create table public.blob_deletions (
    id bigint generated always as identity primary key,
    storage_key text not null,
    queued_at timestamptz not null default now(),
    attempts integer not null default 0,
    last_error text
);

alter table public.blob_deletions enable row level security;

-- Any hard delete of a row with a blob (cron, cascade from workspace
-- deletion, manual trash purge) enqueues the key — the blob is never lost
create or replace function public.entries_queue_blob_deletion()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if OLD.storage_key is not null then
        insert into public.blob_deletions (storage_key) values (OLD.storage_key);
    end if;
    return OLD;
end
$$;

create trigger entries_queue_blob_deletion
    before delete on public.entries
    for each row execute function public.entries_queue_blob_deletion();

-- Hub preview blobs are not entries: enqueue the old B2 key when the
-- listing is deleted or the preview is replaced/cleared.
create or replace function public.hub_publications_queue_preview_deletion()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if TG_OP = 'DELETE' then
        if OLD.preview_key is not null then
            insert into public.blob_deletions (storage_key) values (OLD.preview_key);
        end if;
        return OLD;
    end if;
    if OLD.preview_key is distinct from NEW.preview_key and OLD.preview_key is not null then
        insert into public.blob_deletions (storage_key) values (OLD.preview_key);
    end if;
    return NEW;
end
$$;

create trigger hub_publications_queue_preview_deletion
    before delete or update of preview_key on public.hub_publications
    for each row execute function public.hub_publications_queue_preview_deletion();

-- ----------------------------------------------------------------------------
-- entry_derivatives: previews the backend makes for NON-members of public
-- boards (apps/backend/src/derivatives.ts) — thumb.webp for images,
-- poster.jpg for video — in the same private bucket under
-- deriv/<workspace_id>/<blob_uuid>/<file>. Keyed by the ORIGINAL's
-- storage_key, not entries.id: a rename keeps the key, a fork gets its own
-- key once re-keyed, and same-workspace copies share one object — so they
-- share one preview too. Outside the owner quota by construction
-- (owner_usage / workspace_usage sum entries.size_bytes only): a preview is
-- the storefront's cost, not the owner's file.
--
-- A row is a decision, not only a pointer: 'ready' carries the object;
-- 'skipped' (no object) means "serve the original" — too small, not smaller
-- once encoded, a format the codecs cannot read — so neither the worker nor
-- GET /presign asks again; 'failed' waits for next_attempt_at and gives up
-- after the backend's DERIV_MAX_ATTEMPTS. Written only by the service-role
-- RPCs in rpc.sql; no client access, not published to Realtime
-- ----------------------------------------------------------------------------

create table public.entry_derivatives (
    storage_key text not null,
    kind text not null check (kind in ('thumb', 'poster')),
    deriv_key text check (
        deriv_key is null
        or deriv_key ~ '^deriv/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(thumb\.webp|poster\.jpg)$'
    ),
    deriv_size_bytes bigint check (deriv_size_bytes is null or deriv_size_bytes >= 0),
    -- the source's dimensions (calibration: how large are the originals)
    width int check (width is null or width > 0),
    height int check (height is null or height > 0),
    status text not null check (status in ('ready', 'skipped', 'failed')),
    reason text check (reason is null or char_length(reason) <= 64),
    attempts int not null default 0 check (attempts >= 0),
    last_error text check (last_error is null or char_length(last_error) <= 500),
    next_attempt_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (storage_key, kind),
    constraint entry_derivatives_ready_check check (
        (status = 'ready') = (deriv_key is not null and deriv_size_bytes is not null)
    )
);

-- the GC reference check and reconcile's known-keys listing look objects up
-- by key; list_pending_derivatives anti-joins through the primary key
create unique index entry_derivatives_deriv_key_idx
    on public.entry_derivatives (deriv_key) where deriv_key is not null;

alter table public.entry_derivatives enable row level security;

-- A preview object leaves with its row: prune_entry_derivatives (rpc.sql)
-- deletes rows of blobs no entry references any more, and a re-decision that
-- drops the object (ready → skipped) clears the key — both queue the old key.
-- The GC drain re-checks references, so a key that is ready again by then
-- (keys are derived, a regeneration writes the same one) is kept
create or replace function public.entry_derivatives_queue_deletion()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if TG_OP = 'DELETE' then
        if OLD.deriv_key is not null then
            insert into public.blob_deletions (storage_key) values (OLD.deriv_key);
        end if;
        return OLD;
    end if;
    if OLD.deriv_key is not null and OLD.deriv_key is distinct from NEW.deriv_key then
        insert into public.blob_deletions (storage_key) values (OLD.deriv_key);
    end if;
    return NEW;
end
$$;

create trigger entry_derivatives_queue_deletion
    before delete or update of deriv_key on public.entry_derivatives
    for each row execute function public.entry_derivatives_queue_deletion();

revoke execute on function public.entry_derivatives_queue_deletion()
    from public, anon, authenticated;

revoke execute on function public.hub_publications_queue_preview_deletion()
    from public, anon, authenticated;
revoke execute on function private.hub_reports_after_insert()
    from public, anon, authenticated;
revoke execute on function private.maybe_auto_hide_hub_listing(uuid)
    from public, anon, authenticated;

-- Server-issued staging capabilities. A ticket is bound to the uploader and
-- to the first finalize request. Completing it and creating the entry happen
-- in one transaction; concurrent attempts use different final object keys.
-- result is an idempotency receipt, NOT an object reference for GC.
create table private.upload_sessions (
    storage_key text primary key,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    uploaded_by uuid not null references auth.users(id) on delete cascade,
    kind text not null check (kind in ('blob', 'hub_preview')),
    request jsonb check (request is null or pg_column_size(request) <= 16384),
    result jsonb,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);
create index upload_sessions_workspace_idx on private.upload_sessions(workspace_id);
create index upload_sessions_user_idx on private.upload_sessions(uploaded_by);
create index upload_sessions_created_idx on private.upload_sessions(created_at);
revoke all on private.upload_sessions from public, anon, authenticated;

-- Daily hard delete of rows that spent more than 30 days in the trash.
-- pg_cron is supported by Supabase out of the box.
create extension if not exists pg_cron;

-- Cron must obey the same lock order as RPCs, before locking/deleting entries.
create or replace function private.purge_expired_entries()
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare v_workspace uuid;
begin
    for v_workspace in select distinct workspace_id from public.entries
        where deleted_at < now() - interval '30 days' order by workspace_id
    loop
        perform private.lock_workspace_tree(v_workspace);
        delete from public.entries where workspace_id = v_workspace
            and deleted_at < now() - interval '30 days';
    end loop;
end;
$$;
revoke execute on function private.purge_expired_entries() from public, anon, authenticated;

select cron.schedule(
    'upload-sessions-prune', '40 3 * * *',
    $$delete from private.upload_sessions where created_at < now() - interval '30 days'$$
);

select cron.schedule(
    'entries-hard-delete',
    '15 3 * * *',
    $$select private.purge_expired_entries()$$
);

-- Egress and download counters matter for the current month plus a few for
-- calibration; notices only dedupe alerts
select cron.schedule(
    'egress-daily-prune',
    '30 3 * * *',
    $$delete from public.egress_daily where day < current_date - 100$$
);

select cron.schedule(
    'download-daily-prune',
    '32 3 * * *',
    $$delete from public.download_daily where day < current_date - 100$$
);

select cron.schedule(
    'egress-notices-prune',
    '35 3 * * *',
    $$delete from public.egress_notices where period < current_date - 400$$
);

-- ----------------------------------------------------------------------------
-- Explicit privileges. Schema USAGE is lost when public is recreated manually
-- (drop schema public cascade) and table grants normally come from the
-- "Automatically expose new tables" project toggle — this block makes the
-- schema self-contained in both cases. UPDATE is intentionally skipped here:
-- it is granted column-wise above (workspaces name, entries xattrs/storage_key/…)
-- ----------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;

-- private is never exposed via the Data API (only public is in db-schemas),
-- but security-invoker wrappers resolve private.* functions with the
-- caller's privileges, so USAGE is required. anon needs it too: published
-- workspaces are read through folder_read. service_role needs it for the
-- backend's blob jobs (copy-clones lists subtrees via list_subtree_files).
-- EXECUTE defaults to PUBLIC;
-- direct client calls are impossible through PostgREST regardless
grant usage on schema private to authenticated, anon, service_role;

grant select, insert, update, delete on public.desktops to authenticated;

grant select, insert, delete on public.workspaces to authenticated;
grant select on public.workspaces to anon;  -- public workspaces (is_public)

-- members: inserted only via add_workspace_member (rpc.sql); the owner may
-- change a member's role or remove the row directly
grant select, delete on public.workspace_members to authenticated;
grant update (role) on public.workspace_members to authenticated;

-- invites: inserted only via add_workspace_member; token stays off the
-- client (email link). Owner may list/revoke and change role directly
revoke all on public.workspace_invites from public, anon, authenticated;
grant select (workspace_id, email, role, invited_by, created_at, expires_at)
    on public.workspace_invites to authenticated;
grant delete on public.workspace_invites to authenticated;
grant update (role) on public.workspace_invites to authenticated;

-- profiles/hub are read-only for clients (anon included: /<username> and
-- /hub render for visitors); the column-wise UPDATE grant on profiles lives
-- above, hub rows are written only by the hub RPCs (security definer)
grant select on public.profiles to anon, authenticated;
grant select on public.hub_publications to anon, authenticated, service_role;

grant select on public.billing_accounts to authenticated;
grant select, insert, update on public.billing_accounts to service_role;
grant select, insert, update on public.quota_wall_events to authenticated;
-- the bridge funnel is insert-only for clients: revoke whatever the "expose
-- new tables" toggle granted, then allow reading and recording own steps
-- (RLS scopes both to the owner)
revoke all on public.bridge_events from public, anon, authenticated;
grant select, insert on public.bridge_events to authenticated;
grant select, insert on public.billing_events to service_role;

-- landing waitlist / feedback: no client grants; RLS with no policies is the
-- backstop if the project toggle exposes new tables to anon/authenticated
revoke all on public.plan_launch_subscribers from public, anon, authenticated;
grant select, insert on public.plan_launch_subscribers to service_role;
revoke all on public.feedback from public, anon, authenticated;
grant select, insert on public.feedback to service_role;

-- egress meter: no client grants (RLS with no policies is the backstop).
-- egress_daily / download_daily are written only through egress_sync /
-- download_sync (security definer); the backend claims alert notices with a
-- plain insert
revoke all on public.egress_daily from public, anon, authenticated;
grant select on public.egress_daily to service_role;
revoke all on public.download_daily from public, anon, authenticated;
grant select on public.download_daily to service_role;
revoke all on public.egress_notices from public, anon, authenticated;
grant select, insert on public.egress_notices to service_role;

-- INSERT and UPDATE on entries are column-wise (see the entries section) and
-- DELETE is not granted at all (hard deletes go through RPCs/cron): never
-- re-grant them table-level here
grant select on public.entries to authenticated;
grant select on public.entries to anon;  -- public workspaces (is_public)
-- the backend's copy/reconcile jobs diff and rewrite storage_key; blob rows
-- are inserted through the security-definer create_blob_entry, not directly
grant select, update on public.entries to service_role;

grant select, insert, update on public.entry_contents to authenticated;
grant select on public.entry_contents to anon;  -- public workspaces serve text/SVG

grant select, insert, update, delete on public.folder_strokes to authenticated;
grant select on public.folder_strokes to anon;  -- public workspaces serve ink

grant select, delete on public.folder_connections to authenticated;
grant select on public.folder_connections to anon;  -- public workspaces serve edges

-- Trigger functions are never called by clients; they fire regardless of
-- EXECUTE, so nothing is lost by revoking it (PUBLIC included — new functions
-- default to EXECUTE for PUBLIC)
revoke execute on function public.desktops_touch() from public, anon, authenticated;
revoke execute on function public.desktops_count_guard() from public, anon, authenticated;
revoke execute on function public.entries_derive_paths() from public, anon, authenticated;
revoke execute on function public.entries_touch() from public, anon, authenticated;
revoke execute on function public.entries_count_guard() from public, anon, authenticated;
revoke execute on function public.entry_contents_guard() from public, anon, authenticated;
revoke execute on function public.entry_contents_touch() from public, anon, authenticated;
revoke execute on function public.folder_strokes_guard() from public, anon, authenticated;
revoke execute on function public.folder_strokes_touch() from public, anon, authenticated;
revoke execute on function public.folder_connections_guard() from public, anon, authenticated;
revoke execute on function public.folder_connections_touch() from public, anon, authenticated;
revoke execute on function public.entries_queue_blob_deletion() from public, anon, authenticated;
revoke execute on function private.handle_new_user() from public, anon, authenticated;

-- private.claim_workspace_invites(uuid, text) grants membership to an
-- arbitrary user id for an arbitrary email. handle_new_user calls it with
-- the new row. The session path is the no-arg overload in rpc.sql, which
-- binds to auth.uid(); that is the only client-callable one. EXECUTE
-- defaults to PUBLIC on every new function, so this has to be re-asserted
-- whenever the schema is applied
revoke execute on function private.claim_workspace_invites(uuid, text)
    from public, anon, authenticated;

-- plan_defaults is recreated with `drop function` above, which resets EXECUTE
-- to PUBLIC; public.plan_limits is a security-invoker wrapper, so authenticated
-- keeps it and anon does not
revoke execute on function private.plan_defaults(text) from public, anon;
grant execute on function private.plan_defaults(text) to authenticated;

-- blob_deletions: nothing for anon/authenticated (RLS with no policies
-- already blocks them), but service_role needs explicit privileges — the
-- platform's default table privileges do not survive a manual schema
-- recreate. The GC worker selects, bumps attempts, and deletes rows; the
-- reconcile job enqueues orphans (insert); row deletes also come from the
-- security-definer trigger as the table owner
grant select, insert, update, delete on public.blob_deletions to service_role;

-- moderation queue + weekly digest cursor: backend-only, like blob_deletions.
-- Inserts also come from security-definer RPCs/triggers as the table owner.
revoke all on public.moderation_mail from public, anon, authenticated;
grant select, insert, update, delete on public.moderation_mail to service_role;
revoke all on public.moderation_digest_state from public, anon, authenticated;
grant select, insert, update on public.moderation_digest_state to service_role;

-- entry_derivatives: nothing for anon/authenticated (RLS with no policies is
-- the backstop) — visitors reach a preview only through download_target.
-- service_role only reads (GC reference checks, reconcile, dead-letter
-- count); every write goes through the security-definer RPCs in rpc.sql,
-- which re-derive the object key from the blob key
revoke all on public.entry_derivatives from public, anon, authenticated, service_role;
grant select on public.entry_derivatives to service_role;
