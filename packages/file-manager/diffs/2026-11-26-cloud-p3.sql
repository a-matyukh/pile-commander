-- П3 of the cloud security plan: forward diff for the live database.
-- Apply once, in one transaction. The backend and the web app from
-- feature/cloud-p3 work with the database before and after it, so the order
-- of the deploy and of this diff does not matter (the re-key sweep reads the
-- old list until the new one is there).
-- Rewrites no rows. The three new CHECKs are validated against the rows that
-- exist: on 2026-11-26 none of them broke one (entries and workspaces xattrs,
-- 12 strokes). A row that breaks one by the time of the diff fails the whole
-- transaction and nothing is applied.
-- After it: `bun --filter @pile-commander/file-manager test:rls:remote`,
-- then Advisors.
begin;

-- ---------------------------------------------------------------------------
-- П3.21. The addresses of a folder's members are the owner's alone
-- ---------------------------------------------------------------------------
create or replace function private.list_workspace_members(p_workspace uuid)
returns table (user_id uuid, email text, role text, created_at timestamptz)
language plpgsql
security definer
stable
set search_path = public, extensions
as $$
begin
    if auth.uid() is null then
        raise exception 'list_workspace_members: not authenticated';
    end if;
    if not private.is_workspace_owner(p_workspace) then
        raise exception 'list_workspace_members: access denied';
    end if;

    return query
        select m.user_id, u.email::text, m.role, m.created_at
          from public.workspace_members m
          join auth.users u on u.id = m.user_id
         where m.workspace_id = p_workspace
         order by m.created_at;
end
$$;

-- ---------------------------------------------------------------------------
-- П3.22. A visitor without a session keeps only what a public board needs
-- ---------------------------------------------------------------------------
revoke execute on function public.create_workspace(text) from public, anon;
revoke execute on function public.set_workspace_xattr(uuid, text, text) from public, anon;
revoke execute on function public.create_text_file(uuid, text, text, text, text, uuid, jsonb) from public, anon;
revoke execute on function public.rename_entry(uuid, text, text) from public, anon;
revoke execute on function public.move_entry(uuid, uuid, text, text) from public, anon;
revoke execute on function public.copy_entry(uuid, uuid, text, text) from public, anon;
revoke execute on function public.delete_entry(uuid, text) from public, anon;
revoke execute on function public.sweep_pile_images(uuid, text, text[], text) from public, anon;
revoke execute on function public.restore_entry(uuid, text) from public, anon;
revoke execute on function public.list_trash(uuid) from public, anon;
revoke execute on function public.purge_entry(uuid) from public, anon;
revoke execute on function public.entry_subtree_stamp_at(uuid, text) from public, anon;
revoke execute on function public.delete_moved_entry(uuid, text, text, text) from public, anon;
revoke execute on function public.purge_trash(uuid) from public, anon;
revoke execute on function public.set_workspace_public(uuid, text, boolean) from public, anon;
revoke execute on function public.set_workspace_private(uuid) from public, anon;
revoke execute on function public.set_hub_listing(uuid, text, text[], boolean, text) from public, anon;
revoke execute on function public.remove_from_hub(uuid) from public, anon;
revoke execute on function public.fork_workspace(uuid) from public, anon;
revoke execute on function public.list_workspace_members(uuid) from public, anon;
grant execute on function public.create_workspace(text) to authenticated, service_role;
grant execute on function public.set_workspace_xattr(uuid, text, text) to authenticated, service_role;
grant execute on function public.create_text_file(uuid, text, text, text, text, uuid, jsonb) to authenticated, service_role;
grant execute on function public.rename_entry(uuid, text, text) to authenticated, service_role;
grant execute on function public.move_entry(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.copy_entry(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.delete_entry(uuid, text) to authenticated, service_role;
grant execute on function public.sweep_pile_images(uuid, text, text[], text) to authenticated, service_role;
grant execute on function public.restore_entry(uuid, text) to authenticated, service_role;
grant execute on function public.list_trash(uuid) to authenticated, service_role;
grant execute on function public.purge_entry(uuid) to authenticated, service_role;
grant execute on function public.entry_subtree_stamp_at(uuid, text) to authenticated, service_role;
grant execute on function public.delete_moved_entry(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.purge_trash(uuid) to authenticated, service_role;
grant execute on function public.set_workspace_public(uuid, text, boolean) to authenticated, service_role;
grant execute on function public.set_workspace_private(uuid) to authenticated, service_role;
grant execute on function public.set_hub_listing(uuid, text, text[], boolean, text) to authenticated, service_role;
grant execute on function public.remove_from_hub(uuid) to authenticated, service_role;
grant execute on function public.fork_workspace(uuid) to authenticated, service_role;
grant execute on function public.list_workspace_members(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- П3.27. A fork reads the source without locking it, and refuses a board
-- too large to copy in one statement
-- ---------------------------------------------------------------------------
create or replace function private.fork_workspace(p_workspace uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    -- measured on a laptop: about 60 µs a row, linear (20 000 rows 1.1 s,
    -- 100 000 rows 5.9 s). 30 000 keeps a fork under 2 s there, which leaves
    -- a slower database room under its 8 s
    c_max_rows constant int := 30000;
    v_source public.workspaces%rowtype;
    v_workspace_id uuid;
    v_delta bigint;
    v_rows int;
begin
    if auth.uid() is null then
        raise exception 'fork_workspace: not authenticated';
    end if;
    -- A fork is one call but a copy of every blob (copy-clones), and deleting
    -- the fork frees the quota at once, so fork → copy → delete in a loop
    -- costs storage without any quota. 20 an hour is far above a person.
    -- Counted and recorded under one lock per account, or a burst of
    -- parallel calls would all read the same count
    perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':fork', 44));
    if (select count(*) from private.rate_events r
         where r.actor = auth.uid() and r.action = 'fork'
           and r.created_at > now() - interval '1 hour') >= 20 then
        raise exception 'fork_workspace: too many forks, try again later'
            using errcode = 'P0001';
    end if;
    insert into private.rate_events (actor, action, workspace_id)
    values (auth.uid(), 'fork', p_workspace);
    if not private.can_read_workspace(p_workspace) then
        raise exception 'fork_workspace: workspace % is not public', p_workspace;
    end if;

    select * into v_source from public.workspaces w
     where w.id = p_workspace and w.is_public and w.deleted_at is null;
    if not found then
        raise exception 'fork_workspace: workspace % is not public', p_workspace;
    end if;
    if not v_source.allow_fork then
        raise exception 'fork_workspace: this workspace does not allow forks';
    end if;

    -- an index-only count first: a board over the ceiling is refused before
    -- a single row of it is read
    select count(*) into v_rows
      from public.entries e
     where e.workspace_id = p_workspace
       and e.deleted_at is null;
    if v_rows > c_max_rows then
        raise exception 'fork_workspace: this workspace is too large to fork (% items, the limit is %)',
            v_rows, c_max_rows
            using errcode = 'P0001';
    end if;

    drop table if exists pg_temp.fork_map;
    create temp table fork_map (
        old_id uuid primary key,
        new_id uuid not null,
        old_parent uuid,
        depth int not null,
        name text,
        kind text,
        mime text,
        xattrs jsonb,
        storage_key text,
        size_bytes bigint,
        content text
    ) on commit drop;
    insert into fork_map (old_id, new_id, old_parent, depth, name, kind, mime, xattrs,
                          storage_key, size_bytes, content)
    select e.id, gen_random_uuid(), e.parent_id, nlevel(e.node_path), e.name, e.kind, e.mime,
           e.xattrs, e.storage_key, e.size_bytes, c.content
      from public.entries e
      left join public.entry_contents c on c.entry_id = e.id
     where e.workspace_id = p_workspace
       and e.deleted_at is null;

    select coalesce(sum(m.size_bytes), 0), count(*) into v_delta, v_rows from fork_map m;
    perform private.assert_owner_can_add(auth.uid(), v_delta, null);
    perform private.assert_owner_entries(auth.uid(), v_rows);
    perform private.assert_owner_workspaces(auth.uid());

    insert into public.workspaces (owner_id, name, xattrs)
    values (auth.uid(), v_source.name, v_source.xattrs)
    returning id into v_workspace_id;

    -- by ascending depth: entries_derive_paths reads the parent's row, and a
    -- row trigger sees the rows this same statement has already written
    insert into public.entries (id, workspace_id, parent_id, name, kind, mime, xattrs, storage_key, size_bytes)
    select m.new_id, v_workspace_id, p.new_id, m.name, m.kind, m.mime, m.xattrs,
           m.storage_key,
           -- a text's size is written by entry_contents_touch with its content
           case when m.storage_key is not null then m.size_bytes end
      from fork_map m
      left join fork_map p on p.old_id = m.old_parent
     order by m.depth;

    insert into public.entry_contents (entry_id, workspace_id, content)
    select m.new_id, v_workspace_id, m.content
      from fork_map m
     where m.content is not null;

    insert into public.folder_strokes (id, entry_id, workspace_id, z, position, points,
                                       color, stroke_width, width, height)
    select gen_random_uuid(), m.new_id, v_workspace_id, s.z, s.position, s.points,
           s.color, s.stroke_width, s.width, s.height
      from public.folder_strokes s
      join fork_map m on m.old_id = s.entry_id;

    -- the id is built from the endpoints and their handles, so two source
    -- edges that differ only in other props would mint the same id: the copy
    -- keeps one of them rather than failing the whole fork
    insert into public.folder_connections (id, entry_id, workspace_id, from_entry, to_entry, props)
    select concat(mf.new_id, ':', coalesce(s.props->>'from_handle', 'default'), '-',
                  mt.new_id, ':', coalesce(s.props->>'to_handle', 'default')),
           mf_owner.new_id, v_workspace_id, mf.new_id, mt.new_id,
           s.props
      from public.folder_connections s
      join fork_map mf_owner on mf_owner.old_id = s.entry_id
      join fork_map mf on mf.old_id = s.from_entry
      join fork_map mt on mt.old_id = s.to_entry
    on conflict (workspace_id, id) do nothing;

    -- no-op when the source is not listed on the Hub
    update public.hub_publications h
       set fork_count = fork_count + 1
     where h.source_workspace_id = p_workspace;

    return v_workspace_id;
end
$$;

-- ---------------------------------------------------------------------------
-- П3.28. The re-key list is read on from the last row seen
-- ---------------------------------------------------------------------------
drop function if exists public.list_foreign_blob_entries(int);
drop function if exists private.list_foreign_blob_entries(int);

create or replace function private.list_foreign_blob_entries(
    p_limit int default 100,
    p_after_created timestamptz default null,
    p_after_id uuid default null
)
returns table (id uuid, workspace_id uuid, storage_key text, created_at timestamptz)
language sql
security definer
stable
set search_path = public, extensions
as $$
    -- Trashed rows wait: their copy would only sit in storage until the
    -- purge. Until re-keyed they keep the source's object alive (GC checks
    -- references), and a restore puts them back in this list
    select e.id, e.workspace_id, e.storage_key, e.created_at
      from public.entries e
      join public.workspaces w on w.id = e.workspace_id
     where e.storage_key is not null
       and lower(left(e.storage_key, 36)) <> e.workspace_id::text
       and e.deleted_at is null
       and w.deleted_at is null
       and (p_after_created is null
            or (e.created_at, e.id) > (p_after_created, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid)))
     order by e.created_at, e.id
     limit least(greatest(coalesce(p_limit, 100), 1), 1000);
$$;

create or replace function public.list_foreign_blob_entries(
    p_limit int default 100,
    p_after_created timestamptz default null,
    p_after_id uuid default null
)
returns table (id uuid, workspace_id uuid, storage_key text, created_at timestamptz)
language sql
security invoker
stable
set search_path = public, extensions
as $$
    select * from private.list_foreign_blob_entries(p_limit, p_after_created, p_after_id);
$$;

revoke execute on function public.list_foreign_blob_entries(int, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.list_foreign_blob_entries(int, timestamptz, uuid) to service_role;
revoke execute on function private.list_foreign_blob_entries(int, timestamptz, uuid) from public, anon, authenticated;
grant execute on function private.list_foreign_blob_entries(int, timestamptz, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- П3.29. A cover keeps its object while it can still be published
-- ---------------------------------------------------------------------------
create or replace function private.blob_references(p_keys text[])
returns jsonb
language sql
security definer
stable
set search_path = public, extensions
as $$
    select coalesce(jsonb_object_agg(k, (
        exists (select 1 from public.entries e where e.storage_key = k)
        or exists (select 1 from public.hub_publications h where h.preview_key = k)
        or exists (select 1 from public.entry_derivatives d where d.deriv_key = k)
        -- a Hub cover uploaded or taken off a listing within the week: it may
        -- still be published (schema.sql, hub_preview_uploads)
        or exists (select 1 from private.hub_preview_uploads u
                    where u.storage_key = k and u.created_at > now() - interval '7 days')
    )), '{}'::jsonb)
    from (select distinct unnest(p_keys) as k) keys;
$$;

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
            -- the cover can be listed again for a week (hub_preview_uploads)
            update private.hub_preview_uploads set created_at = now() where storage_key = OLD.preview_key;
        end if;
        return OLD;
    end if;
    if OLD.preview_key is distinct from NEW.preview_key and OLD.preview_key is not null then
        insert into public.blob_deletions (storage_key) values (OLD.preview_key);
        update private.hub_preview_uploads set created_at = now() where storage_key = OLD.preview_key;
    end if;
    return NEW;
end
$$;

select cron.schedule(
    'hub-preview-uploads-prune',
    '46 3 * * *',
    $$delete from private.hub_preview_uploads u
       where u.created_at < now() - interval '30 days'
         and not exists (select 1 from public.hub_publications h where h.preview_key = u.storage_key)$$
);

-- ---------------------------------------------------------------------------
-- П3.29 and П3.30. set_hub_listing: an expired cover upload is refused, and so
-- is a tag with characters nobody sees
-- ---------------------------------------------------------------------------
create or replace function private.set_hub_listing(
    p_workspace uuid,
    p_description text,
    p_tags text[],
    p_allow_fork boolean default true,
    p_preview_key text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_is_public boolean;
    v_tag text;
    v_preview_key text;
    v_max int;
    v_listed bigint;
begin
    if not private.is_workspace_owner(p_workspace) then
        raise exception 'set_hub_listing: only the owner can list on the Hub';
    end if;
    perform private.lock_workspace_tree(p_workspace);

    if not exists (
        select 1 from public.hub_publications h
         where h.source_workspace_id = p_workspace
    ) then
        select b.max_hub_listings into v_max
          from public.billing_accounts b
         where b.owner_id = auth.uid();
        if not found then
            raise exception 'hub_listing_limit: no billing account'
                using errcode = 'P0001',
                      detail = json_build_object('kind', 'hub_limit')::text;
        end if;
        if v_max is not null then
            select count(*) into v_listed
              from public.hub_publications h
             where h.owner_id = auth.uid();
            if v_listed >= v_max then
                raise exception 'hub_listing_limit: % of % Hub listings',
                    v_listed, v_max
                    using errcode = 'P0001',
                          detail = json_build_object(
                              'kind', 'hub_limit',
                              'used_bytes', v_listed,
                              'quota_bytes', v_max
                          )::text;
            end if;
        end if;
    end if;

    select w.is_public into v_is_public
      from public.workspaces w
     where w.id = p_workspace;
    if v_is_public is not true then
        raise exception 'set_hub_listing: make the workspace public first';
    end if;

    -- Lowercase letters of any script, digits and hyphens, 2–32 characters.
    -- ASCII is limited to a-z0-9 and the hyphen; anything from U+00C0 up
    -- passes the range, so the check does not depend on the database locale.
    -- That range also holds characters nobody sees: zero-width ones, the
    -- marks and overrides that turn the direction of the text, blank
    -- fillers, variation selectors, private-use code points. With them two
    -- tags could look the same and be different, or a card's line of tags
    -- could be shown backwards, so they are refused by name (the zero-width
    -- joiners too: a tag is a short label, not running text)
    foreach v_tag in array coalesce(p_tags, '{}') loop
        if v_tag !~ '^[a-z0-9\u00C0-\uFFFF][a-z0-9\u00C0-\uFFFF-]{1,31}$'
           or v_tag <> lower(v_tag)
           or v_tag ~ '[\u034F\u061C\u115F\u1160\u1680\u17B4\u17B5\u180B-\u180F\u2000-\u200F\u2028-\u202F\u205F-\u206F\u2800\u3000\u3164\uE000-\uF8FF\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFFF]' then
            raise exception 'set_hub_listing: invalid tag "%"', v_tag;
        end if;
    end loop;

    v_preview_key := nullif(trim(p_preview_key), '');
    if v_preview_key is not null
       and v_preview_key !~ (
           '^hub/' || p_workspace::text
           || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
       )
    then
        raise exception 'set_hub_listing: invalid preview_key';
    end if;
    -- only objects the backend stat'ed (POST /hub-preview/finalize, size
    -- cap applied) may become a listed preview; a raw PUT is not enough
    if v_preview_key is not null and not exists (
        select 1 from private.hub_preview_uploads u
         where u.storage_key = v_preview_key and u.workspace_id = p_workspace
    ) then
        raise exception 'set_hub_listing: preview upload was not finalized';
    end if;
    -- A cover that is not on this listing already must be recent: its object
    -- is kept for 7 days from the upload (or from leaving a listing), and a
    -- key accepted later could have nothing behind it
    if v_preview_key is not null
       and not exists (
           select 1 from public.hub_publications h
            where h.source_workspace_id = p_workspace and h.preview_key = v_preview_key
       )
       and not exists (
           select 1 from private.hub_preview_uploads u
            where u.storage_key = v_preview_key and u.created_at > now() - interval '6 days'
       )
    then
        raise exception 'set_hub_listing: preview upload expired, upload the picture again';
    end if;

    update public.workspaces
       set allow_fork = coalesce(p_allow_fork, true)
     where id = p_workspace;

    insert into public.hub_publications
        (source_workspace_id, owner_id, description, tags, allow_fork, preview_key)
    values
        (p_workspace, auth.uid(), coalesce(p_description, ''), coalesce(p_tags, '{}'),
         coalesce(p_allow_fork, true), v_preview_key)
    on conflict (source_workspace_id) do update
       set description = excluded.description,
           tags = excluded.tags,
           allow_fork = excluded.allow_fork,
           preview_key = excluded.preview_key;

    perform private.maybe_auto_hide_hub_listing(p_workspace);
end
$$;

-- ---------------------------------------------------------------------------
-- П3.30. Rows a client does not expect: xattrs are strings by name, a
-- stroke's numbers are finite
-- ---------------------------------------------------------------------------
alter table public.workspaces add constraint workspaces_xattrs_strings check (
    jsonb_typeof(xattrs) = 'object'
    and not jsonb_path_exists(xattrs, 'strict $.* ? (@.type() != "string")', '{}', true));
alter table public.entries add constraint entries_xattrs_strings check (
    jsonb_typeof(xattrs) = 'object'
    and not jsonb_path_exists(xattrs, 'strict $.* ? (@.type() != "string")', '{}', true));
alter table public.folder_strokes add constraint folder_strokes_finite check (
    z > '-Infinity' and z < 'Infinity'
    and stroke_width > '-Infinity' and stroke_width < 'Infinity'
    and width > '-Infinity' and width < 'Infinity'
    and height > '-Infinity' and height < 'Infinity');

-- ---------------------------------------------------------------------------
-- П3.33. No previews for the trash
-- ---------------------------------------------------------------------------
create or replace function private.list_pending_derivatives(
    p_kinds text[],
    p_max_attempts int,
    p_limit int default 10
)
returns table (storage_key text, kind text, mime text, size_bytes bigint, attempts int)
language sql
security definer
stable
set search_path = public, extensions
as $$
    select k.storage_key, k.kind, k.mime, k.size_bytes, coalesce(d.attempts, 0)
      from (
          select e.storage_key,
                 case when lower(min(e.mime)) like 'image/%' then 'thumb' else 'poster' end as kind,
                 lower(min(e.mime)) as mime,
                 max(e.size_bytes) as size_bytes,
                 min(e.created_at) as first_seen
            from public.entries e
            join public.workspaces w on w.id = e.workspace_id
           where e.storage_key is not null
             and e.deleted_at is null
             and w.deleted_at is null
             and (lower(e.mime) like 'image/%' or lower(e.mime) like 'video/%')
           group by e.storage_key
      ) k
      left join public.entry_derivatives d
        on d.storage_key = k.storage_key and d.kind = k.kind
     where k.kind = any (p_kinds)
       and (
           d.storage_key is null
           or (d.status = 'failed'
               and d.attempts < p_max_attempts
               and coalesce(d.next_attempt_at, '-infinity'::timestamptz) <= now())
       )
     order by k.first_seen
     limit least(greatest(coalesce(p_limit, 10), 1), 100);
$$;

commit;
