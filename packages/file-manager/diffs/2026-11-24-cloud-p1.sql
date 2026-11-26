-- П1 of the cloud security plan: forward diff for the live database.
-- Apply once, in one transaction, AFTER the backend and the web app from
-- feature/cloud-p1 are deployed (they work with both shapes).
-- Rewrites no rows.
begin;

-- ---------------------------------------------------------------------------
-- П1.8. Upload tickets carry their size and are bounded per uploader
-- ---------------------------------------------------------------------------
alter table private.upload_sessions
    add column if not exists size_bytes bigint check (size_bytes is null or size_bytes >= 0);

-- register_upload hands out a staging key. A ticket is a right to put bytes
-- into storage that no quota counts until /finalize: the object sits under
-- uploads/ until the reconcile (or the bucket's lifecycle rule) removes it.
-- So the tickets of one uploader are bounded here, by the plan of the
-- workspace's owner:
--   * open tickets (no result, not expired) together hold at most the plan's
--     room, quota_bytes. The largest file is a quarter of it or less on every
--     plan, so a retry after a failed upload always fits;
--   * a day's tickets hold at most three times the room, or 5 GiB if that is
--     more: nobody fills their space three times over in a day, and a file
--     saved again and again by sync stays far below it;
--   * a day has at most max_entries tickets: no more uploads than the
--     account may hold files.
-- p_size is the size the client declared; the backend signs it into the PUT
-- (PRESIGN_PUT_SIGN_LENGTH), so the ticket cannot bring more. A Hub cover
-- counts as its 2 MiB cap. A backend from before p_size passes none: its
-- tickets are counted but hold no bytes. upload_rate_exceeded is the
-- backend's 429
drop function if exists public.register_upload(uuid, uuid, text, text, int);
drop function if exists private.register_upload(uuid, uuid, text, text, int);
create or replace function private.register_upload(
    p_workspace uuid, p_user uuid, p_kind text, p_ext text, p_ttl int, p_size bigint default null
)
returns text
language plpgsql security definer
set search_path = public, extensions
as $$
declare
    gb constant bigint := 1024 * 1024 * 1024;
    v_key text;
    v_size bigint;
    v_quota bigint;
    v_max_entries int;
    v_open bigint;
    v_day_bytes bigint;
    v_day_count bigint;
begin
    perform private.assert_upload_access(p_workspace, p_user, p_kind);
    if p_ext is null or p_ext !~ '^(\.[a-z0-9]{1,16})?$'
       or (p_kind = 'hub_preview' and p_ext !~ '^\.(jpe?g|png|webp)$')
       or p_ttl is null or p_ttl < 1 or p_ttl > 604800 then
        raise exception 'upload: invalid extension or lifetime';
    end if;
    if p_size is not null and p_size < 0 then
        raise exception 'upload: invalid size';
    end if;
    v_size := case when p_kind = 'hub_preview' then 2097152 else p_size end;

    -- one uploader's tickets are counted one at a time, or two requests
    -- could both take the last of the room
    perform pg_advisory_xact_lock(hashtextextended('upload:' || p_user::text, 0));

    select b.quota_bytes, b.max_entries into v_quota, v_max_entries
      from public.workspaces w
      join public.billing_accounts b on b.owner_id = w.owner_id
     where w.id = p_workspace;

    select coalesce(sum(s.size_bytes) filter (
               where s.result is null and s.expires_at > clock_timestamp()), 0),
           coalesce(sum(s.size_bytes) filter (
               where s.created_at > clock_timestamp() - interval '1 day'), 0),
           count(*) filter (where s.created_at > clock_timestamp() - interval '1 day')
      into v_open, v_day_bytes, v_day_count
      from private.upload_sessions s
     where s.uploaded_by = p_user
       and (s.created_at > clock_timestamp() - interval '1 day'
            or (s.result is null and s.expires_at > clock_timestamp()));

    if v_max_entries is not null and v_day_count >= v_max_entries then
        raise exception 'upload_rate_exceeded: too many uploads started today';
    end if;
    if v_size is not null and v_quota is not null then
        if v_day_bytes + v_size > greatest(3 * v_quota, 5 * gb) then
            raise exception 'upload_rate_exceeded: too many uploads started today';
        end if;
        if v_open + v_size > v_quota then
            raise exception 'upload_rate_exceeded: too many unfinished uploads';
        end if;
    end if;

    v_key := 'uploads/' || p_kind || '/' || p_workspace::text || '/' || gen_random_uuid()::text || p_ext;
    insert into private.upload_sessions(storage_key, workspace_id, uploaded_by, kind, expires_at, size_bytes)
    values (v_key, p_workspace, p_user, p_kind,
            clock_timestamp() + make_interval(secs => p_ttl + 1800), v_size);
    return v_key;
end;
$$;

create or replace function public.register_upload(
    p_workspace uuid, p_user uuid, p_kind text, p_ext text, p_ttl int, p_size bigint default null
)
returns text language sql security invoker set search_path = public, extensions
as $$ select private.register_upload(p_workspace, p_user, p_kind, p_ext, p_ttl, p_size); $$;

revoke execute on function private.register_upload(uuid, uuid, text, text, int, bigint) from public, anon, authenticated;
revoke execute on function public.register_upload(uuid, uuid, text, text, int, bigint) from public, anon, authenticated;
grant execute on function private.register_upload(uuid, uuid, text, text, int, bigint) to service_role;
grant execute on function public.register_upload(uuid, uuid, text, text, int, bigint) to service_role;


-- ---------------------------------------------------------------------------
-- П1.10. Usernames that pass for the product are reserved; a released
-- username is held for 90 days. The CHECK on profiles.username calls the
-- function, so existing rows are not re-checked (none uses a new word).
-- ---------------------------------------------------------------------------
-- Mirror of RESERVED_SLUGS in packages/file-manager/src/reserved-slugs.ts:
-- words taken by the app's own top-level routes, and names that would pass
-- for the product or its staff (a board at /support or /pile-commander reads
-- as ours). The client validates too, but a direct PostgREST update must not
-- be able to claim /hub or /login as a profile address. Keep both lists in
-- sync, and the copy in apps/client/middleware.ts
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
        'www', 'mail', 'ftp',
        'pile-commander', 'pilecommander', 'pile', 'official', 'team', 'staff',
        'security', 'billing', 'moderator', 'moderation', 'abuse', 'administrator'
    ]);
$$;

-- ----------------------------------------------------------------------------
-- released_usernames: a username someone gave up, by changing it or by
-- deleting the account. Links to /<username>/<slug> are out in the world;
-- if another account could take the name the next minute, those links would
-- open that account's boards under the old author's name. For 90 days the
-- name can be taken back only by the account that released it. A deleted
-- account's name (released_by null) waits the 90 days out. Pruned daily
-- (released-usernames-prune)
-- ----------------------------------------------------------------------------
create table private.released_usernames (
    username text primary key,
    -- set null on account deletion: nobody can take the name back early
    released_by uuid references auth.users (id) on delete set null,
    released_at timestamptz not null default now()
);
create index released_usernames_by_idx on private.released_usernames (released_by);
create index released_usernames_at_idx on private.released_usernames (released_at);
revoke all on private.released_usernames from public, anon, authenticated;

-- The message says "duplicate key" and the code is unique_violation on
-- purpose: to the person the name is simply taken, and the client already
-- has words for that
create or replace function private.profiles_hold_username()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if NEW.username is not null
       and (TG_OP = 'INSERT' or NEW.username is distinct from OLD.username)
       and exists (
           select 1 from private.released_usernames r
            where r.username = NEW.username
              and r.released_at > now() - interval '90 days'
              and r.released_by is distinct from NEW.id
       ) then
        raise exception 'duplicate key: username "%" is not available', NEW.username
            using errcode = '23505';
    end if;
    return NEW;
end
$$;

create or replace function private.profiles_release_username()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if TG_OP = 'DELETE' then
        if OLD.username is not null then
            insert into private.released_usernames (username, released_by, released_at)
            values (OLD.username, null, now())
            on conflict (username) do update set released_by = null, released_at = now();
        end if;
        return OLD;
    end if;
    if OLD.username is not null and OLD.username is distinct from NEW.username then
        insert into private.released_usernames (username, released_by, released_at)
        values (OLD.username, OLD.id, now())
        on conflict (username) do update set released_by = excluded.released_by, released_at = now();
    end if;
    -- taken back by the account that released it: no longer released
    if NEW.username is not null and NEW.username is distinct from OLD.username then
        delete from private.released_usernames where username = NEW.username;
    end if;
    return NEW;
end
$$;

revoke execute on function private.profiles_hold_username() from public, anon, authenticated;
revoke execute on function private.profiles_release_username() from public, anon, authenticated;

create trigger profiles_hold_username
    before insert or update of username on public.profiles
    for each row execute function private.profiles_hold_username();
create trigger profiles_release_username
    after update of username or delete on public.profiles
    for each row execute function private.profiles_release_username();

-- a released username is free for anyone after 90 days
select cron.schedule(
    'released-usernames-prune',
    '44 3 * * *',
    $$delete from private.released_usernames where released_at < now() - interval '90 days'$$
);


-- ---------------------------------------------------------------------------
-- П1.35. Bytes deleted for good stay in the owner's count while the storage
-- still holds them. Rows already in the queue keep owner_id null and are not
-- counted.
-- ---------------------------------------------------------------------------
alter table public.blob_deletions
    add column if not exists owner_id uuid,
    add column if not exists size_bytes bigint check (size_bytes is null or size_bytes >= 0);
create index if not exists blob_deletions_owner_idx on public.blob_deletions (owner_id) where owner_id is not null;

-- used_bytes also counts what the owner deleted for good while the storage
-- still holds it. A purge takes the bytes out of entries at once, but the
-- objects wait in blob_deletions for the GC (GC_MIN_AGE_HOURS, about a day):
-- upload, purge, upload again — or fork, copy, purge — kept storage above the
-- quota by whatever a day of that loop moved. Ordinary use is left alone:
-- one full turnover of the plan's room, or 1 GiB if that is more, leaves the
-- quota the moment it is purged (emptying the trash to make room works, and
-- so does a file saved many times a day by sync). Only what goes beyond it
-- counts until the GC has removed the objects. A queue row the GC failed to
-- clear in three days is our problem, not the owner's, and stops counting.
-- plpgsql, not sql: blob_deletions is created further down this file
create or replace function private.owner_usage(p_owner uuid)
returns table (
    used_bytes bigint,
    live_bytes bigint,
    trash_bytes bigint
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
    gb constant bigint := 1024 * 1024 * 1024;
    v_live bigint;
    v_trash bigint;
    v_leaving bigint;
    v_turnover bigint;
begin
    select coalesce(sum(e.size_bytes) filter (where e.deleted_at is null and w.deleted_at is null), 0),
           coalesce(sum(e.size_bytes) filter (where e.deleted_at is not null or w.deleted_at is not null), 0)
      into v_live, v_trash
      from public.entries e
      join public.workspaces w on w.id = e.workspace_id
     where w.owner_id = p_owner;

    select coalesce(sum(d.size_bytes), 0) into v_leaving
      from public.blob_deletions d
     where d.owner_id = p_owner
       and d.queued_at > now() - interval '3 days';

    select greatest(b.quota_bytes, gb) into v_turnover
      from public.billing_accounts b
     where b.owner_id = p_owner;

    used_bytes := v_live + v_trash + greatest(0, v_leaving - coalesce(v_turnover, gb));
    live_bytes := v_live;
    trash_bytes := v_trash;
    return next;
end
$$;

-- Any hard delete of a row with a blob (cron, manual trash purge) enqueues
-- the key — the blob is never lost — with the owner of its workspace. When
-- the workspace row is already gone this delete is its cascade, and
-- workspaces_queue_blob_deletion below has queued the workspace's blobs
-- with their owner: the entry's row cannot tell whose they were any more
create or replace function public.entries_queue_blob_deletion()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_owner uuid;
begin
    if OLD.storage_key is null then
        return OLD;
    end if;
    select w.owner_id into v_owner from public.workspaces w where w.id = OLD.workspace_id;
    if not found then
        return OLD;
    end if;
    insert into public.blob_deletions (storage_key, owner_id, size_bytes)
    values (OLD.storage_key, v_owner, OLD.size_bytes);
    return OLD;
end
$$;

-- A workspace deleted whole (purge_workspace, the 30-day cron, the account
-- going) takes its entries by cascade. Its blobs are queued here, before
-- the cascade, while the row still says whose they are. An account that is
-- being deleted has nobody to count them for
create or replace function public.workspaces_queue_blob_deletion()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_owner uuid;
begin
    select u.id into v_owner from auth.users u where u.id = OLD.owner_id;
    insert into public.blob_deletions (storage_key, owner_id, size_bytes)
    select e.storage_key, v_owner, e.size_bytes
      from public.entries e
     where e.workspace_id = OLD.id
       and e.storage_key is not null;
    return OLD;
end
$$;

revoke execute on function public.workspaces_queue_blob_deletion() from public, anon, authenticated;

create trigger workspaces_queue_blob_deletion
    before delete on public.workspaces
    for each row execute function public.workspaces_queue_blob_deletion();

create or replace function private.replace_blob_entry(
    p_entry uuid,
    p_workspace uuid,
    p_storage_key text,
    p_size_bytes bigint,
    p_mime text,
    p_user uuid,
    p_client_id text default null
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_owner uuid;
    v_row public.entries%rowtype;
    v_old_key text;
    v_old_size bigint;
begin
    if p_user is null then
        raise exception 'replace_blob_entry: user is required';
    end if;
    if p_mime is null or p_mime = '' then
        raise exception 'replace_blob_entry: mime is required';
    end if;
    if p_size_bytes is null or p_size_bytes < 0 then
        raise exception 'replace_blob_entry: invalid size %', p_size_bytes;
    end if;
    if p_storage_key is null
       or p_storage_key !~ ('^' || p_workspace::text || '/[0-9a-f-]{36}(\.[a-z0-9]{1,16})?$')
    then
        raise exception 'replace_blob_entry: storage_key does not belong to workspace %', p_workspace;
    end if;

    -- Workspace, then billing, then the row. No FOR UPDATE here: a text save
    -- of this entry holds the billing lock and then takes KEY SHARE for the
    -- entry_contents foreign key, and a row lock taken first deadlocks with
    -- it (lock_workspace_tree). Delete, rename and move are already excluded
    -- by the tree lock. The UPDATE below locks the row after the quota check.
    perform private.lock_workspace_tree(p_workspace);
    select * into v_row from public.entries where id = p_entry;
    if not found
       or v_row.deleted_at is not null
       or v_row.kind <> 'file'
       or v_row.workspace_id <> p_workspace
    then
        raise exception 'replace_blob_entry: entry % not found', p_entry;
    end if;

    select w.owner_id into v_owner from public.workspaces w
     where w.id = p_workspace and w.deleted_at is null;
    if v_owner is null then
        raise exception 'replace_blob_entry: workspace % not found', p_workspace;
    end if;
    if v_owner <> p_user and not exists (
        select 1 from public.workspace_members m
         where m.workspace_id = p_workspace
           and m.user_id = p_user
           and m.role = 'editor'
    ) then
        raise exception 'replace_blob_entry: access denied';
    end if;

    -- A retry whose update already committed: the key is the new one.
    -- Do not enqueue it, and do not charge the quota again.
    if v_row.storage_key = p_storage_key then
        return to_json(v_row);
    end if;

    v_old_key := v_row.storage_key;
    v_old_size := v_row.size_bytes;
    -- Row count does not change, so assert_owner_entries stays out.
    perform private.assert_owner_can_add(v_owner, p_size_bytes - coalesce(v_row.size_bytes, 0), p_size_bytes);

    -- Text and a blob cannot coexist. The guard fires on content writes,
    -- not on this delete, and entries_payload_check allows a file with a key.
    delete from public.entry_contents where entry_id = p_entry;

    -- content_modified_at is set here on purpose: entries_touch leaves it
    -- alone when a row that already had a blob is re-keyed.
    update public.entries
       set storage_key = p_storage_key,
           size_bytes = p_size_bytes,
           mime = p_mime,
           content_modified_at = now(),
           updated_by = p_user,
           updated_by_client = p_client_id
     where id = p_entry
    returning * into v_row;

    -- the replaced bytes stay in the owner's count until the GC removes
    -- the old object (private.owner_usage)
    if v_old_key is not null then
        insert into public.blob_deletions (storage_key, owner_id, size_bytes)
        values (v_old_key, v_owner, v_old_size);
    end if;

    return to_json(v_row);
end
$$;


-- ---------------------------------------------------------------------------
-- П1.6. What the backend's operations watch reads every ten minutes
-- ---------------------------------------------------------------------------
-- ops_snapshot: what the backend's operations watch looks at every ten
-- minutes (apps/backend/src/ops.ts) and mails the operator about. Counts
-- and sizes only, service role only. stored_bytes is every file the entries
-- point at: staging, previews and the deletion queue are not in it.
-- gc_oldest_hours is the age of the oldest row the GC has not given up on.
-- ----------------------------------------------------------------------------
create or replace function private.ops_snapshot(p_gc_max_attempts int)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
    select jsonb_build_object(
        'database_bytes', pg_database_size(current_database()),
        'stored_bytes', (select coalesce(sum(e.size_bytes), 0)
                           from public.entries e where e.storage_key is not null),
        'gc_queue', (select count(*) from public.blob_deletions),
        'gc_dead', (select count(*) from public.blob_deletions d
                     where d.attempts >= p_gc_max_attempts),
        'gc_oldest_hours', (select extract(epoch from now() - min(d.queued_at)) / 3600
                              from public.blob_deletions d
                             where d.attempts < p_gc_max_attempts),
        'mail_complaints_day', (select count(*) from private.mail_events m
                                 where m.kind = 'complaint' and m.created_at > now() - interval '1 day'),
        'mail_bounces_day', (select count(*) from private.mail_events m
                              where m.kind = 'bounce' and m.created_at > now() - interval '1 day')
    );
$$;

create or replace function public.ops_snapshot(p_gc_max_attempts int)
returns jsonb language sql stable security invoker set search_path = public, extensions
as $$ select private.ops_snapshot(p_gc_max_attempts); $$;

revoke execute on function private.ops_snapshot(int) from public, anon, authenticated;
revoke execute on function public.ops_snapshot(int) from public, anon, authenticated;
grant execute on function private.ops_snapshot(int) to service_role;
grant execute on function public.ops_snapshot(int) to service_role;

commit;
