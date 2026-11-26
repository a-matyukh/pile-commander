-- ============================================================================
-- Pile Commander — RPCs for structural tree operations (Supabase)
-- ============================================================================
-- Depends on schema.sql (tables, private access helpers, triggers).
--
-- All functions that change the tree structure (rename/move/copy)
-- live in the private schema as security definer (RLS does not apply inside,
-- so access is checked explicitly) and are called from the client through
-- thin security invoker wrappers in public (supabase.rpc only sees exposed
-- schemas). Column-level grants (schema.sql) prevent clients from touching
-- name/parent_id/path/node_path directly, so these RPCs are the only way to
-- make structural changes — path/node_path cannot drift out of sync.
--
-- Sharing (add/list workspace members, pending invites) follows the same
-- pattern: auth.users is not exposed to clients, so email lookup and member
-- listing also live here under security definer with explicit access checks.
--
-- search_path is pinned to public, extensions rather than '': the ltree
-- extension lives in the extensions schema and its type/operators/functions
-- must resolve both at function validation and at runtime. pg_temp stays out
-- of the path and CREATE on public/extensions is revoked from user roles on
-- Supabase, so shadowing risk is minimal
-- ============================================================================

-- ----------------------------------------------------------------------------
-- assert_owner_workspaces: at most 1000 workspaces per account, trash
-- included. The root entry already counts against max_entries; this bounds
-- the workspace rows themselves (16 KB of xattrs each). Runs under the
-- per-owner advisory lock assert_owner_entries takes right before it
-- ----------------------------------------------------------------------------

create or replace function private.assert_owner_workspaces(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if p_owner is null then
        return;
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 42));
    if (select count(*) from public.workspaces w where w.owner_id = p_owner) >= 1000 then
        raise exception 'workspaces_limit_exceeded: 1000 workspaces per account'
            using errcode = 'P0001';
    end if;
end
$$;

revoke execute on function private.assert_owner_workspaces(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- create_workspace: workspace + root entry (path '/', parent_id null)
-- The root is created in board view by default (xattrs.view).
-- ----------------------------------------------------------------------------

create or replace function private.create_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_workspace_id uuid;
begin
    if auth.uid() is null then
        raise exception 'create_workspace: not authenticated';
    end if;
    if p_name is null or p_name = '' then
        raise exception 'create_workspace: name is required';
    end if;

    perform private.assert_owner_entries(auth.uid(), 1);
    perform private.assert_owner_workspaces(auth.uid());

    insert into public.workspaces (owner_id, name)
    values (auth.uid(), p_name)
    returning id into v_workspace_id;

    insert into public.entries (workspace_id, parent_id, name, kind, xattrs)
    values (v_workspace_id, null, '', 'folder', '{"view": "board"}');

    return v_workspace_id;
end
$$;

-- ----------------------------------------------------------------------------
-- set_workspace_xattr: single-key merge into workspaces.xattrs (jsonb_set),
-- mirroring fm.set_xattr semantics for entries — a whole-object overwrite
-- would lose keys written concurrently. Owner only.
-- ----------------------------------------------------------------------------

create or replace function private.set_workspace_xattr(p_workspace uuid, p_name text, p_value text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if not private.is_workspace_owner(p_workspace) then
        raise exception 'set_workspace_xattr: only the owner can set xattrs';
    end if;
    if p_name is null or p_name = '' then
        raise exception 'set_workspace_xattr: name is required';
    end if;

    -- string values, same convention as entries.xattrs (parsed client-side)
    update public.workspaces w
       set xattrs = jsonb_set(w.xattrs, array[p_name], to_jsonb(p_value), true)
     where w.id = p_workspace;
end
$$;

-- ----------------------------------------------------------------------------
-- merge_entry_xattrs: jsonb merge of attributes into entries of one
-- workspace, addressed by path, in one statement. Replaces the client's
-- read-modify-write set_xattr (two clients writing different keys of one
-- entry no longer clobber each other) and makes bulk layout writes — a pack
-- import, the cloud bridge copy — one round-trip per batch.
-- Items: [{"path": "/a", "xattrs": {"name": "value"}}]; values are strings
-- (the entries.xattrs convention) or null, which removes that key in the same
-- statement (remove_xattr used to rewrite the whole object and could drop a
-- key another client wrote meanwhile). Each path at most once. Refused rows
-- come back instead of aborting the batch: 'missing' (gone, trashed, or not
-- in this workspace — also when it went while this merge waited for its row:
-- a picture freshened at the moment a cleanup drops it must not look saved)
-- and 'too_large' (the result would break the 16 KB xattrs CHECK; the row
-- stays untouched)
-- ----------------------------------------------------------------------------

create or replace function private.merge_entry_xattrs(
    p_workspace uuid,
    p_items jsonb,
    p_client_id text default null
)
returns table (path text, status text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if not private.can_write_workspace(p_workspace) then
        raise exception 'merge_entry_xattrs: access denied';
    end if;
    if jsonb_typeof(p_items) is distinct from 'array' then
        raise exception 'merge_entry_xattrs: items must be an array';
    end if;
    -- CASE, not OR: jsonb_each on a non-object would raise before the type
    -- check had a chance to short-circuit
    if exists (
        select 1
          from jsonb_array_elements(p_items) i
         where case
                   when jsonb_typeof(i->'path') = 'string' and jsonb_typeof(i->'xattrs') = 'object'
                   then exists (
                       select 1 from jsonb_each(i->'xattrs') a
                        where jsonb_typeof(a.value) not in ('string', 'null')
                   )
                   else true
               end
    ) then
        raise exception 'merge_entry_xattrs: every item needs a path and string xattr values';
    end if;
    if (select count(*) <> count(distinct i->>'path') from jsonb_array_elements(p_items) i) then
        raise exception 'merge_entry_xattrs: duplicate paths';
    end if;

    return query
    with items as (
        -- strings to set, and the keys a null removes
        select i->>'path' as item_path,
               jsonb_strip_nulls(i->'xattrs') as patch,
               coalesce(
                   (select array_agg(a.key) from jsonb_each(i->'xattrs') a
                     where jsonb_typeof(a.value) = 'null'),
                   '{}'::text[]
               ) as removed
          from jsonb_array_elements(p_items) i
    ),
    targets as (
        select e.id as entry_id,
               it.item_path,
               (e.xattrs || it.patch) - it.removed as result,
               pg_column_size((e.xattrs || it.patch) - it.removed) <= 16384 as fits
          from items it
          join public.entries e
            on e.workspace_id = p_workspace
           and e.path = it.item_path
           and e.deleted_at is null
    ),
    merged as (
        update public.entries e
           set xattrs = t.result,
               updated_by_client = p_client_id
          from targets t
         where e.id = t.entry_id
           and t.fits
           and e.deleted_at is null
     returning e.id
    )
    select it.item_path,
           case when t.entry_id is not null and not t.fits then 'too_large' else 'missing' end
      from items it
      left join targets t on t.item_path = it.item_path
      left join merged m on m.id = t.entry_id
     where t.entry_id is null
        or not t.fits
        or m.id is null;
end
$$;

-- ----------------------------------------------------------------------------
-- create_text_file: entries row + entry_contents row in one transaction.
-- Clients used to insert the two rows separately and hard-DELETE the first
-- one when the payload insert failed (size gate, quota) — that DELETE grant
-- was the only client path to a hard delete, bypassing the trash, and the
-- rollback left a "create" realtime event without a matching removal on
-- other devices. Direct client INSERTs on entries are folders only now
-- (entries_insert policy); every file row comes from this RPC or from
-- create_blob_entry. The quota and the 8 MB text gate stay where they were:
-- entry_contents_guard fires on the content insert below.
-- p_xattrs lands in the same INSERT: a new note/shape is born with its
-- position, so no realtime refresh can ever show it without one. The
-- signature grew, which create or replace cannot do — hence the drops
-- (the public wrapper is recreated at the bottom)
-- ----------------------------------------------------------------------------

drop function if exists public.create_text_file(uuid, text, text, text, text, uuid);
drop function if exists private.create_text_file(uuid, text, text, text, text, uuid);

create or replace function private.create_text_file(
    p_parent uuid,
    p_name text,
    p_mime text,
    p_content text,
    p_client_id text default null,
    p_id uuid default null,
    p_xattrs jsonb default '{}'
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_parent public.entries%rowtype;
    v_row public.entries%rowtype;
begin
    if auth.uid() is null then
        raise exception 'create_text_file: not authenticated';
    end if;
    if p_mime is null or p_mime = '' then
        raise exception 'create_text_file: mime is required';
    end if;
    -- CASE, not OR: jsonb_each on a non-object would raise first. Parenthesized:
    -- plpgsql ends an IF condition at the first THEN outside parentheses
    if (case
            when p_xattrs is null then false
            when jsonb_typeof(p_xattrs) = 'object'
            then exists (select 1 from jsonb_each(p_xattrs) a where jsonb_typeof(a.value) <> 'string')
            else true
        end) then
        raise exception 'create_text_file: xattrs must be an object of strings';
    end if;

    perform private.lock_entry_workspace(p_parent);
    select * into v_parent from public.entries e
     where e.id = p_parent and e.deleted_at is null;
    if not found then
        raise exception 'create_text_file: parent % not found', p_parent;
    end if;
    if not private.can_write_workspace(v_parent.workspace_id) then
        raise exception 'create_text_file: access denied';
    end if;
    if v_parent.kind <> 'folder' then
        raise exception 'create_text_file: parent % is not a folder', p_parent;
    end if;
    perform private.assert_owner_entries(
        (select w.owner_id from public.workspaces w where w.id = v_parent.workspace_id), 1);

    -- name conflicts are caught by unique(parent_id, name)
    insert into public.entries (id, workspace_id, parent_id, name, kind, mime, xattrs, updated_by_client)
    values (coalesce(p_id, gen_random_uuid()), v_parent.workspace_id, p_parent, p_name, 'file',
            p_mime, coalesce(p_xattrs, '{}'), p_client_id)
    returning * into v_row;

    insert into public.entry_contents (entry_id, workspace_id, content, updated_by_client)
    values (v_row.id, v_parent.workspace_id, coalesce(p_content, ''), p_client_id);

    -- entry_contents_touch already mirrored size_bytes/content_modified_at
    select * into v_row from public.entries e where e.id = v_row.id;
    return to_json(v_row);
end
$$;

-- ----------------------------------------------------------------------------
-- rename_entry: rename within the same parent + rewrite path of all
-- descendants in one UPDATE (the ltree prefix does not change)
-- ----------------------------------------------------------------------------

create or replace function private.rename_entry(p_entry uuid, p_new_name text, p_client_id text default null)
returns table (id uuid, path text, name text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_entry public.entries%rowtype;
    v_parent_path text;
    v_old_path text;
    v_new_path text;
begin
    perform private.lock_entry_workspace(p_entry);
    select * into v_entry from public.entries e
     where e.id = p_entry and e.deleted_at is null;
    if not found then
        raise exception 'rename_entry: entry % not found', p_entry;
    end if;
    if not private.can_write_workspace(v_entry.workspace_id) then
        raise exception 'rename_entry: access denied';
    end if;
    if v_entry.parent_id is null then
        raise exception 'rename_entry: cannot rename workspace root';
    end if;
    if p_new_name = '' or position('/' in p_new_name) > 0 then
        raise exception 'rename_entry: invalid name %', p_new_name;
    end if;

    v_old_path := v_entry.path;
    select e.path into v_parent_path from public.entries e where e.id = v_entry.parent_id;
    v_new_path := case when v_parent_path = '/'
        then '/' || p_new_name
        else v_parent_path || '/' || p_new_name
    end;

    -- name conflicts are caught by unique(parent_id, name)
    update public.entries e
       set name = p_new_name, path = v_new_path, updated_by_client = p_client_id
     where e.id = p_entry;

    update public.entries d
       set path = v_new_path || substring(d.path from length(v_old_path) + 1),
           updated_by_client = p_client_id
     where d.node_path <@ v_entry.node_path
       and d.id <> p_entry;

    return query select p_entry, v_new_path, p_new_name;
end
$$;

-- ----------------------------------------------------------------------------
-- move_entry: move (with optional rename) + rewrite path and node_path
-- of the whole subtree
-- ----------------------------------------------------------------------------

create or replace function private.move_entry(
    p_entry uuid,
    p_target_folder uuid,
    p_new_name text default null,
    p_client_id text default null
)
returns table (id uuid, path text, name text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_entry public.entries%rowtype;
    v_target public.entries%rowtype;
    v_name text;
    v_old_node ltree;
    v_old_path text;
    v_new_node ltree;
    v_new_path text;
begin
    perform private.lock_entry_workspace(p_entry);
    select * into v_entry from public.entries e
     where e.id = p_entry and e.deleted_at is null;
    if not found then
        raise exception 'move_entry: entry % not found', p_entry;
    end if;
    if not private.can_write_workspace(v_entry.workspace_id) then
        raise exception 'move_entry: access denied';
    end if;
    if v_entry.parent_id is null then
        raise exception 'move_entry: cannot move workspace root';
    end if;

    select * into v_target from public.entries e
     where e.id = p_target_folder and e.deleted_at is null;
    if not found then
        raise exception 'move_entry: target % not found', p_target_folder;
    end if;
    if v_target.kind <> 'folder' then
        raise exception 'move_entry: target % is not a folder', p_target_folder;
    end if;
    if v_target.workspace_id <> v_entry.workspace_id then
        raise exception 'move_entry: cross-workspace move is not supported';
    end if;
    if v_target.node_path <@ v_entry.node_path then
        raise exception 'move_entry: cannot move into own subtree';
    end if;

    v_name := coalesce(p_new_name, v_entry.name);
    if v_name = '' or position('/' in v_name) > 0 then
        raise exception 'move_entry: invalid name %', v_name;
    end if;

    v_old_node := v_entry.node_path;
    v_old_path := v_entry.path;
    v_new_node := v_target.node_path || replace(v_entry.id::text, '-', '')::ltree;
    v_new_path := case when v_target.path = '/'
        then '/' || v_name
        else v_target.path || '/' || v_name
    end;

    update public.entries e
       set parent_id = v_target.id, name = v_name, path = v_new_path, node_path = v_new_node,
           updated_by_client = p_client_id
     where e.id = p_entry;

    update public.entries d
       set node_path = v_new_node || subpath(d.node_path, nlevel(v_old_node)),
           path = v_new_path || substring(d.path from length(v_old_path) + 1),
           updated_by_client = p_client_id
     where d.node_path <@ v_old_node
       and d.id <> p_entry;

    return query select p_entry, v_new_path, v_name;
end
$$;

-- ----------------------------------------------------------------------------
-- copy_entry: recursive copy of a subtree into the target folder.
-- Returns the root of the copy. The entries_derive_paths trigger computes
-- path/node_path for each copy from its new parent.
-- ----------------------------------------------------------------------------

create or replace function private.copy_entry(
    p_source uuid,
    p_target_folder uuid,
    p_new_name text default null,
    p_client_id text default null
)
returns table (id uuid, path text, name text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_source public.entries%rowtype;
    v_target public.entries%rowtype;
    -- the loop row carries entry_contents.content alongside e.*, so a
    -- concrete %rowtype does not fit
    v_row record;
    v_new_id uuid;
    v_new_parent_id uuid;
    v_new_name text;
    v_root_id uuid;
    v_delta bigint;
    v_rows int;
begin
    perform private.lock_entry_workspace(p_source);
    select * into v_source from public.entries e
     where e.id = p_source and e.deleted_at is null;
    if not found then
        raise exception 'copy_entry: source % not found', p_source;
    end if;
    if not private.can_write_workspace(v_source.workspace_id) then
        raise exception 'copy_entry: access denied';
    end if;
    if v_source.parent_id is null then
        raise exception 'copy_entry: cannot copy workspace root';
    end if;

    select * into v_target from public.entries e
     where e.id = p_target_folder and e.deleted_at is null;
    if not found then
        raise exception 'copy_entry: target % not found', p_target_folder;
    end if;
    if v_target.kind <> 'folder' then
        raise exception 'copy_entry: target % is not a folder', p_target_folder;
    end if;
    if v_target.workspace_id <> v_source.workspace_id then
        raise exception 'copy_entry: cross-workspace copy is not supported';
    end if;
    if v_target.node_path <@ v_source.node_path then
        raise exception 'copy_entry: cannot copy into own subtree';
    end if;

    select coalesce(sum(e.size_bytes), 0), count(*) into v_delta, v_rows
      from public.entries e
     where e.node_path <@ v_source.node_path
       and e.deleted_at is null;
    perform private.assert_owner_quota(v_source.workspace_id, v_delta, null);
    perform private.assert_owner_entries(
        (select w.owner_id from public.workspaces w where w.id = v_source.workspace_id), v_rows);

    drop table if exists pg_temp.copy_entry_map;
    create temp table copy_entry_map (
        old_id uuid primary key,
        new_id uuid not null
    ) on commit drop;

    -- descendants go by ascending depth: the parent is always already in the map
    for v_row in
        select e.*, c.content as text_content
          from public.entries e
          left join public.entry_contents c on c.entry_id = e.id
         where e.node_path <@ v_source.node_path
           and e.deleted_at is null
        order by nlevel(e.node_path)
    loop
        v_new_id := gen_random_uuid();
        if v_row.id = v_source.id then
            v_new_parent_id := p_target_folder;
            v_new_name := coalesce(p_new_name, v_row.name);
        else
            select m.new_id into v_new_parent_id
              from copy_entry_map m
             where m.old_id = v_row.parent_id;
            v_new_name := v_row.name;
        end if;

        -- the clone shares the original's B2 object permanently: blobs are
        -- immutable (a new upload is a new key) and the GC keeps an object
        -- while any row references it, so a same-workspace copy needs no
        -- re-key. Both rows count toward the quota — "copy" semantics
        insert into public.entries (id, workspace_id, parent_id, name, kind, mime, xattrs, storage_key, size_bytes, updated_by_client)
        values (v_new_id, v_source.workspace_id, v_new_parent_id, v_new_name,
                v_row.kind, v_row.mime, v_row.xattrs, v_row.storage_key,
                case when v_row.storage_key is not null then v_row.size_bytes end,
                p_client_id);

        if v_row.text_content is not null then
            insert into public.entry_contents (entry_id, workspace_id, content, updated_by_client)
            values (v_new_id, v_source.workspace_id, v_row.text_content, p_client_id);
        end if;

        insert into copy_entry_map (old_id, new_id) values (v_row.id, v_new_id);

        if v_row.id = v_source.id then
            v_root_id := v_new_id;
        end if;
    end loop;

    -- ink follows the copied folders; stroke ids are re-minted because the
    -- PK is global and the originals still exist
    insert into public.folder_strokes (id, entry_id, workspace_id, z, position, points,
                                       color, stroke_width, width, height, updated_by_client)
    select gen_random_uuid(), m.new_id, v_source.workspace_id, s.z, s.position, s.points,
           s.color, s.stroke_width, s.width, s.height, p_client_id
      from public.folder_strokes s
      join copy_entry_map m on m.old_id = s.entry_id;

    -- edges follow too, with endpoints remapped onto the clones; the
    -- deterministic id embeds the endpoints, so it is recomputed from the
    -- new ids. Edges pointing outside the copied subtree are skipped
    insert into public.folder_connections (id, entry_id, workspace_id, from_entry, to_entry,
                                           props, updated_by_client)
    select concat(mf.new_id, ':', coalesce(s.props->>'from_handle', 'default'), '-',
                  mt.new_id, ':', coalesce(s.props->>'to_handle', 'default')),
           mf_owner.new_id, v_source.workspace_id, mf.new_id, mt.new_id,
           s.props, p_client_id
      from public.folder_connections s
      join copy_entry_map mf_owner on mf_owner.old_id = s.entry_id
      join copy_entry_map mf on mf.old_id = s.from_entry
      join copy_entry_map mt on mt.old_id = s.to_entry;

    return query select e.id, e.path, e.name from public.entries e where e.id = v_root_id;
end
$$;

-- ----------------------------------------------------------------------------
-- delete_entry: soft delete (trash) — sets deleted_at on the whole subtree
-- in one UPDATE. Hard delete is performed only by pg_cron (schema.sql).
-- ----------------------------------------------------------------------------

create or replace function private.delete_entry(p_entry uuid, p_client_id text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_entry public.entries%rowtype;
begin
    perform private.lock_entry_workspace(p_entry);
    select * into v_entry from public.entries e
     where e.id = p_entry and e.deleted_at is null;
    if not found then
        raise exception 'delete_entry: entry % not found', p_entry;
    end if;
    if not private.can_write_workspace(v_entry.workspace_id) then
        raise exception 'delete_entry: access denied';
    end if;
    if v_entry.parent_id is null then
        raise exception 'delete_entry: cannot delete workspace root';
    end if;

    update public.entries d
       set deleted_at = now(), updated_by_client = p_client_id
     where d.node_path <@ v_entry.node_path
       and d.deleted_at is null;
end
$$;

-- ----------------------------------------------------------------------------
-- restore_entry: restore from the trash. Refuses if the parent is itself in
-- the trash (restore the parent instead). If the name is taken by a live
-- sibling, the root is auto-renamed to "name (n)" — the same rule as the
-- client's resolve_unique_filename (extension preserved).
-- Only the rows trashed together with the root come back: delete_entry
-- stamps the whole subtree with one now() (transaction time), so
-- deleted_at = root.deleted_at identifies exactly that batch. A descendant
-- that had been trashed earlier on its own stays in the trash (and reappears
-- in list_trash once its parent is live again) — restoring it too could
-- collide with a live sibling created since, failing the whole restore.
-- ----------------------------------------------------------------------------

create or replace function private.restore_entry(p_entry uuid, p_client_id text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_entry public.entries%rowtype;
    v_conflict_id uuid;
    v_base text;
    v_ext text;
    v_dot int;
    v_n int;
    v_suffix text;
    v_new_name text;
    v_parent_path text;
    v_old_path text;
    v_new_path text;
begin
    perform private.lock_entry_workspace(p_entry);
    select * into v_entry from public.entries e
     where e.id = p_entry and e.deleted_at is not null;
    if not found then
        raise exception 'restore_entry: entry % not found in trash', p_entry;
    end if;
    if not private.can_write_workspace(v_entry.workspace_id) then
        raise exception 'restore_entry: access denied';
    end if;

    if exists (
        select 1 from public.entries p
        where p.id = v_entry.parent_id and p.deleted_at is not null
    ) then
        raise exception 'restore_entry: parent is in trash, restore the parent folder instead';
    end if;

    select e.id into v_conflict_id
      from public.entries e
     where e.workspace_id = v_entry.workspace_id
       and e.parent_id is not distinct from v_entry.parent_id
       and e.name = v_entry.name
       and e.deleted_at is null
       and e.id <> v_entry.id
     limit 1;
    if v_conflict_id is not null then
        -- split at the last dot like lastIndexOf('.') in resolve_unique_filename
        v_dot := position('.' in reverse(v_entry.name));
        if v_dot = 0 then
            v_base := v_entry.name;
            v_ext := '';
        else
            v_dot := length(v_entry.name) - v_dot + 1;
            v_base := substr(v_entry.name, 1, v_dot - 1);
            v_ext := substr(v_entry.name, v_dot);
        end if;

        v_n := 1;
        loop
            -- " (n)" and the extension always survive; the base is what gives
            -- way, so a 255-char name still passes entries_name_check instead
            -- of making the entry unrestorable
            v_suffix := ' (' || v_n || ')' || v_ext;
            v_new_name := left(v_base, greatest(1, 255 - char_length(v_suffix))) || v_suffix;
            exit when not exists (
                select 1 from public.entries e
                 where e.workspace_id = v_entry.workspace_id
                   and e.parent_id is not distinct from v_entry.parent_id
                   and e.name = v_new_name
                   and e.deleted_at is null
                   and e.id <> v_entry.id
            );
            v_n := v_n + 1;
        end loop;

        -- rename the trashed root and rewrite descendant paths (node_path
        -- is unchanged, like rename_entry)
        select e.path into v_parent_path from public.entries e where e.id = v_entry.parent_id;
        v_old_path := v_entry.path;
        v_new_path := case when v_parent_path = '/'
            then '/' || v_new_name
            else v_parent_path || '/' || v_new_name
        end;

        update public.entries e
           set name = v_new_name, path = v_new_path, updated_by_client = p_client_id
         where e.id = p_entry;

        update public.entries d
           set path = v_new_path || substring(d.path from length(v_old_path) + 1),
               updated_by_client = p_client_id
         where d.node_path <@ v_entry.node_path
           and d.id <> p_entry;
    end if;

    update public.entries d
       set deleted_at = null, updated_by_client = p_client_id
     where d.node_path <@ v_entry.node_path
       and d.deleted_at = v_entry.deleted_at;
end
$$;

-- ----------------------------------------------------------------------------
-- list_trash: top level of the trash (entry deleted, parent alive) with
-- subtree aggregates — the UI shows "340 files, 1.2 GB" and how much space
-- a purge would free
-- ----------------------------------------------------------------------------

create or replace function private.list_trash(p_workspace uuid)
returns table (
    id uuid,
    path text,
    name text,
    kind text,
    size_bytes bigint,
    deleted_at timestamptz,
    subtree_bytes bigint,
    subtree_files bigint
)
language plpgsql
security definer
stable
set search_path = public, extensions
as $$
begin
    if not private.can_write_workspace(p_workspace) then
        raise exception 'list_trash: access denied';
    end if;

    return query
        select e.id, e.path, e.name, e.kind, e.size_bytes, e.deleted_at,
               coalesce(sum(d.size_bytes), 0)::bigint,
               count(d.id) filter (where d.kind = 'file')::bigint
          from public.entries e
          left join public.entries d
            on d.workspace_id = e.workspace_id
           and d.node_path <@ e.node_path
           and d.deleted_at is not null
         where e.workspace_id = p_workspace
           and e.deleted_at is not null
           and not exists (
               select 1 from public.entries p
                where p.id = e.parent_id
                  and p.deleted_at is not null
           )
         group by e.id
         order by e.deleted_at desc;
end
$$;

-- ----------------------------------------------------------------------------
-- workspace_usage: space accounting for quotas. The trash COUNTS — blobs in
-- B2 live until hard delete, otherwise the trash would be free unlimited
-- storage
-- ----------------------------------------------------------------------------

create or replace function private.workspace_usage(p_workspace uuid)
returns table (
    live_bytes bigint,
    trash_bytes bigint,
    live_files bigint,
    trash_files bigint
)
language plpgsql
security definer
stable
set search_path = public, extensions
as $$
begin
    if not private.can_read_workspace(p_workspace) then
        raise exception 'workspace_usage: access denied';
    end if;

    return query
        select
            coalesce(sum(e.size_bytes) filter (where e.deleted_at is null), 0)::bigint,
            coalesce(sum(e.size_bytes) filter (where e.deleted_at is not null), 0)::bigint,
            count(e.id) filter (where e.deleted_at is null and e.kind = 'file')::bigint,
            count(e.id) filter (where e.deleted_at is not null and e.kind = 'file')::bigint
          from public.entries e
         where e.workspace_id = p_workspace;
end
$$;

-- ----------------------------------------------------------------------------
-- Public egress metering (apps/backend/src/egress.ts). GET /presign and
-- GET /hub-preview resolve their target through the two readers under the
-- caller's JWT — the access check is the same as reading the row — then the
-- backend meters non-members in memory and flushes through egress_sync.
-- ----------------------------------------------------------------------------

-- One scalar JSON result, never a capped PostgREST rowset. Each queued key
-- needs an explicit answer, regardless of how many copies reference it.
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

create or replace function public.blob_references(p_keys text[])
returns jsonb
language sql
security invoker
stable
set search_path = public, extensions
as $$ select private.blob_references(p_keys); $$;

revoke execute on function private.blob_references(text[]) from public, anon, authenticated;
revoke execute on function public.blob_references(text[]) from public, anon, authenticated;
grant execute on function private.blob_references(text[]) to service_role;
grant execute on function public.blob_references(text[]) to service_role;

-- download_target: the blob behind one live file entry the caller can read,
-- the owner to charge, and whether the caller is exempt (owner or member).
-- Attribution is by entry, not by key: forks keep the source prefix until
-- they are re-keyed, and copies share one object. No row = missing, no
-- access, trashed or not a blob — one answer, so existence is not leaked.
-- deriv_* is the ready preview of the blob (entry_derivatives), null while
-- there is none: GET /presign serves it to non-members instead of the
-- original. allow_download: the board is public and its author allows forks
-- and downloads as .pile, so a signed-in non-member may ask for the original
-- itself (GET /presign?original=1, charged to the downloader). The return
-- type changed, which create or replace cannot do — hence the drops (the
-- public wrapper is recreated at the bottom)
drop function if exists public.download_target(uuid);
drop function if exists private.download_target(uuid);

create or replace function private.download_target(p_entry uuid)
returns table (
    owner_id uuid,
    storage_key text,
    size_bytes bigint,
    is_member boolean,
    deriv_key text,
    deriv_size_bytes bigint,
    deriv_kind text,
    allow_download boolean
)
language sql
security definer
stable
set search_path = public, extensions
as $$
    select w.owner_id,
           e.storage_key,
           e.size_bytes,
           private.is_workspace_owner(e.workspace_id) or private.is_workspace_member(e.workspace_id),
           d.deriv_key,
           d.deriv_size_bytes,
           d.kind,
           w.is_public and w.allow_fork
      from public.entries e
      join public.workspaces w on w.id = e.workspace_id
      left join lateral (
          select x.deriv_key, x.deriv_size_bytes, x.kind
            from public.entry_derivatives x
           where x.storage_key = e.storage_key
             and x.status = 'ready'
           order by x.kind
           limit 1
      ) d on true
     where e.id = p_entry
       and e.deleted_at is null
       and e.storage_key is not null
       and private.can_read_workspace(e.workspace_id);
$$;

-- hub_preview_target: owner and size of a currently listed Hub preview. The
-- size comes from the finalize registry; the 2 MiB cap stands in if the
-- registry row is gone. Visibility mirrors hub_publications_select: a listing
-- hidden by three reports or by a moderator stops serving its cover to
-- visitors holding the key, while the owner (and an admin) keep seeing it in
-- the Publish dialog, where RLS already shows them the hidden card
create or replace function private.hub_preview_target(p_key text)
returns table (owner_id uuid, size_bytes bigint)
language sql
security definer
stable
set search_path = public, extensions
as $$
    select h.owner_id, coalesce(u.size_bytes, 2097152)::bigint
      from public.hub_publications h
      left join private.hub_preview_uploads u on u.storage_key = h.preview_key
     where h.preview_key = p_key
       and (
           h.hidden_at is null
           or h.owner_id = (select auth.uid())
           or private.is_admin()
       )
     limit 1;
$$;

-- egress_sync: the backend's once-a-minute flush of metered bytes, and its
-- state reads. p_rows = [{owner_id, day, bytes}]: rows with bytes > 0 are
-- added to egress_daily, zero-byte rows only ask for state. Returns, for
-- every distinct owner in p_rows that still exists, today's and this UTC
-- month's totals plus the plan limits. p_today comes from the backend so a
-- flush around midnight cannot split between two clocks. Accounts deleted
-- between sign and flush are skipped: a FK error would fail the batch on
-- every retry
create or replace function private.egress_sync(p_today date, p_rows jsonb)
returns table (
    owner_id uuid,
    day_bytes bigint,
    month_bytes bigint,
    egress_bytes_month bigint,
    max_public_file_bytes bigint
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
    v_month date;
begin
    if p_today is null or jsonb_typeof(p_rows) is distinct from 'array' then
        raise exception 'egress_sync: expected a date and a JSON array';
    end if;
    v_month := make_date(extract(year from p_today)::int, extract(month from p_today)::int, 1);

    insert into public.egress_daily as d (owner_id, day, bytes)
    select r.owner_id, r.day, sum(r.bytes)
      from jsonb_to_recordset(p_rows) as r(owner_id uuid, day date, bytes bigint)
     where r.bytes > 0
       and exists (select 1 from public.billing_accounts b where b.owner_id = r.owner_id)
     group by r.owner_id, r.day
    on conflict (owner_id, day) do update
       set bytes = d.bytes + excluded.bytes;

    return query
        select b.owner_id,
               coalesce((select x.bytes from public.egress_daily x
                          where x.owner_id = b.owner_id and x.day = p_today), 0)::bigint,
               coalesce((select sum(x.bytes) from public.egress_daily x
                          where x.owner_id = b.owner_id
                            and x.day between v_month and p_today), 0)::bigint,
               b.egress_bytes_month,
               b.max_public_file_bytes
          from public.billing_accounts b
         where b.owner_id in (select r.owner_id
                                from jsonb_to_recordset(p_rows) as r(owner_id uuid));
end
$$;

-- download_sync: the same flush for the Download as .pile ledger. p_rows =
-- [{user_id, day, bytes}] of the accounts that downloaded originals; returns
-- their totals and download_bytes_month. Deleted accounts are skipped, as
-- above
create or replace function private.download_sync(p_today date, p_rows jsonb)
returns table (
    user_id uuid,
    day_bytes bigint,
    month_bytes bigint,
    download_bytes_month bigint
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
    v_month date;
begin
    if p_today is null or jsonb_typeof(p_rows) is distinct from 'array' then
        raise exception 'download_sync: expected a date and a JSON array';
    end if;
    v_month := make_date(extract(year from p_today)::int, extract(month from p_today)::int, 1);

    insert into public.download_daily as d (user_id, day, bytes)
    select r.user_id, r.day, sum(r.bytes)
      from jsonb_to_recordset(p_rows) as r(user_id uuid, day date, bytes bigint)
     where r.bytes > 0
       and exists (select 1 from public.billing_accounts b where b.owner_id = r.user_id)
     group by r.user_id, r.day
    on conflict (user_id, day) do update
       set bytes = d.bytes + excluded.bytes;

    return query
        select b.owner_id,
               coalesce((select x.bytes from public.download_daily x
                          where x.user_id = b.owner_id and x.day = p_today), 0)::bigint,
               coalesce((select sum(x.bytes) from public.download_daily x
                          where x.user_id = b.owner_id
                            and x.day between v_month and p_today), 0)::bigint,
               b.download_bytes_month
          from public.billing_accounts b
         where b.owner_id in (select r.user_id
                                from jsonb_to_recordset(p_rows) as r(user_id uuid));
end
$$;

-- ----------------------------------------------------------------------------
-- folder_read: folder + its live children in one roundtrip. Opening a folder
-- used to cost two sequential calls (resolve by path, then select children).
-- Access is checked before the path lookup so we don't leak the existence of
-- other workspaces' paths. The 'entry not found' wording matters: the
-- client's is_missing_path_error matches /not found/i.
-- ----------------------------------------------------------------------------

create or replace function private.folder_read(p_workspace uuid, p_path text)
returns json
language plpgsql
security definer
stable
set search_path = public, extensions
as $$
declare
    v_folder public.entries%rowtype;
    v_children json;
begin
    if not private.can_read_workspace(p_workspace) then
        raise exception 'folder_read: access denied';
    end if;

    select * into v_folder from public.entries e
     where e.workspace_id = p_workspace
       and e.path = p_path
       and e.deleted_at is null;
    if not found then
        raise exception 'entry not found: %', p_path;
    end if;

    select coalesce(json_agg(c order by c.name), '[]'::json) into v_children
      from public.entries c
     where c.parent_id = v_folder.id
       and c.deleted_at is null;

    return json_build_object('folder', to_json(v_folder), 'children', v_children);
end
$$;

-- ----------------------------------------------------------------------------
-- purge_entry / purge_trash: explicit hard delete from the trash. The
-- entries_queue_blob_deletion trigger enqueues the storage_key of every
-- deleted row into blob_deletions; the GC worker removes B2 objects
-- asynchronously.
--
-- Deleting for good is the owner's alone, here and in delete_moved_entry and
-- sweep_pile_images below. An editor may move anything to the trash, where
-- the owner has 30 days to bring it back (purge_expired_entries); an editor
-- who could also empty the trash would erase the owner's files with nothing
-- left to restore.
-- ----------------------------------------------------------------------------

create or replace function private.purge_entry(p_entry uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_entry public.entries%rowtype;
begin
    perform private.lock_entry_workspace(p_entry);
    select * into v_entry from public.entries e
     where e.id = p_entry and e.deleted_at is not null;
    if not found then
        raise exception 'purge_entry: entry % not found in trash', p_entry;
    end if;
    if not private.is_workspace_owner(v_entry.workspace_id) then
        raise exception 'purge_entry: access denied, only the owner deletes for good';
    end if;

    delete from public.entries d
     where d.node_path <@ v_entry.node_path
       and d.deleted_at is not null;
end
$$;

-- ----------------------------------------------------------------------------
-- sweep_pile_images: the folder's spare cover / background files, dropped in
-- one call (the client used to read `.pile`, then delete and purge file by
-- file). A file of a requested role goes when that role's attribute does not
-- name it AND it is at least an hour older than the folder's own updated_at —
-- server clocks only, read from the locked folder row. Younger means its
-- attribute may not be written yet (the next picture, another device's, an
-- old one just chosen again and freshened): it stays for a later sweep.
-- The age check is inside the UPDATE, so a freshen that commits first is seen
-- (READ COMMITTED re-checks the row); one that comes after finds the row gone
-- and gets 'missing' from merge_entry_xattrs — the client uploads again.
-- Soft delete, then hard delete in one transaction, as delete_moved_entry:
-- watchers get the removal and nothing is left in the trash (the blob goes to
-- blob_deletions through the trigger). By path: one round trip. Lock order:
-- workspace (lock_entry_workspace) → folder row → files. Returns how many.
-- Only the owner's call drops anything: an editor's leaves the spare files
-- where they are (hidden, in `.pile`) for the owner's next sweep, rather than
-- putting pictures with machine names into the trash.
-- ----------------------------------------------------------------------------

create or replace function private.sweep_pile_images(
    p_workspace uuid,
    p_path text,
    p_roles text[],
    p_client_id text default null
)
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_id uuid;
    v_folder public.entries%rowtype;
    v_pile uuid;
    v_keep text[];
    v_ids uuid[];
begin
    select e.id into v_id from public.entries e
     where e.workspace_id = p_workspace and e.path = p_path and e.deleted_at is null;
    if v_id is null then
        return 0;
    end if;
    perform private.lock_entry_workspace(v_id);
    if not private.is_workspace_owner(p_workspace) then
        return 0;
    end if;
    select * into v_folder from public.entries e
     where e.id = v_id and e.deleted_at is null
       for update;
    if not found or v_folder.kind <> 'folder' then
        return 0;
    end if;
    select e.id into v_pile from public.entries e
     where e.parent_id = v_folder.id and e.name = '.pile' and e.kind = 'folder' and e.deleted_at is null;
    if v_pile is null then
        return 0;
    end if;
    -- the file each requested role names now (`pile:<role>-<hash8>.webp`)
    select coalesce(array_agg(substr(v_folder.xattrs->>r, 6)), '{}')
      into v_keep
      from unnest(p_roles) r
     where v_folder.xattrs->>r ~ ('^pile:' || r || '-[0-9a-f]{8}\.webp$');
    with dropped as (
        update public.entries f
           set deleted_at = now(), updated_by_client = p_client_id
         where f.parent_id = v_pile
           and f.kind = 'file'
           and f.deleted_at is null
           and f.name ~ '^(cover|background)-[0-9a-f]{8}\.webp$'
           and split_part(f.name, '-', 1) = any (p_roles)
           and not (f.name = any (v_keep))
           and f.updated_at <= v_folder.updated_at - interval '1 hour'
     returning f.id
    )
    select coalesce(array_agg(d.id), '{}') into v_ids from dropped d;
    if cardinality(v_ids) = 0 then
        return 0;
    end if;
    delete from public.entries d where d.id = any (v_ids);
    return cardinality(v_ids);
end
$$;

-- ----------------------------------------------------------------------------
-- Moving a folder to another workspace. The cloud forbids moves across
-- workspaces, so the client copies the folder there, then removes the source
-- with delete_moved_entry. A move must look like a move: nothing left in the
-- trash. And it must never lose what someone else did meanwhile.
--
-- entry_subtree_fingerprint: md5 over the subtree's entries (id, updated_at,
-- deleted_at — a text save updates entries too, entry_contents_touch), the
-- ink of its folders and every edge that touches it: owned by a folder in it,
-- or pointing at an entry in it from the parent's canvas (those edges go with
-- a hard delete, the from_entry/to_entry FKs cascade). Any change to any of
-- them changes the fingerprint.
--
-- entry_subtree_stamp_at: the live entry at a path and its fingerprint, read
-- together, so the id the client deletes later is the folder it is copying.
--
-- delete_moved_entry: under the workspace lock, locks the subtree's rows in
-- the order a text save takes them (entry_contents, then entries — the
-- reverse would deadlock with entry_contents_touch), then its ink and edges,
-- so nothing changes between the check and the delete. Then:
--   'changed' — the folder moved away from the copied path, or anything in
--               it changed since the stamp: nothing is deleted (the client
--               keeps both and says so);
--   'trashed' — an item trashed earlier lives inside it, which a hard delete
--               would cascade to (entries.parent_id): soft delete only, so
--               that item can still be restored. The same for anyone but the
--               owner: an editor's move leaves the source in the trash;
--   'deleted' — soft delete (so watchers get the removal: Realtime trims a
--               hard DELETE to its key) and hard delete in one transaction:
--               the move leaves nothing in the trash;
--   'gone'    — someone deleted the folder already (trash or purge): the copy
--               stands, and their delete is theirs to undo.
-- ----------------------------------------------------------------------------

create or replace function private.entry_subtree_fingerprint(p_node_path ltree)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
    select md5(
        coalesce((
            select string_agg(e.id::text || ':' || e.updated_at::text || ':' || coalesce(e.deleted_at::text, ''),
                              ',' order by e.id)
              from public.entries e
             where e.node_path <@ p_node_path
        ), '')
        || '|' ||
        coalesce((
            select string_agg(s.id::text || ':' || s.updated_at::text, ',' order by s.id)
              from public.folder_strokes s
              join public.entries e on e.id = s.entry_id
             where e.node_path <@ p_node_path
        ), '')
        || '|' ||
        coalesce((
            select string_agg(c.id || ':' || c.entry_id::text || ':' || c.updated_at::text, ',' order by c.entry_id, c.id)
              from public.folder_connections c
             where exists (
                select 1 from public.entries e
                 where e.node_path <@ p_node_path
                   and e.id in (c.entry_id, c.from_entry, c.to_entry)
             )
        ), '')
    );
$$;

create or replace function private.entry_subtree_stamp_at(p_workspace uuid, p_path text)
returns table (entry_id uuid, stamp text)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
    v_entry public.entries%rowtype;
begin
    if not private.can_write_workspace(p_workspace) then
        raise exception 'entry_subtree_stamp_at: access denied';
    end if;
    select * into v_entry from public.entries e
     where e.workspace_id = p_workspace and e.path = p_path and e.deleted_at is null;
    if not found then
        raise exception 'entry_subtree_stamp_at: no entry at %', p_path;
    end if;
    entry_id := v_entry.id;
    stamp := private.entry_subtree_fingerprint(v_entry.node_path);
    return next;
end
$$;

create or replace function private.delete_moved_entry(
    p_entry uuid,
    p_stamp text,
    p_path text,
    p_client_id text default null
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_entry public.entries%rowtype;
begin
    -- Purged meanwhile: nothing to lock or to remove
    if not exists (select 1 from public.entries e where e.id = p_entry) then
        return 'gone';
    end if;
    perform private.lock_entry_workspace(p_entry);
    select * into v_entry from public.entries e where e.id = p_entry;
    if not found or v_entry.deleted_at is not null then
        return 'gone';
    end if;
    if not private.can_write_workspace(v_entry.workspace_id) then
        raise exception 'delete_moved_entry: access denied';
    end if;
    if v_entry.parent_id is null then
        raise exception 'delete_moved_entry: cannot delete workspace root';
    end if;

    perform 1 from public.entry_contents c
      join public.entries e on e.id = c.entry_id
     where e.node_path <@ v_entry.node_path
       for update of c;
    perform 1 from public.entries e
     where e.node_path <@ v_entry.node_path
       for update;
    perform 1 from public.folder_strokes s
      join public.entries e on e.id = s.entry_id
     where e.node_path <@ v_entry.node_path
       for update of s;
    perform 1 from public.folder_connections c
     where exists (
        select 1 from public.entries e
         where e.node_path <@ v_entry.node_path
           and e.id in (c.entry_id, c.from_entry, c.to_entry)
     )
       for update of c;

    -- Re-read: a move or a delete committed while this call waited for the locks
    select * into v_entry from public.entries e where e.id = p_entry;
    if not found or v_entry.deleted_at is not null then
        return 'gone';
    end if;
    if v_entry.path is distinct from p_path
       or private.entry_subtree_fingerprint(v_entry.node_path) is distinct from p_stamp then
        return 'changed';
    end if;

    if not private.is_workspace_owner(v_entry.workspace_id)
       or exists (
        select 1 from public.entries d
         where d.node_path <@ v_entry.node_path
           and d.deleted_at is not null
    ) then
        perform private.delete_entry(p_entry, p_client_id);
        return 'trashed';
    end if;

    perform private.delete_entry(p_entry, p_client_id);
    delete from public.entries d
     where d.node_path <@ v_entry.node_path;
    return 'deleted';
end
$$;

revoke execute on function private.entry_subtree_fingerprint(ltree) from public, anon, authenticated;

create or replace function private.purge_trash(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if not private.is_workspace_owner(p_workspace) then
        raise exception 'purge_trash: access denied, only the owner deletes for good';
    end if;
    perform private.lock_workspace_tree(p_workspace);

    delete from public.entries d
     where d.workspace_id = p_workspace
       and d.deleted_at is not null;
end
$$;

-- ----------------------------------------------------------------------------
-- set_workspace_public: flip the SAME workspace to a live public link at
-- /<username>/<slug>. No snapshot clone. Username is required (first URL
-- segment). Slug uniqueness is per-owner (workspaces_slug_per_owner);
-- reserved-slugs.ts guards usernames in the app. Re-calling with a new
-- slug changes the address; the previous URL 404s. Hub listing (if any)
-- stays on this id.
-- ----------------------------------------------------------------------------

create or replace function private.set_workspace_public(
    p_workspace uuid,
    p_slug text,
    p_allow_fork boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_workspace public.workspaces%rowtype;
begin
    if not private.is_workspace_owner(p_workspace) then
        raise exception 'set_workspace_public: only the owner can make a workspace public';
    end if;
    perform private.lock_workspace_tree(p_workspace);

    if not exists (
        select 1 from public.profiles p
         where p.id = auth.uid() and p.username is not null
    ) then
        raise exception 'set_workspace_public: set a username before making a workspace public';
    end if;

    if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{2,63}$' then
        raise exception 'set_workspace_public: invalid slug';
    end if;

    select * into v_workspace from public.workspaces w
     where w.id = p_workspace and w.deleted_at is null;
    if not found then
        raise exception 'set_workspace_public: workspace % not found', p_workspace;
    end if;

    update public.workspaces
       set is_public = true,
           slug = p_slug,
           allow_fork = coalesce(p_allow_fork, true),
           published_at = coalesce(published_at, now())
     where id = p_workspace;

    -- keep a Hub card's allow_fork in sync when the listing already exists
    update public.hub_publications
       set allow_fork = coalesce(p_allow_fork, true)
     where source_workspace_id = p_workspace;
end
$$;

-- ----------------------------------------------------------------------------
-- set_workspace_private: drop the public link. Hub listing is removed
-- (no cascade from a non-delete). Owner only.
-- ----------------------------------------------------------------------------

create or replace function private.set_workspace_private(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if not private.is_workspace_owner(p_workspace) then
        raise exception 'set_workspace_private: only the owner can make a workspace private';
    end if;
    perform private.lock_workspace_tree(p_workspace);

    delete from public.hub_publications h
     where h.source_workspace_id = p_workspace;

    update public.workspaces
       set is_public = false,
           slug = null,
           published_at = null
     where id = p_workspace;
end
$$;

-- ----------------------------------------------------------------------------
-- A top-level cloud folder (the workspace row) in the trash. Members and
-- invites stay. Publication is dropped the same way as set_workspace_private,
-- before deleted_at, while is_workspace_owner still sees the row.
-- ----------------------------------------------------------------------------

create or replace function private.trash_workspace(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_owner uuid;
begin
    if auth.uid() is null then
        raise exception 'trash_workspace: not authenticated';
    end if;
    select w.owner_id into v_owner
      from public.workspaces w
     where w.id = p_workspace
       and w.deleted_at is null;
    if v_owner is null or v_owner <> auth.uid() then
        raise exception 'trash_workspace: only the owner can trash a workspace';
    end if;
    perform private.lock_workspace_tree(p_workspace);
    perform private.set_workspace_private(p_workspace);
    update public.workspaces
       set deleted_at = now()
     where id = p_workspace
       and deleted_at is null;
end
$$;

create or replace function private.restore_workspace(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_owner uuid;
begin
    if auth.uid() is null then
        raise exception 'restore_workspace: not authenticated';
    end if;
    select w.owner_id into v_owner
      from public.workspaces w
     where w.id = p_workspace
       and w.deleted_at is not null;
    if v_owner is null or v_owner <> auth.uid() then
        raise exception 'restore_workspace: not in your trash';
    end if;
    perform private.lock_workspace_tree(p_workspace);
    update public.workspaces
       set deleted_at = null
     where id = p_workspace
       and owner_id = auth.uid()
       and deleted_at is not null;
end
$$;

create or replace function private.purge_workspace(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_owner uuid;
begin
    if auth.uid() is null then
        raise exception 'purge_workspace: not authenticated';
    end if;
    select w.owner_id into v_owner
      from public.workspaces w
     where w.id = p_workspace
       and w.deleted_at is not null;
    if v_owner is null or v_owner <> auth.uid() then
        raise exception 'purge_workspace: not in your trash';
    end if;
    perform private.lock_workspace_tree(p_workspace);
    delete from public.workspaces
     where id = p_workspace
       and owner_id = auth.uid()
       and deleted_at is not null;
end
$$;

create or replace function private.list_trashed_workspaces()
returns table (id uuid, name text, deleted_at timestamptz, size_bytes bigint)
language sql
security definer
stable
set search_path = public, extensions
as $$
    select w.id,
           w.name,
           w.deleted_at,
           coalesce((
               select sum(e.size_bytes) from public.entries e where e.workspace_id = w.id
           ), 0)::bigint
      from public.workspaces w
     where w.owner_id = auth.uid()
       and w.deleted_at is not null
     order by w.deleted_at desc;
$$;

-- Why a linked folder's cloud root disappeared. A stranger learns nothing
-- about the trash: a foreign id is 'gone', the same as a purged row.
create or replace function private.workspace_state(p_workspace uuid)
returns text
language plpgsql
security definer
stable
set search_path = public, extensions
as $$
declare
    v_deleted timestamptz;
    v_owner uuid;
    v_known boolean;
begin
    if auth.uid() is null then
        return 'gone';
    end if;
    select w.deleted_at, w.owner_id into v_deleted, v_owner
      from public.workspaces w
     where w.id = p_workspace;
    if not found then
        return 'gone';
    end if;
    v_known := v_owner = auth.uid() or exists (
        select 1 from public.workspace_members m
         where m.workspace_id = p_workspace and m.user_id = auth.uid()
    );
    if v_deleted is not null then
        return case when v_known then 'trashed' else 'gone' end;
    end if;
    if private.can_read_workspace(p_workspace) then
        return 'live';
    end if;
    return 'gone';
end
$$;

-- ----------------------------------------------------------------------------
-- set_hub_listing / remove_from_hub: the /hub gallery rows. Owner only; the
-- workspace must already be public (the card links to /<username>/<slug>).
-- Description, tags, and preview_key are optional; each tag is lowercase
-- letters of any script, digits and hyphens. preview_key is a B2 object
-- hub/<workspace_id>/<uuid>.ext (empty/null = no preview) that the backend
-- has finalized (private.hub_preview_uploads, size-capped). Upsert keeps
-- listed_at stable on re-edits. Delisting does not make the workspace private.
-- ----------------------------------------------------------------------------

drop function if exists public.set_hub_listing(uuid, text, text[], boolean);
drop function if exists private.set_hub_listing(uuid, text, text[], boolean);

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

create or replace function private.remove_from_hub(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if not private.is_workspace_owner(p_workspace) then
        raise exception 'remove_from_hub: only the owner can delist from the Hub';
    end if;
    perform private.lock_workspace_tree(p_workspace);

    delete from public.hub_publications h
     where h.source_workspace_id = p_workspace;
end
$$;

-- ----------------------------------------------------------------------------
-- report_hub_listing: authenticated visitors, not the owner. One row per
-- (workspace, reporter). Every report is stored and reaches the moderator;
-- which ones count toward auto-hide is maybe_auto_hide_hub_listing's rule
-- (schema.sql). 20 reports / reporter / day.
-- ----------------------------------------------------------------------------

create or replace function private.report_hub_listing(p_workspace uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_owner uuid;
    v_public boolean;
    v_reason text;
    v_n bigint;
begin
    if auth.uid() is null then
        raise exception 'report_hub_listing: not authenticated';
    end if;

    v_reason := trim(coalesce(p_reason, ''));
    if v_reason = '' or char_length(v_reason) > 280 then
        raise exception 'report_hub_listing: reason must be 1–280 characters';
    end if;

    select w.owner_id, w.is_public into v_owner, v_public
      from public.workspaces w
     where w.id = p_workspace;
    if not found then
        raise exception 'report_hub_listing: workspace not found';
    end if;
    if v_public is not true then
        raise exception 'report_hub_listing: workspace is not public';
    end if;
    if v_owner = auth.uid() then
        raise exception 'report_hub_listing: cannot report your own workspace';
    end if;

    select count(*) into v_n
      from private.hub_reports r
     where r.reporter_id = auth.uid()
       and r.created_at > now() - interval '1 day';
    if v_n >= 20 then
        raise exception 'report_hub_listing: too many reports today';
    end if;

    begin
        insert into private.hub_reports (workspace_id, reporter_id, reason)
        values (p_workspace, auth.uid(), v_reason);
    exception when unique_violation then
        raise exception 'report_hub_listing: already reported';
    end;
end
$$;

create or replace function private.hub_listing_reported(p_workspace uuid)
returns boolean
language sql
security definer
stable
set search_path = public, extensions
as $$
    select auth.uid() is not null and exists (
        select 1 from private.hub_reports r
         where r.workspace_id = p_workspace
           and r.reporter_id = auth.uid()
    );
$$;

-- ----------------------------------------------------------------------------
-- moderate_hub_listing: admin only. hide/unhide touch the gallery;
-- delist drops the Hub row; make_private also kills /<username>/<slug>
-- (illegal content) and enqueues mail to the owner.
-- ----------------------------------------------------------------------------

create or replace function private.moderate_hub_listing(
    p_workspace uuid,
    p_action text,
    p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_owner uuid;
    v_public boolean;
    v_slug text;
    v_name text;
    v_username text;
    v_reason text;
begin
    if auth.uid() is null or not private.is_admin() then
        raise exception 'moderate_hub_listing: not an admin';
    end if;
    perform private.lock_workspace_tree(p_workspace);

    if p_action not in ('hide', 'unhide', 'delist', 'make_private') then
        raise exception 'moderate_hub_listing: invalid action';
    end if;

    if p_action = 'hide' then
        update public.hub_publications
           set hidden_at = now(),
               hidden_reason = 'moderator'
         where source_workspace_id = p_workspace
           and hidden_at is null;
        if not found then
            if exists (
                select 1 from public.hub_publications h
                 where h.source_workspace_id = p_workspace
            ) then
                return;
            end if;
            raise exception 'moderate_hub_listing: not listed';
        end if;
    elsif p_action = 'unhide' then
        update public.hub_publications
           set hidden_at = null,
               hidden_reason = null,
               reports_counted_after = now()
         where source_workspace_id = p_workspace;
        if not found then
            raise exception 'moderate_hub_listing: not listed';
        end if;
    elsif p_action = 'delist' then
        delete from public.hub_publications h
         where h.source_workspace_id = p_workspace;
    elsif p_action = 'make_private' then
        v_reason := trim(coalesce(p_reason, ''));
        if v_reason = '' then
            raise exception 'moderate_hub_listing: reason is required to make private';
        end if;
        select w.owner_id, w.is_public, w.slug, w.name, p.username
          into v_owner, v_public, v_slug, v_name, v_username
          from public.workspaces w
          join public.profiles p on p.id = w.owner_id
         where w.id = p_workspace;
        if not found then
            raise exception 'moderate_hub_listing: workspace not found';
        end if;
        delete from public.hub_publications h
         where h.source_workspace_id = p_workspace;
        update public.workspaces
           set is_public = false,
               slug = null,
               published_at = null
         where id = p_workspace;
        if v_public then
            insert into public.moderation_mail (
                kind, workspace_id, owner_id, reason, username, slug, workspace_name
            ) values (
                'listing_made_private', p_workspace, v_owner, v_reason,
                v_username, v_slug, v_name
            );
        end if;
    end if;
end
$$;

create or replace function private.moderation_digest_payload()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, extensions
as $$
declare
    v_since timestamptz;
begin
    select s.last_sent_at into v_since
      from public.moderation_digest_state s
     where s.id = 1;
    if not found then
        v_since := '-infinity'::timestamptz;
    end if;

    return jsonb_build_object(
        'since', v_since,
        'listings', coalesce((
            select jsonb_agg(jsonb_build_object(
                'workspace_id', h.source_workspace_id,
                'listed_at', h.listed_at,
                'name', w.name,
                'slug', w.slug,
                'username', p.username,
                'hidden_at', h.hidden_at,
                'hidden_reason', h.hidden_reason
            ) order by h.listed_at)
            from public.hub_publications h
            join public.workspaces w on w.id = h.source_workspace_id
            join public.profiles p on p.id = h.owner_id
            where h.listed_at > v_since
        ), '[]'::jsonb),
        'hidden', coalesce((
            select jsonb_agg(jsonb_build_object(
                'workspace_id', h.source_workspace_id,
                'hidden_at', h.hidden_at,
                'name', w.name,
                'slug', w.slug,
                'username', p.username,
                'report_count', (
                    select count(*) from private.hub_reports r
                     where r.workspace_id = h.source_workspace_id
                       and r.created_at > h.reports_counted_after
                ),
                'reasons', (
                    select coalesce(jsonb_agg(r.reason), '[]'::jsonb)
                      from private.hub_reports r
                     where r.workspace_id = h.source_workspace_id
                       and r.created_at > h.reports_counted_after
                )
            ) order by h.hidden_at)
            from public.hub_publications h
            join public.workspaces w on w.id = h.source_workspace_id
            join public.profiles p on p.id = h.owner_id
            where h.hidden_at is not null
              and h.hidden_reason = 'reports'
        ), '[]'::jsonb)
    );
end
$$;

create or replace function private.mark_moderation_digest_sent()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    insert into public.moderation_digest_state (id, last_sent_at)
    values (1, now())
    on conflict (id) do update
       set last_sent_at = now();
end
$$;

-- ----------------------------------------------------------------------------
-- fork_workspace: copy a live public workspace into the caller's account as
-- a regular private workspace. Gated by workspaces.allow_fork. Each
-- successful fork bumps hub_publications.fork_count when a listing exists.
-- Live entries only, ids re-minted through a temp map, strokes/edges follow
-- their folders. storage_key rows point at the source's B2 objects (a
-- foreign prefix) until they are re-keyed: the client calls
-- /blobs/copy-clones with the NEW workspace id right away, and the backend
-- GC sweep (list_foreign_blob_entries) catches whatever that call missed.
--
-- The source is read, never locked: the caller is a visitor of someone
-- else's board, and a tree lock held for the length of the copy would stall
-- the owner's own edits for as long as any visitor cared to fork. The whole
-- tree is taken in ONE statement into the temp map (one snapshot, so every
-- live row's parent is in it too), and the counts, the quota checks and the
-- copy all work from that map.
--
-- A fork is one statement under the role's statement timeout (8 s), so a
-- board too large to copy in that time is refused up front with words a
-- person can read, instead of dying half-way with "canceling statement"
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- list_subtree_files: entries of a subtree whose blob still lives under
-- ANOTHER workspace's prefix. fork_workspace clones rows with the source's
-- storage_key; the backend's /blobs/copy-clones copies those objects under
-- keys of the new workspace and rewrites the rows. Only foreign-prefixed
-- rows are returned, so the endpoint is idempotent: a repeated call finds
-- nothing to do instead of streaming every blob through the gateway again.
-- Same-workspace copies (copy_entry) are NOT re-keyed — blobs are immutable
-- and the GC keeps an object alive while any row references it, so sharing
-- is safe and free. Called ONLY by the backend under the service role, so
-- there is no in-function access check — the endpoint authorizes the caller
-- before invoking; the public wrapper is revoked from anon/authenticated at
-- the bottom of this file
-- ----------------------------------------------------------------------------

create or replace function private.list_subtree_files(p_root uuid)
returns table (id uuid, workspace_id uuid, storage_key text)
language plpgsql
security definer
stable
set search_path = public, extensions
as $$
declare
    v_root public.entries%rowtype;
begin
    select * into v_root from public.entries e where e.id = p_root;
    if not found then
        raise exception 'list_subtree_files: entry % not found', p_root;
    end if;

    return query
        select e.id, e.workspace_id, e.storage_key
          from public.entries e
         where e.node_path <@ v_root.node_path
           and e.storage_key is not null
           and lower(left(e.storage_key, 36)) <> e.workspace_id::text;
end
$$;

-- ----------------------------------------------------------------------------
-- list_foreign_blob_entries: every live row of a live workspace whose blob sits
-- under another workspace's prefix, oldest first. The backend GC tick
-- drains this list (see apps/backend/src/gc.ts): the client's call to
-- /blobs/copy-clones right after a fork is only an accelerator — if the tab
-- closes first, this sweep still gives the fork its own objects, so the
-- source owner's later deletes actually free their blobs. Backed by the
-- partial index entries_foreign_blob_idx (schema.sql). Service role only.
--
-- The sweep reads a batch per tick. Always from the oldest, a hundred rows
-- whose source object is gone (it fails to copy every time) would be the
-- batch forever, and no fork behind them would ever get its objects. So the
-- list is read on from where the last batch ended (p_after_created,
-- p_after_id: the last row's created_at and id) and starts over at the end.
-- Without them it is the oldest rows, as before. The return type changed,
-- hence the drops
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- Preview derivatives (entry_derivatives in schema.sql, the worker in
-- apps/backend/src/derivatives.ts). The worker PULLS its work, like the
-- re-key sweep above: there is no enqueue at /finalize or at re-key to
-- forget, uploads made before a deploy are backfilled, and a crash in the
-- middle of a generation is simply picked up again. Every workspace: a
-- non-member of a public board gets the preview instead of the original, and
-- members get it in tiles when they ask for one (GET /presign?preview=1; the
-- original stays theirs for viewing, downloads, export and sync). Until a
-- blob is decided, everyone gets the original, as before.
-- The trash is left out — a trashed file, and every file of a workspace in
-- the trash: nobody is shown a tile of it there, and most of it is never
-- restored. A restored file is live again and is simply picked up by the
-- next pull; a preview made before the file was trashed stays (prune goes by
-- references, and a trashed row is one). All four are service role only
-- (revoked at the bottom of this file, private functions included)
-- ----------------------------------------------------------------------------

-- list_pending_derivatives: blobs that still need a decision for the kind
-- their mime maps to (image/* → thumb, video/* → poster; p_kinds lets the
-- backend leave video out while posters are off): no row yet, or a failed
-- row past its backoff with attempts left. One row per key — copies share
-- the object, and one live copy is enough — oldest blob first. The grouping
-- runs over every live image and video blob per call; fine at this scale, a
-- cursor or a pending flag later
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

-- record_derivative: the worker's decision for one blob — 'ready' for an
-- object it has ALREADY written (never the other way round: GET /presign
-- must not sign a key whose object is not there yet), or 'skipped' (serve
-- the original). The object key is re-derived from the blob key and must
-- match, so a bug cannot point a preview at another blob's object. Returns
-- false and records nothing when no entry references the blob any more (a
-- hard delete during generation): no row would ever lead the GC to the
-- object, so the backend deletes what it wrote
create or replace function private.record_derivative(
    p_storage_key text,
    p_kind text,
    p_status text,
    p_deriv_key text,
    p_deriv_size_bytes bigint,
    p_width int,
    p_height int,
    p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_expected text;
begin
    if p_kind is null or p_kind not in ('thumb', 'poster')
       or p_status is null or p_status not in ('ready', 'skipped') then
        raise exception 'record_derivative: invalid kind or status';
    end if;
    if p_storage_key is null or p_storage_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,16})?$' then
        raise exception 'record_derivative: invalid storage key %', p_storage_key;
    end if;
    v_expected := 'deriv/' || lower(left(p_storage_key, 36)) || '/' || lower(substr(p_storage_key, 38, 36)) || '/'
        || case p_kind when 'thumb' then 'thumb.webp' else 'poster.jpg' end;
    if p_status = 'ready' and (p_deriv_key is distinct from v_expected or p_deriv_size_bytes is null) then
        raise exception 'record_derivative: % does not derive from %', p_deriv_key, p_storage_key;
    end if;

    if not exists (select 1 from public.entries e where e.storage_key = p_storage_key) then
        return false;
    end if;

    insert into public.entry_derivatives as d
        (storage_key, kind, status, deriv_key, deriv_size_bytes, width, height, reason)
    values (
        p_storage_key, p_kind, p_status,
        case when p_status = 'ready' then v_expected end,
        case when p_status = 'ready' then p_deriv_size_bytes end,
        p_width, p_height, left(p_reason, 64)
    )
    on conflict (storage_key, kind) do update
        set status = excluded.status,
            deriv_key = excluded.deriv_key,
            deriv_size_bytes = excluded.deriv_size_bytes,
            width = excluded.width,
            height = excluded.height,
            reason = excluded.reason,
            last_error = null,
            next_attempt_at = null,
            updated_at = now();
    return true;
end
$$;

-- fail_derivative: a transient failure (storage, network, a timeout) —
-- attempts + 1, retried after p_backoff_minutes × attempts. A decided row
-- (ready/skipped) is never demoted, and nothing is recorded for a blob no
-- entry references. Returns the attempts so far, 0 when nothing changed
create or replace function private.fail_derivative(
    p_storage_key text,
    p_kind text,
    p_error text,
    p_backoff_minutes int
)
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_backoff int := greatest(coalesce(p_backoff_minutes, 60), 1);
    v_attempts int;
begin
    if p_kind is null or p_kind not in ('thumb', 'poster') then
        raise exception 'fail_derivative: invalid kind';
    end if;
    if not exists (select 1 from public.entries e where e.storage_key = p_storage_key) then
        return 0;
    end if;

    insert into public.entry_derivatives as d
        (storage_key, kind, status, attempts, last_error, next_attempt_at)
    values (
        p_storage_key, p_kind, 'failed', 1, left(p_error, 500),
        now() + make_interval(mins => v_backoff)
    )
    on conflict (storage_key, kind) do update
        set attempts = d.attempts + 1,
            last_error = excluded.last_error,
            next_attempt_at = now() + make_interval(mins => v_backoff * (d.attempts + 1)),
            updated_at = now()
      where d.status = 'failed'
    returning d.attempts into v_attempts;
    return coalesce(v_attempts, 0);
end
$$;

-- prune_entry_derivatives: drops the rows of blobs no entry references any
-- more; the delete trigger queues their objects. This sweep, not a trigger
-- on entries, is what retires a preview: a hard delete removes the last
-- reference with a DELETE, but a fork's re-key does it with an UPDATE of
-- storage_key, after which nothing would ever fire for the old key. Run by
-- the daily reconcile before it lists known keys. Returns the rows dropped
create or replace function private.prune_entry_derivatives(p_limit int default 1000)
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_count int;
begin
    delete from public.entry_derivatives d
     where (d.storage_key, d.kind) in (
         select x.storage_key, x.kind
           from public.entry_derivatives x
          where not exists (select 1 from public.entries e where e.storage_key = x.storage_key)
          limit least(greatest(coalesce(p_limit, 1000), 1), 10000)
     );
    get diagnostics v_count = row_count;
    return v_count;
end
$$;

-- ----------------------------------------------------------------------------
-- create_blob_entry: the ONLY way a blob row enters entries. Called by the
-- backend's POST /finalize under the service role after it authorized the
-- caller (RLS under the user's JWT), minted the key and stat'ed the object
-- in B2 — so size_bytes is the real object size, never a client claim, and
-- the key carries this workspace's prefix. Access is re-checked here for
-- p_user (defense in depth; auth.uid() is null under the service role) and
-- the owner quota is asserted in the same transaction as the insert, so
-- concurrent uploads cannot overshoot it. Returns the row as json (the
-- backend relays it to the client, which needs the path/id)
-- ----------------------------------------------------------------------------

create or replace function private.create_blob_entry(
    p_id uuid,
    p_workspace uuid,
    p_parent uuid,
    p_name text,
    p_mime text,
    p_storage_key text,
    p_size_bytes bigint,
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
    v_parent public.entries%rowtype;
    v_row public.entries%rowtype;
begin
    if p_user is null then
        raise exception 'create_blob_entry: user is required';
    end if;
    perform private.lock_workspace_tree(p_workspace);
    if p_size_bytes is null or p_size_bytes < 0 then
        raise exception 'create_blob_entry: invalid size %', p_size_bytes;
    end if;
    if p_mime is null or p_mime = '' then
        raise exception 'create_blob_entry: mime is required';
    end if;
    -- the key must be one this workspace's upload minted: <workspace_id>/<uuid>[.ext]
    if p_storage_key is null
       or p_storage_key !~ ('^' || p_workspace::text || '/[0-9a-f-]{36}(\.[a-z0-9]{1,16})?$')
    then
        raise exception 'create_blob_entry: storage_key does not belong to workspace %', p_workspace;
    end if;

    select w.owner_id into v_owner from public.workspaces w
     where w.id = p_workspace and w.deleted_at is null;
    if v_owner is null then
        raise exception 'create_blob_entry: workspace % not found', p_workspace;
    end if;
    if v_owner <> p_user and not exists (
        select 1 from public.workspace_members m
         where m.workspace_id = p_workspace
           and m.user_id = p_user
           and m.role = 'editor'
    ) then
        raise exception 'create_blob_entry: access denied';
    end if;

    select * into v_parent from public.entries e
     where e.id = p_parent
       and e.workspace_id = p_workspace
       and e.kind = 'folder'
       and e.deleted_at is null;
    if not found then
        raise exception 'create_blob_entry: parent folder % not found', p_parent;
    end if;

    -- locks the billing row: the check and the insert are one transaction
    perform private.assert_owner_can_add(v_owner, p_size_bytes, p_size_bytes);
    perform private.assert_owner_entries(v_owner, 1);

    insert into public.entries (id, workspace_id, parent_id, name, kind, mime, storage_key,
                                size_bytes, updated_by, updated_by_client)
    values (coalesce(p_id, gen_random_uuid()), p_workspace, p_parent, p_name, 'file', p_mime,
            p_storage_key, p_size_bytes, p_user, p_client_id)
    returning * into v_row;

    return to_json(v_row);
end
$$;

-- ----------------------------------------------------------------------------
-- replace_blob_entry: point a live file at a new blob without changing its
-- id, so edges, layout and links survive. Called by complete_upload under
-- the service role, where auth.uid() is null — lock_entry_workspace would
-- refuse every call, because it checks the JWT. The lock is the workspace
-- tree lock (same as create_blob_entry); write access is checked for p_user.
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- Upload tickets are backend-only: p_user comes from a verified JWT. Writer
-- access is rechecked both before copying and at commit (including revocation).
-- ----------------------------------------------------------------------------
create or replace function private.assert_upload_access(p_workspace uuid, p_user uuid, p_kind text)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
    if p_user is null or p_kind is null or p_kind not in ('blob', 'hub_preview') or not exists (
        select 1 from public.workspaces w where w.id = p_workspace and w.deleted_at is null
        and (w.owner_id = p_user or (p_kind = 'blob' and exists (
            select 1 from public.workspace_members m where m.workspace_id = w.id
            and m.user_id = p_user and m.role = 'editor'
        )))
    ) then
        raise exception 'upload: access denied';
    end if;
end;
$$;

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

create or replace function private.prepare_upload(
    p_key text, p_user uuid, p_kind text, p_request jsonb
)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
    v_upload private.upload_sessions%rowtype;
    v_max bigint;
    v_quota bigint;
    v_used bigint;
    v_replaced bigint;
    v_workspace uuid;
begin
    select workspace_id into v_workspace from private.upload_sessions
    where storage_key = p_key and uploaded_by = p_user and kind = p_kind;
    if not found then raise exception 'upload: ticket not found'; end if;
    perform private.assert_upload_access(v_workspace, p_user, p_kind);
    perform private.lock_workspace_tree(v_workspace);
    select * into v_upload from private.upload_sessions
    where storage_key = p_key and uploaded_by = p_user and kind = p_kind for update;
    if not found then raise exception 'upload: ticket not found'; end if;
    perform private.assert_upload_access(v_upload.workspace_id, p_user, p_kind);
    if jsonb_typeof(p_request) is distinct from 'object' then
        raise exception 'upload_conflict: invalid request';
    end if;
    if v_upload.request is not null and v_upload.request <> p_request then
        raise exception 'upload_conflict: ticket is bound to another request';
    end if;
    if v_upload.result is null and v_upload.expires_at <= clock_timestamp() then
        raise exception 'upload_expired: start a new upload';
    end if;
    -- a ticket whose copies kept failing is spent (begin_upload_copy)
    if v_upload.result is null and v_upload.attempts >= 5 then
        raise exception 'upload_expired: too many attempts, start a new upload';
    end if;
    -- A delayed retry must never resurrect an entry that was already purged.
    if p_kind = 'blob' and v_upload.result is not null and not exists (
        select 1 from public.entries e where e.id = (v_upload.result->'entry'->>'id')::uuid
        and e.deleted_at is null
    ) then raise exception 'upload_expired: finalized entry was removed'; end if;
    if p_kind = 'blob' and v_upload.result is not null then
        select jsonb_build_object('entry', to_jsonb(e), 'size_bytes', e.size_bytes) into v_upload.result
        from public.entries e where e.id = (v_upload.result->'entry'->>'id')::uuid;
    end if;
    if v_upload.request is null then
        update private.upload_sessions set request = p_request where storage_key = p_key;
    end if;
    select case when p_kind = 'hub_preview' then 2097152 else b.max_file_bytes end,
           case when p_kind = 'blob' then b.quota_bytes end,
           case when p_kind = 'blob' then (select u.used_bytes from private.owner_usage(w.owner_id) u) end
      into v_max, v_quota, v_used
    from public.workspaces w join public.billing_accounts b on b.owner_id = w.owner_id
    where w.id = v_upload.workspace_id;
    -- What create_blob_entry / replace_blob_entry would refuse anyway is
    -- refused before the copy, so a doomed finalize leaves nothing in
    -- storage. Not a list of checks that could miss one (a 65-char client_id,
    -- a taken id, a bad name): the real call runs on a placeholder key and
    -- size 0 inside a subtransaction that is always rolled back, and any
    -- error it raises is this call's error. Only the quota needs the real
    -- size, which only the backend's stat knows: used_bytes, quota_bytes and,
    -- for a replace, the bytes of the file it replaces go back with max_bytes,
    -- and create/replace_blob_entry still check the quota under the billing lock
    if p_kind = 'blob' and v_upload.result is null then
        begin
            if p_request ? 'replace' then
                perform private.replace_blob_entry(
                    (p_request->>'replace')::uuid, v_upload.workspace_id,
                    v_upload.workspace_id::text || '/' || gen_random_uuid()::text, 0,
                    p_request->>'mime', p_user, p_request->>'client_id'
                );
            else
                perform private.create_blob_entry(
                    (p_request->>'id')::uuid, v_upload.workspace_id, (p_request->>'parent_id')::uuid,
                    p_request->>'name', p_request->>'mime',
                    v_upload.workspace_id::text || '/' || gen_random_uuid()::text, 0,
                    p_user, p_request->>'client_id'
                );
            end if;
            raise exception 'upload dry run' using errcode = 'PU000';
        exception when sqlstate 'PU000' then
            null;
        end;
        if p_request ? 'replace' then
            select e.size_bytes into v_replaced from public.entries e
             where e.id = (p_request->>'replace')::uuid;
        end if;
    end if;
    return jsonb_build_object('workspace_id', v_upload.workspace_id, 'max_bytes', v_max,
                              'used_bytes', v_used, 'quota_bytes', v_quota,
                              'replaced_bytes', v_replaced, 'result', v_upload.result);
end;
$$;

-- begin_upload_copy: the backend calls it right before CopyObject, after
-- its stat and its size and quota checks. Every copy leaves an object in
-- storage until the reconcile, and a failed complete_upload rolls back with
-- the ticket unspent, so the copies are counted here, in a transaction of
-- their own: past 5 without a result the ticket is spent. A finalize that
-- stops before the copy (no PUT yet, too large) costs no attempt
create or replace function private.begin_upload_copy(p_key text, p_user uuid, p_kind text)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare
    v_upload private.upload_sessions%rowtype;
begin
    select * into v_upload from private.upload_sessions
     where storage_key = p_key and uploaded_by = p_user and kind = p_kind
       for update;
    if not found then raise exception 'upload: ticket not found'; end if;
    if v_upload.result is not null then return; end if;
    if v_upload.attempts >= 5 then
        raise exception 'upload_expired: too many attempts, start a new upload';
    end if;
    update private.upload_sessions set attempts = attempts + 1 where storage_key = p_key;
end;
$$;

create or replace function public.begin_upload_copy(p_key text, p_user uuid, p_kind text)
returns void language sql security invoker set search_path = public, extensions
as $$ select private.begin_upload_copy(p_key, p_user, p_kind); $$;

revoke execute on function private.begin_upload_copy(text, uuid, text) from public, anon, authenticated;
revoke execute on function public.begin_upload_copy(text, uuid, text) from public, anon, authenticated;
grant execute on function private.begin_upload_copy(text, uuid, text) to service_role;
grant execute on function public.begin_upload_copy(text, uuid, text) to service_role;

create or replace function private.complete_upload(
    p_key text, p_user uuid, p_kind text, p_request jsonb, p_final_key text, p_size bigint
)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
    v_upload jsonb;
    v_result jsonb;
    v_entry json;
    v_workspace uuid;
begin
    -- Keeps the ticket locked through entry creation and the receipt update.
    v_upload := private.prepare_upload(p_key, p_user, p_kind, p_request);
    if v_upload->'result' <> 'null'::jsonb then return v_upload->'result'; end if;
    v_workspace := (v_upload->>'workspace_id')::uuid;
    if p_kind = 'blob' and p_request ? 'replace' then
        v_entry := private.replace_blob_entry(
            (p_request->>'replace')::uuid, v_workspace, p_final_key, p_size,
            p_request->>'mime', p_user, p_request->>'client_id'
        );
        v_result := jsonb_build_object('entry', v_entry, 'size_bytes', p_size);
    elsif p_kind = 'blob' then
        v_entry := private.create_blob_entry(
            (p_request->>'id')::uuid, v_workspace, (p_request->>'parent_id')::uuid,
            p_request->>'name', p_request->>'mime', p_final_key, p_size, p_user, p_request->>'client_id'
        );
        v_result := jsonb_build_object('entry', v_entry, 'size_bytes', p_size);
    else
        -- record_hub_preview_upload also checks prefix, ownership and the cap.
        if split_part(p_final_key, '/', 2) is distinct from v_workspace::text then
            raise exception 'upload: access denied';
        end if;
        perform private.record_hub_preview_upload(p_final_key, p_size, p_user);
        v_result := jsonb_build_object('storage_key', p_final_key, 'size_bytes', p_size);
    end if;
    update private.upload_sessions set result = v_result where storage_key = p_key;
    return v_result;
end;
$$;

create or replace function public.register_upload(
    p_workspace uuid, p_user uuid, p_kind text, p_ext text, p_ttl int, p_size bigint default null
)
returns text language sql security invoker set search_path = public, extensions
as $$ select private.register_upload(p_workspace, p_user, p_kind, p_ext, p_ttl, p_size); $$;
create or replace function public.prepare_upload(p_key text, p_user uuid, p_kind text, p_request jsonb)
returns jsonb language sql security invoker set search_path = public, extensions
as $$ select private.prepare_upload(p_key, p_user, p_kind, p_request); $$;
create or replace function public.complete_upload(p_key text, p_user uuid, p_kind text, p_request jsonb, p_final_key text, p_size bigint)
returns jsonb language sql security invoker set search_path = public, extensions
as $$ select private.complete_upload(p_key, p_user, p_kind, p_request, p_final_key, p_size); $$;

revoke execute on function private.assert_upload_access(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function private.register_upload(uuid, uuid, text, text, int, bigint) from public, anon, authenticated;
revoke execute on function public.register_upload(uuid, uuid, text, text, int, bigint) from public, anon, authenticated;
revoke execute on function private.prepare_upload(text, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.prepare_upload(text, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function private.complete_upload(text, uuid, text, jsonb, text, bigint) from public, anon, authenticated;
revoke execute on function public.complete_upload(text, uuid, text, jsonb, text, bigint) from public, anon, authenticated;
grant execute on function private.register_upload(uuid, uuid, text, text, int, bigint) to service_role;
grant execute on function public.register_upload(uuid, uuid, text, text, int, bigint) to service_role;
grant execute on function private.prepare_upload(text, uuid, text, jsonb) to service_role;
grant execute on function public.prepare_upload(text, uuid, text, jsonb) to service_role;
grant execute on function private.complete_upload(text, uuid, text, jsonb, text, bigint) to service_role;
grant execute on function public.complete_upload(text, uuid, text, jsonb, text, bigint) to service_role;

-- ----------------------------------------------------------------------------
-- add_workspace_member: share a workspace by exact email. Owner only, and
-- the ONLY insert path for workspace_invites (clients have no INSERT).
-- Service role only, through the public invite_workspace_member: the backend
-- checks the owner's JWT, calls it with the owner's id and sends the mail
-- right after, so every invite counted below is a mail that went out. Were
-- it callable by the owner through PostgREST, invites without mails could
-- spend somebody else's mailbox budget for the day. Every
-- address gets the same answer — a pending invite with its token — whether
-- an account exists for it or not: nobody is added to a board without
-- accepting (accept_workspace_invite), and the answer tells the owner
-- nothing about who has an account. The backend mails the invite; this
-- function decides whether a mail may go out at all:
--   * at most 30 a day per owner (10 while the account is under a week old);
--   * the same mailbox on the same workspace at most 3 times a day;
--   * one mailbox at most 5 times a day, from everyone together (a mailbox
--     is the address without its +tag; private.mailbox_of);
--   * at most 20 live pending invites per owner.
-- Repeat (workspace, email) upserts role/token/expiry. Role changes and
-- removals need no RPC: members_update (column grant: role) / members_delete
-- allow them to the owner directly; pending revoke is a direct DELETE on
-- workspace_invites.
-- ----------------------------------------------------------------------------

-- mailbox_of: the inbox an address delivers to, for the per-address mail
-- budget. The +tag goes everywhere (most providers deliver it to the same
-- inbox; over-counting only makes the budget stricter), dots in the local
-- part at Gmail
create or replace function private.mailbox_of(p_email text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
    select case
        when split_part(e, '@', 2) in ('gmail.com', 'googlemail.com') then
            replace(split_part(split_part(e, '@', 1), '+', 1), '.', '') || '@gmail.com'
        else split_part(split_part(e, '@', 1), '+', 1) || '@' || split_part(e, '@', 2)
    end
    from (select lower(btrim(p_email)) as e) a;
$$;

revoke execute on function private.mailbox_of(text) from public, anon, authenticated;

-- invites_suspended: the mails of this account's invites drew a spam
-- complaint in the last 30 days, or 3 permanent bounces in the last day
-- (private.mail_events, from Plunk's webhook)
create or replace function private.invites_suspended(p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
    select exists (
        select 1 from private.mail_events m
         where m.actor = p_actor and m.kind = 'complaint'
           and m.created_at > now() - interval '30 days'
    ) or (
        select count(*) from private.mail_events m
         where m.actor = p_actor and m.kind = 'bounce'
           and m.created_at > now() - interval '1 day'
    ) >= 3;
$$;

revoke execute on function private.invites_suspended(uuid) from public, anon, authenticated;

-- note_invite_mail: the backend, right after Plunk accepted an invite mail,
-- records Plunk's id for it on the invite's rate event
create or replace function private.note_invite_mail(
    p_inviter uuid, p_workspace uuid, p_email text, p_mail_id text
)
returns void
language sql
security definer
set search_path = public, extensions
as $$
    update private.rate_events r
       set mail_id = left(p_mail_id, 128)
     where r.id = (
        select r2.id from private.rate_events r2
         where r2.actor = p_inviter and r2.action = 'invite'
           and r2.subject = private.mailbox_of(p_email)
           and r2.workspace_id = p_workspace
         order by r2.created_at desc
         limit 1
     );
$$;

-- record_mail_event: one bounce or complaint from Plunk. The sender is the
-- account whose invite carried that mail id (null for system mail); the
-- answer says whether that account's invites are stopped now
create or replace function private.record_mail_event(p_mail_id text, p_kind text, p_email text)
returns table (actor uuid, suspended boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_actor uuid;
begin
    if p_kind not in ('bounce', 'complaint') then
        raise exception 'record_mail_event: unknown kind %', p_kind;
    end if;
    if p_mail_id is not null then
        select r.actor into v_actor from private.rate_events r
         where r.mail_id = p_mail_id
         order by r.created_at desc
         limit 1;
    end if;
    insert into private.mail_events (actor, kind, mail_id, email)
    values (v_actor, p_kind, left(p_mail_id, 128), left(lower(p_email), 254));
    return query select v_actor, v_actor is not null and private.invites_suspended(v_actor);
end
$$;

create or replace function public.note_invite_mail(
    p_inviter uuid, p_workspace uuid, p_email text, p_mail_id text
)
returns void language sql security invoker set search_path = public, extensions
as $$ select private.note_invite_mail(p_inviter, p_workspace, p_email, p_mail_id); $$;

create or replace function public.record_mail_event(p_mail_id text, p_kind text, p_email text)
returns table (actor uuid, suspended boolean)
language sql security invoker set search_path = public, extensions
as $$ select * from private.record_mail_event(p_mail_id, p_kind, p_email); $$;

revoke execute on function private.note_invite_mail(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.note_invite_mail(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function private.record_mail_event(text, text, text) from public, anon, authenticated;
revoke execute on function public.record_mail_event(text, text, text) from public, anon, authenticated;
grant execute on function private.note_invite_mail(uuid, uuid, text, text) to service_role;
grant execute on function public.note_invite_mail(uuid, uuid, text, text) to service_role;
grant execute on function private.record_mail_event(text, text, text) to service_role;
grant execute on function public.record_mail_event(text, text, text) to service_role;

drop function if exists public.add_workspace_member(uuid, text, text);
drop function if exists private.add_workspace_member(uuid, text, text);

create or replace function private.add_workspace_member(
    p_inviter uuid,
    p_workspace uuid,
    p_email text,
    p_role text
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_email text;
    v_mailbox text;
    v_token text;
    v_name text;
    v_inviter text;
    v_live boolean;
    v_pending int;
    v_account_age interval;
    v_daily int;
begin
    if p_inviter is null then
        raise exception 'add_workspace_member: not authenticated';
    end if;
    if not exists (
        select 1 from public.workspaces w
         where w.id = p_workspace and w.owner_id = p_inviter and w.deleted_at is null
    ) then
        raise exception 'add_workspace_member: only the owner can share';
    end if;
    if p_role not in ('editor', 'viewer') then
        raise exception 'add_workspace_member: invalid role';
    end if;

    v_email := lower(btrim(p_email));
    if v_email is null or v_email = '' or char_length(v_email) > 254
       or v_email !~ '^[^@]+@[^@]+\.[^@]+$' then
        raise exception 'add_workspace_member: invalid email';
    end if;

    select coalesce(nullif(p.display_name, ''), p.username, u.email::text), now() - u.created_at
      into v_inviter, v_account_age
      from auth.users u
      left join public.profiles p on p.id = u.id
     where u.id = p_inviter;

    if v_email = lower((select u.email::text from auth.users u where u.id = p_inviter)) then
        raise exception 'add_workspace_member: the owner needs no membership';
    end if;
    -- the owner sees the members' addresses in the share dialog anyway
    if exists (
        select 1 from public.workspace_members m
          join auth.users u on u.id = m.user_id
         where m.workspace_id = p_workspace and lower(u.email) = v_email
    ) then
        raise exception 'add_workspace_member: already a member';
    end if;

    -- mail that bounced or was reported as spam stops the sender's invites
    if private.invites_suspended(p_inviter) then
        raise exception 'add_workspace_member: invites are suspended for this account'
            using errcode = 'P0001';
    end if;

    -- the mail budget: per owner, per (workspace, mailbox), per mailbox. A
    -- mailbox is the address without its +tag (and, at Gmail, its dots), so
    -- victim+1@ and victim+2@ count as one. Both locks are held to the
    -- commit, so parallel calls cannot all read the same count
    v_mailbox := private.mailbox_of(v_email);
    perform pg_advisory_xact_lock(hashtextextended(p_inviter::text || ':invite', 44));
    perform pg_advisory_xact_lock(hashtextextended('mailbox:' || v_mailbox, 44));
    v_daily := case when v_account_age < interval '7 days' then 10 else 30 end;
    if (select count(*) from private.rate_events r
         where r.actor = p_inviter and r.action = 'invite'
           and r.created_at > now() - interval '1 day') >= v_daily then
        raise exception 'add_workspace_member: too many invites today'
            using errcode = 'P0001';
    end if;
    -- three a day, not one: a resend after a mail that failed to go out
    if (select count(*) from private.rate_events r
         where r.action = 'invite' and r.subject = v_mailbox
           and r.workspace_id = p_workspace
           and r.created_at > now() - interval '1 day') >= 3 then
        raise exception 'add_workspace_member: invite already sent today'
            using errcode = 'P0001';
    end if;
    if (select count(*) from private.rate_events r
         where r.action = 'invite' and r.subject = v_mailbox
           and r.created_at > now() - interval '1 day') >= 5 then
        raise exception 'add_workspace_member: too many invites to this address today'
            using errcode = 'P0001';
    end if;

    select exists (
        select 1 from public.workspace_invites i
         where i.workspace_id = p_workspace
           and i.email = v_email
           and i.expires_at > now()
    ) into v_live;
    if not v_live then
        select count(*) into v_pending
          from public.workspace_invites i
         where i.invited_by = p_inviter and i.expires_at > now();
        if v_pending >= 20 then
            raise exception 'add_workspace_member: too many pending invites';
        end if;
    end if;

    select w.name into v_name from public.workspaces w where w.id = p_workspace;

    v_token := encode(gen_random_bytes(32), 'hex');
    insert into public.workspace_invites (
        workspace_id, email, role, invited_by, token, expires_at
    )
    values (
        p_workspace, v_email, p_role, p_inviter, v_token,
        now() + interval '14 days'
    )
    on conflict (workspace_id, email) do update
        set role = excluded.role,
            token = excluded.token,
            invited_by = excluded.invited_by,
            expires_at = excluded.expires_at;

    insert into private.rate_events (actor, action, subject, workspace_id)
    values (p_inviter, 'invite', v_mailbox, p_workspace);

    return json_build_object(
        'kind', 'pending',
        'token', v_token,
        'workspace_name', coalesce(v_name, ''),
        'inviter', coalesce(v_inviter, '')
    );
end
$$;

-- ----------------------------------------------------------------------------
-- Invites addressed to the caller. Only a session whose address is
-- CONFIRMED sees, accepts or declines them: until then the account may
-- belong to someone who typed another person's address at signup.
-- private.my_confirmed_email() is that address, or null
-- ----------------------------------------------------------------------------

create or replace function private.my_confirmed_email()
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
    select lower(u.email::text)
      from auth.users u
     where u.id = auth.uid()
       and u.email_confirmed_at is not null;
$$;

revoke execute on function private.my_confirmed_email() from public, anon, authenticated;

create or replace function private.list_my_invites()
returns table (
    workspace_id uuid,
    workspace_name text,
    role text,
    inviter text,
    created_at timestamptz,
    expires_at timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
    select i.workspace_id, w.name, i.role,
           coalesce(nullif(pr.display_name, ''), pr.username, ''),
           i.created_at, i.expires_at
      from public.workspace_invites i
      join public.workspaces w on w.id = i.workspace_id
      left join public.profiles pr on pr.id = i.invited_by
     where i.email = private.my_confirmed_email()
       and i.expires_at > now()
       and w.deleted_at is null
       and w.owner_id <> auth.uid()
     order by i.created_at desc;
$$;

-- accept_workspace_invite: the invite for this workspace and the caller's
-- confirmed address becomes a membership. False when there is none (expired,
-- revoked, declined, or another address); true when the caller is already a
-- member, so a second click is harmless
create or replace function private.accept_workspace_invite(p_workspace uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_email text;
    v_role text;
begin
    if auth.uid() is null then
        raise exception 'accept_workspace_invite: not authenticated';
    end if;
    v_email := private.my_confirmed_email();
    if v_email is null then
        raise exception 'accept_workspace_invite: confirm your email first';
    end if;
    select i.role into v_role
      from public.workspace_invites i
      join public.workspaces w on w.id = i.workspace_id
     where i.workspace_id = p_workspace
       and i.email = v_email
       and i.expires_at > now()
       and w.deleted_at is null
       and w.owner_id <> auth.uid()
       for update of i;
    if v_role is null then
        return exists (
            select 1 from public.workspace_members m
             where m.workspace_id = p_workspace and m.user_id = auth.uid()
        );
    end if;
    insert into public.workspace_members (workspace_id, user_id, role)
    values (p_workspace, auth.uid(), v_role)
    on conflict (workspace_id, user_id) do nothing;
    delete from public.workspace_invites
     where workspace_id = p_workspace and email = v_email;
    return true;
end
$$;

-- decline_workspace_invite: drops the invite; the owner sees it gone
create or replace function private.decline_workspace_invite(p_workspace uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_email text;
    v_n int;
begin
    if auth.uid() is null then
        raise exception 'decline_workspace_invite: not authenticated';
    end if;
    v_email := private.my_confirmed_email();
    if v_email is null then
        raise exception 'decline_workspace_invite: confirm your email first';
    end if;
    delete from public.workspace_invites
     where workspace_id = p_workspace and email = v_email;
    get diagnostics v_n = row_count;
    return v_n > 0;
end
$$;

-- leave_workspace: a member removes their own membership (and the sync
-- stamps of their devices on that workspace). The owner cannot leave their
-- own workspace; removing others stays owner-only (members_delete)
create or replace function private.leave_workspace(p_workspace uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_n int;
begin
    if auth.uid() is null then
        raise exception 'leave_workspace: not authenticated';
    end if;
    delete from public.workspace_members
     where workspace_id = p_workspace and user_id = auth.uid();
    get diagnostics v_n = row_count;
    if v_n > 0 then
        delete from public.sync_devices
         where workspace_id = p_workspace and owner_id = auth.uid();
    end if;
    return v_n > 0;
end
$$;

-- preview_workspace_invite: the /invite/<token> landing. Secret token is
-- the capability; expired or revoked rows return null (no enumeration).
create or replace function private.preview_workspace_invite(p_token text)
returns json
language plpgsql
security definer
stable
set search_path = public, extensions
as $$
declare
    v_row json;
begin
    if p_token is null or btrim(p_token) = '' then
        return null;
    end if;
    select json_build_object(
        'workspace_id', i.workspace_id,
        'workspace_name', w.name,
        'role', i.role,
        'email', i.email,
        'inviter', coalesce(nullif(pr.display_name, ''), pr.username, u.email::text)
    )
      into v_row
      from public.workspace_invites i
      join public.workspaces w on w.id = i.workspace_id
      join auth.users u on u.id = i.invited_by
      left join public.profiles pr on pr.id = i.invited_by
     where i.token = lower(btrim(p_token))
       and i.expires_at > now()
       and w.deleted_at is null;
    return v_row;
end
$$;

-- ----------------------------------------------------------------------------
-- list_workspace_members: members with emails for the share dialog. The join
-- to auth.users is possible only under security definer. For the owner
-- alone: the owner invited these addresses, the members did not give them
-- to each other. A member still sees who else is in the folder by role
-- (workspace_members, the members_select policy), without an address
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- Public wrappers (security invoker) — these are what supabase.rpc calls
-- ----------------------------------------------------------------------------

create or replace function public.create_workspace(p_name text)
returns uuid
language sql
security invoker
set search_path = public, extensions
as $$
    select private.create_workspace(p_name);
$$;

create or replace function public.set_workspace_xattr(p_workspace uuid, p_name text, p_value text)
returns void
language sql
security invoker
set search_path = public, extensions
as $$
    select private.set_workspace_xattr(p_workspace, p_name, p_value);
$$;

create or replace function public.merge_entry_xattrs(
    p_workspace uuid,
    p_items jsonb,
    p_client_id text default null
)
returns table (path text, status text)
language sql
security invoker
set search_path = public, extensions
as $$
    select * from private.merge_entry_xattrs(p_workspace, p_items, p_client_id);
$$;

revoke execute on function public.merge_entry_xattrs(uuid, jsonb, text) from public, anon;
grant execute on function public.merge_entry_xattrs(uuid, jsonb, text) to authenticated;

create or replace function public.create_text_file(
    p_parent uuid,
    p_name text,
    p_mime text,
    p_content text,
    p_client_id text default null,
    p_id uuid default null,
    p_xattrs jsonb default '{}'
)
returns json
language sql
security invoker
set search_path = public, extensions
as $$
    select private.create_text_file(p_parent, p_name, p_mime, p_content, p_client_id, p_id, p_xattrs);
$$;

create or replace function public.rename_entry(p_entry uuid, p_new_name text, p_client_id text default null)
returns table (id uuid, path text, name text)
language sql
security invoker
set search_path = public, extensions
as $$
    select * from private.rename_entry(p_entry, p_new_name, p_client_id);
$$;

create or replace function public.move_entry(
    p_entry uuid,
    p_target_folder uuid,
    p_new_name text default null,
    p_client_id text default null
)
returns table (id uuid, path text, name text)
language sql
security invoker
set search_path = public, extensions
as $$
    select * from private.move_entry(p_entry, p_target_folder, p_new_name, p_client_id);
$$;

create or replace function public.copy_entry(
    p_source uuid,
    p_target_folder uuid,
    p_new_name text default null,
    p_client_id text default null
)
returns table (id uuid, path text, name text)
language sql
security invoker
set search_path = public, extensions
as $$
    select * from private.copy_entry(p_source, p_target_folder, p_new_name, p_client_id);
$$;

create or replace function public.delete_entry(p_entry uuid, p_client_id text default null)
returns void
language sql
security invoker
set search_path = public, extensions
as $$
    select private.delete_entry(p_entry, p_client_id);
$$;

create or replace function public.sweep_pile_images(
    p_workspace uuid,
    p_path text,
    p_roles text[],
    p_client_id text default null
)
returns int
language sql
security invoker
set search_path = public, extensions
as $$
    select private.sweep_pile_images(p_workspace, p_path, p_roles, p_client_id);
$$;

create or replace function public.restore_entry(p_entry uuid, p_client_id text default null)
returns void
language sql
security invoker
set search_path = public, extensions
as $$
    select private.restore_entry(p_entry, p_client_id);
$$;

create or replace function public.list_trash(p_workspace uuid)
returns table (
    id uuid,
    path text,
    name text,
    kind text,
    size_bytes bigint,
    deleted_at timestamptz,
    subtree_bytes bigint,
    subtree_files bigint
)
language sql
security invoker
stable
set search_path = public, extensions
as $$
    select * from private.list_trash(p_workspace);
$$;

create or replace function public.workspace_usage(p_workspace uuid)
returns table (
    live_bytes bigint,
    trash_bytes bigint,
    live_files bigint,
    trash_files bigint
)
language sql
security invoker
stable
set search_path = public, extensions
as $$
    select * from private.workspace_usage(p_workspace);
$$;

create or replace function public.owner_usage()
returns table (
    used_bytes bigint,
    live_bytes bigint,
    trash_bytes bigint
)
language sql
security invoker
stable
set search_path = public, extensions
as $$
    select * from private.owner_usage(auth.uid());
$$;

create or replace function public.assert_owner_quota(
    p_workspace uuid,
    p_delta_bytes bigint,
    p_file_bytes bigint default null
)
returns void
language sql
security invoker
set search_path = public, extensions
as $$
    select private.assert_owner_quota(p_workspace, p_delta_bytes, p_file_bytes);
$$;

create or replace function public.folder_read(p_workspace uuid, p_path text)
returns json
language sql
security invoker
stable
set search_path = public, extensions
as $$
    select private.folder_read(p_workspace, p_path);
$$;

create or replace function public.purge_entry(p_entry uuid)
returns void
language sql
security invoker
set search_path = public, extensions
as $$
    select private.purge_entry(p_entry);
$$;

create or replace function public.entry_subtree_stamp_at(p_workspace uuid, p_path text)
returns table (entry_id uuid, stamp text)
language sql
security invoker
stable
set search_path = public, extensions
as $$
    select * from private.entry_subtree_stamp_at(p_workspace, p_path);
$$;

create or replace function public.delete_moved_entry(
    p_entry uuid,
    p_stamp text,
    p_path text,
    p_client_id text default null
)
returns text
language sql
security invoker
set search_path = public, extensions
as $$
    select private.delete_moved_entry(p_entry, p_stamp, p_path, p_client_id);
$$;

create or replace function public.purge_trash(p_workspace uuid)
returns void
language sql
security invoker
set search_path = public, extensions
as $$
    select private.purge_trash(p_workspace);
$$;

create or replace function public.set_workspace_public(
    p_workspace uuid,
    p_slug text,
    p_allow_fork boolean default true
)
returns void
language sql
security invoker
set search_path = public, extensions
as $$
    select private.set_workspace_public(p_workspace, p_slug, p_allow_fork);
$$;

create or replace function public.set_workspace_private(p_workspace uuid)
returns void
language sql
security invoker
set search_path = public, extensions
as $$
    select private.set_workspace_private(p_workspace);
$$;

create or replace function public.trash_workspace(p_workspace uuid)
returns void
language sql
security invoker
set search_path = public, extensions
as $$
    select private.trash_workspace(p_workspace);
$$;

create or replace function public.restore_workspace(p_workspace uuid)
returns void
language sql
security invoker
set search_path = public, extensions
as $$
    select private.restore_workspace(p_workspace);
$$;

create or replace function public.purge_workspace(p_workspace uuid)
returns void
language sql
security invoker
set search_path = public, extensions
as $$
    select private.purge_workspace(p_workspace);
$$;

create or replace function public.list_trashed_workspaces()
returns table (id uuid, name text, deleted_at timestamptz, size_bytes bigint)
language sql
security invoker
stable
set search_path = public, extensions
as $$
    select * from private.list_trashed_workspaces();
$$;

create or replace function public.workspace_state(p_workspace uuid)
returns text
language sql
security invoker
stable
set search_path = public, extensions
as $$
    select private.workspace_state(p_workspace);
$$;

revoke execute on function public.trash_workspace(uuid) from public, anon;
revoke execute on function public.restore_workspace(uuid) from public, anon;
revoke execute on function public.purge_workspace(uuid) from public, anon;
revoke execute on function public.list_trashed_workspaces() from public, anon;
revoke execute on function public.workspace_state(uuid) from public, anon;
grant execute on function public.trash_workspace(uuid) to authenticated;
grant execute on function public.restore_workspace(uuid) to authenticated;
grant execute on function public.purge_workspace(uuid) to authenticated;
grant execute on function public.list_trashed_workspaces() to authenticated;
grant execute on function public.workspace_state(uuid) to authenticated;
revoke execute on function private.trash_workspace(uuid) from public, anon;
revoke execute on function private.restore_workspace(uuid) from public, anon;
revoke execute on function private.purge_workspace(uuid) from public, anon;
revoke execute on function private.list_trashed_workspaces() from public, anon;
revoke execute on function private.workspace_state(uuid) from public, anon;
grant execute on function private.trash_workspace(uuid) to authenticated;
grant execute on function private.restore_workspace(uuid) to authenticated;
grant execute on function private.purge_workspace(uuid) to authenticated;
grant execute on function private.list_trashed_workspaces() to authenticated;
grant execute on function private.workspace_state(uuid) to authenticated;

create or replace function public.set_hub_listing(
    p_workspace uuid,
    p_description text,
    p_tags text[],
    p_allow_fork boolean default true,
    p_preview_key text default null
)
returns void
language sql
security invoker
set search_path = public, extensions
as $$
    select private.set_hub_listing(
        p_workspace, p_description, p_tags, p_allow_fork, p_preview_key
    );
$$;

create or replace function public.remove_from_hub(p_workspace uuid)
returns void
language sql
security invoker
set search_path = public, extensions
as $$
    select private.remove_from_hub(p_workspace);
$$;

create or replace function public.report_hub_listing(p_workspace uuid, p_reason text)
returns void
language sql
security invoker
set search_path = public, extensions
as $$
    select private.report_hub_listing(p_workspace, p_reason);
$$;

create or replace function public.hub_listing_reported(p_workspace uuid)
returns boolean
language sql
security invoker
stable
set search_path = public, extensions
as $$
    select private.hub_listing_reported(p_workspace);
$$;

create or replace function public.moderate_hub_listing(
    p_workspace uuid,
    p_action text,
    p_reason text default null
)
returns void
language sql
security invoker
set search_path = public, extensions
as $$
    select private.moderate_hub_listing(p_workspace, p_action, p_reason);
$$;

create or replace function public.moderation_digest_payload()
returns jsonb
language sql
security invoker
stable
set search_path = public, extensions
as $$
    select private.moderation_digest_payload();
$$;

create or replace function public.mark_moderation_digest_sent()
returns void
language sql
security invoker
set search_path = public, extensions
as $$
    select private.mark_moderation_digest_sent();
$$;

revoke execute on function public.report_hub_listing(uuid, text) from public, anon;
grant execute on function public.report_hub_listing(uuid, text) to authenticated;
revoke execute on function public.hub_listing_reported(uuid) from public, anon;
grant execute on function public.hub_listing_reported(uuid) to authenticated;
revoke execute on function public.moderate_hub_listing(uuid, text, text) from public, anon;
grant execute on function public.moderate_hub_listing(uuid, text, text) to authenticated;
revoke execute on function public.moderation_digest_payload() from public, anon, authenticated;
grant execute on function public.moderation_digest_payload() to service_role;
revoke execute on function public.mark_moderation_digest_sent() from public, anon, authenticated;
grant execute on function public.mark_moderation_digest_sent() to service_role;
revoke execute on function private.moderation_digest_payload() from public, anon, authenticated;
grant execute on function private.moderation_digest_payload() to service_role;
revoke execute on function private.mark_moderation_digest_sent() from public, anon, authenticated;
grant execute on function private.mark_moderation_digest_sent() to service_role;

-- ----------------------------------------------------------------------------
-- Hub gallery pages (anon welcome). Each returns one page plus `total` of
-- the filtered set (count(*) over()). p_query is substring ILIKE; %/_ in
-- the needle are escaped. limit is clamped to 1–48 (default 24). Hidden
-- listings are omitted (RLS also hides them from visitors).
-- ----------------------------------------------------------------------------

drop function if exists public.list_hub_publications(text, text, int, int);

create or replace function public.list_hub_publications(
    p_query text default '',
    p_tag text default null,
    p_limit int default 24,
    p_offset int default 0
)
returns table (
    workspace_id uuid,
    slug text,
    name text,
    description text,
    tags text[],
    listed_at timestamptz,
    username text,
    display_name text,
    allow_fork boolean,
    fork_count bigint,
    preview_key text,
    total bigint
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
    v_limit int := least(greatest(coalesce(p_limit, 24), 1), 48);
    v_offset int := greatest(coalesce(p_offset, 0), 0);
    v_tag text := nullif(trim(p_tag), '');
    v_like text;
begin
    if nullif(trim(p_query), '') is not null then
        v_like := '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    end if;

    return query
    select
        h.source_workspace_id,
        w.slug,
        w.name,
        h.description,
        h.tags,
        h.listed_at,
        p.username,
        p.display_name,
        h.allow_fork,
        h.fork_count,
        h.preview_key,
        count(*) over() as total
    from public.hub_publications h
    join public.workspaces w on w.id = h.source_workspace_id
    join public.profiles p on p.id = h.owner_id
    where p.username is not null
      and w.slug is not null
      and h.hidden_at is null
      and (v_tag is null or v_tag = any(h.tags))
      and (
          v_like is null
          or w.name ilike v_like escape '\'
          or h.description ilike v_like escape '\'
          or p.username ilike v_like escape '\'
          or coalesce(p.display_name, '') ilike v_like escape '\'
      )
    order by h.listed_at desc
    limit v_limit
    offset v_offset;
end
$$;

create or replace function public.list_hub_authors(
    p_query text default '',
    p_limit int default 24,
    p_offset int default 0
)
returns table (
    username text,
    display_name text,
    publication_count bigint,
    total bigint
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
    v_limit int := least(greatest(coalesce(p_limit, 24), 1), 48);
    v_offset int := greatest(coalesce(p_offset, 0), 0);
    v_like text;
begin
    if nullif(trim(p_query), '') is not null then
        v_like := '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    end if;

    return query
    select
        p.username,
        p.display_name,
        count(*)::bigint as publication_count,
        count(*) over() as total
    from public.hub_publications h
    join public.profiles p on p.id = h.owner_id
    where p.username is not null
      and h.hidden_at is null
      and (
          v_like is null
          or p.username ilike v_like escape '\'
          or coalesce(p.display_name, '') ilike v_like escape '\'
      )
    group by p.id, p.username, p.display_name
    order by count(*) desc, p.username
    limit v_limit
    offset v_offset;
end
$$;

create or replace function public.list_hub_tags(
    p_query text default '',
    p_limit int default 24,
    p_offset int default 0
)
returns table (
    name text,
    tag_count bigint,
    total bigint
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
    v_limit int := least(greatest(coalesce(p_limit, 24), 1), 48);
    v_offset int := greatest(coalesce(p_offset, 0), 0);
    v_like text;
begin
    if nullif(trim(p_query), '') is not null then
        v_like := '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    end if;

    return query
    select
        t.tag as name,
        count(*)::bigint as tag_count,
        count(*) over() as total
    from public.hub_publications h
    cross join lateral unnest(h.tags) as t(tag)
    where h.hidden_at is null
      and (v_like is null or t.tag ilike v_like escape '\')
    group by t.tag
    order by count(*) desc, t.tag
    limit v_limit
    offset v_offset;
end
$$;

grant execute on function public.list_hub_publications(text, text, int, int) to anon, authenticated;
grant execute on function public.list_hub_authors(text, int, int) to anon, authenticated;
grant execute on function public.list_hub_tags(text, int, int) to anon, authenticated;
revoke execute on function public.owner_usage() from public, anon;
grant execute on function public.owner_usage() to authenticated;

-- "This copy of the desktop app syncs this workspace", stamped in server
-- time. Invoker: the sync_devices policies decide (own row, a workspace
-- the caller can open)
create or replace function public.touch_sync_device(p_workspace uuid, p_device text)
returns void
language sql
security invoker
set search_path = public, extensions
as $$
    insert into public.sync_devices (owner_id, workspace_id, device_id)
    values ((select auth.uid()), p_workspace, p_device)
    on conflict (owner_id, workspace_id, device_id)
    do update set last_pass_at = now();
$$;

revoke execute on function public.touch_sync_device(uuid, text) from public, anon;
grant execute on function public.touch_sync_device(uuid, text) to authenticated;

-- plan_limits: the storage numbers of a plan (private.plan_defaults), to show
-- what another plan would give — the bridge preflight's "Pro: 50 GB, 1 GB per
-- file". The caller's own limits stay in billing_accounts
create or replace function public.plan_limits(p_plan text)
returns table (quota_bytes bigint, max_file_bytes bigint)
language sql
security invoker
stable
set search_path = public, extensions
as $$
    select d.quota_bytes, d.max_file_bytes from private.plan_defaults(p_plan) d;
$$;

revoke execute on function public.plan_limits(text) from public, anon;
grant execute on function public.plan_limits(text) to authenticated;

-- plan_catalog: every plan's limits in the order the app shows them, for the
-- plan chooser — room, file size and Hub listings (null = no limit) come from
-- plan_defaults, prices from the MoR (GET /billing/plans); the app keeps
-- neither list of numbers. Signed-in only, like plan_limits
create or replace function public.plan_catalog()
returns table (plan text, quota_bytes bigint, max_file_bytes bigint, max_hub_listings integer)
language sql
security invoker
stable
set search_path = public, extensions
as $$
    select p.plan, d.quota_bytes, d.max_file_bytes, d.max_hub_listings
      from unnest(array['free', 'pro', 'studio', 'max', 'ultra']) with ordinality as p(plan, n)
     cross join lateral private.plan_defaults(p.plan) d
     order by p.n;
$$;

revoke execute on function public.plan_catalog() from public, anon;
grant execute on function public.plan_catalog() to authenticated;

-- apply_billing_state: the billing adapter (apps/backend/src/billing) writes
-- the state it has just read back from the MoR — never the event's own
-- payload — in one transaction with the event's row: plan, status, interval,
-- the end of the period, the subscription id, and every limit of the plan
-- from plan_defaults (an unknown plan raises, so nothing is half-written).
-- p_synced_at is when the adapter read that state: a read older than the one
-- already applied changes nothing ('stale'), so two deliveries racing each
-- other cannot roll a plan back, and a repeated event id is recorded once.
-- 'no_account' when the account is gone; the event row stays for the trail.
-- p_next_plan / p_next_plan_at: a change the MoR has scheduled for the end of
-- the period (a downgrade), shown on the account page; omitted, they clear.
-- Over-limit data is never touched here: lower limits only stop growth
-- (assert_owner_can_add). Service role only.
-- The ten-argument form came first; a call naming only those ten still
-- resolves here, the scheduled change then empty
drop function if exists public.apply_billing_state(uuid, text, text, text, timestamptz, boolean, text, timestamptz, text, jsonb);
drop function if exists private.apply_billing_state(uuid, text, text, text, timestamptz, boolean, text, timestamptz, text, jsonb);

create or replace function private.apply_billing_state(
    p_owner uuid,
    p_plan text,
    p_status text,
    p_interval text,
    p_period_end timestamptz,
    p_cancel_at_period_end boolean,
    p_subscription_id text,
    p_synced_at timestamptz,
    p_event_id text,
    p_event jsonb,
    p_next_plan text default null,
    p_next_plan_at timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_synced timestamptz;
    d record;
begin
    if p_synced_at is null then
        raise exception 'apply_billing_state: p_synced_at is required';
    end if;
    -- a scheduled plan must be one plan_defaults knows (it raises otherwise)
    if p_next_plan is not null then
        perform 1 from private.plan_defaults(p_next_plan);
    end if;
    if p_event_id is not null then
        insert into public.billing_events (event_id, payload)
        values (p_event_id, coalesce(p_event, '{}'::jsonb))
        on conflict (event_id) do nothing;
    end if;

    select b.billing_synced_at into v_synced
      from public.billing_accounts b
     where b.owner_id = p_owner
     for update;
    if not found then
        return 'no_account';
    end if;
    if v_synced is not null and p_synced_at <= v_synced then
        return 'stale';
    end if;

    select * into d from private.plan_defaults(p_plan);

    update public.billing_accounts
       set plan = p_plan,
           plan_status = p_status,
           quota_bytes = d.quota_bytes,
           max_file_bytes = d.max_file_bytes,
           max_hub_listings = d.max_hub_listings,
           max_entries = d.max_entries,
           max_strokes = d.max_strokes,
           max_connections = d.max_connections,
           egress_bytes_month = d.egress_bytes_month,
           max_public_file_bytes = d.max_public_file_bytes,
           download_bytes_month = d.download_bytes_month,
           billing_interval = p_interval,
           period_end = p_period_end,
           cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
           next_plan = case when p_next_plan_at is null then null else p_next_plan end,
           next_plan_at = case when p_next_plan is null then null else p_next_plan_at end,
           external_subscription_id = p_subscription_id,
           grace_until = null,
           billing_synced_at = p_synced_at,
           updated_at = now()
     where owner_id = p_owner;
    return 'applied';
end
$$;

create or replace function public.apply_billing_state(
    p_owner uuid,
    p_plan text,
    p_status text,
    p_interval text,
    p_period_end timestamptz,
    p_cancel_at_period_end boolean,
    p_subscription_id text,
    p_synced_at timestamptz,
    p_event_id text,
    p_event jsonb,
    p_next_plan text default null,
    p_next_plan_at timestamptz default null
)
returns text
language sql
security invoker
set search_path = public, extensions
as $$
    select private.apply_billing_state(p_owner, p_plan, p_status, p_interval, p_period_end,
        p_cancel_at_period_end, p_subscription_id, p_synced_at, p_event_id, p_event,
        p_next_plan, p_next_plan_at);
$$;

revoke execute on function public.apply_billing_state(uuid, text, text, text, timestamptz, boolean, text, timestamptz, text, jsonb, text, timestamptz)
    from public, anon, authenticated;
grant execute on function public.apply_billing_state(uuid, text, text, text, timestamptz, boolean, text, timestamptz, text, jsonb, text, timestamptz)
    to service_role;
revoke execute on function private.apply_billing_state(uuid, text, text, text, timestamptz, boolean, text, timestamptz, text, jsonb, text, timestamptz)
    from public, anon, authenticated;
grant execute on function private.apply_billing_state(uuid, text, text, text, timestamptz, boolean, text, timestamptz, text, jsonb, text, timestamptz)
    to service_role;
revoke execute on function public.assert_owner_quota(uuid, bigint, bigint) from public, anon;
grant execute on function public.assert_owner_quota(uuid, bigint, bigint) to authenticated;

create or replace function public.fork_workspace(p_workspace uuid)
returns uuid
language sql
security invoker
set search_path = public, extensions
as $$
    select private.fork_workspace(p_workspace);
$$;

create or replace function public.invite_workspace_member(
    p_inviter uuid,
    p_workspace uuid,
    p_email text,
    p_role text
)
returns json
language sql
security invoker
set search_path = public, extensions
as $$
    select private.add_workspace_member(p_inviter, p_workspace, p_email, p_role);
$$;

create or replace function public.preview_workspace_invite(p_token text)
returns json
language sql
security invoker
stable
set search_path = public, extensions
as $$
    select private.preview_workspace_invite(p_token);
$$;

grant execute on function public.preview_workspace_invite(text) to anon, authenticated;
-- the backend only (service role): see add_workspace_member. Both were
-- created above, which grants EXECUTE to PUBLIC; take it back first
revoke execute on function public.invite_workspace_member(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.invite_workspace_member(uuid, uuid, text, text) to service_role;
revoke execute on function private.add_workspace_member(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function private.add_workspace_member(uuid, uuid, text, text) to service_role;

-- claim_workspace_invites: kept only for desktop builds released before
-- invites needed an explicit "Accept" (they call it on the /invite page).
-- It no longer turns anything into a membership: one link used to accept
-- every invite to the address at once, unasked. Drop it in a later diff,
-- once no supported build calls it
drop function if exists private.claim_workspace_invites(uuid, text);

create or replace function private.claim_workspace_invites()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if auth.uid() is null then
        raise exception 'claim_workspace_invites: not authenticated';
    end if;
end
$$;

create or replace function public.claim_workspace_invites()
returns void
language sql
security invoker
set search_path = public, extensions
as $$
    select private.claim_workspace_invites();
$$;

create or replace function public.list_my_invites()
returns table (
    workspace_id uuid,
    workspace_name text,
    role text,
    inviter text,
    created_at timestamptz,
    expires_at timestamptz
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
    select * from private.list_my_invites();
$$;

create or replace function public.accept_workspace_invite(p_workspace uuid)
returns boolean
language sql
security invoker
set search_path = public, extensions
as $$
    select private.accept_workspace_invite(p_workspace);
$$;

create or replace function public.decline_workspace_invite(p_workspace uuid)
returns boolean
language sql
security invoker
set search_path = public, extensions
as $$
    select private.decline_workspace_invite(p_workspace);
$$;

create or replace function public.leave_workspace(p_workspace uuid)
returns boolean
language sql
security invoker
set search_path = public, extensions
as $$
    select private.leave_workspace(p_workspace);
$$;

revoke execute on function public.list_my_invites() from public, anon;
grant execute on function public.list_my_invites() to authenticated;
revoke execute on function private.list_my_invites() from public, anon;
grant execute on function private.list_my_invites() to authenticated;
revoke execute on function public.accept_workspace_invite(uuid) from public, anon;
grant execute on function public.accept_workspace_invite(uuid) to authenticated;
revoke execute on function private.accept_workspace_invite(uuid) from public, anon;
grant execute on function private.accept_workspace_invite(uuid) to authenticated;
revoke execute on function public.decline_workspace_invite(uuid) from public, anon;
grant execute on function public.decline_workspace_invite(uuid) to authenticated;
revoke execute on function private.decline_workspace_invite(uuid) from public, anon;
grant execute on function private.decline_workspace_invite(uuid) to authenticated;
revoke execute on function public.leave_workspace(uuid) from public, anon;
grant execute on function public.leave_workspace(uuid) to authenticated;
revoke execute on function private.leave_workspace(uuid) from public, anon;
grant execute on function private.leave_workspace(uuid) to authenticated;

revoke all on function public.claim_workspace_invites() from public, anon;
grant execute on function public.claim_workspace_invites() to authenticated;
revoke execute on function private.claim_workspace_invites() from public, anon;
grant execute on function private.claim_workspace_invites() to authenticated;

create or replace function public.list_workspace_members(p_workspace uuid)
returns table (user_id uuid, email text, role text, created_at timestamptz)
language sql
security invoker
stable
set search_path = public, extensions
as $$
    select * from private.list_workspace_members(p_workspace);
$$;

create or replace function public.list_subtree_files(p_root uuid)
returns table (id uuid, workspace_id uuid, storage_key text)
language sql
security invoker
stable
set search_path = public, extensions
as $$
    select * from private.list_subtree_files(p_root);
$$;

-- backend-only (service role): lists blob keys of an arbitrary subtree with
-- no access check inside, so user roles must not be able to call it. The
-- PUBLIC revoke matters: EXECUTE on new functions defaults to PUBLIC, and
-- revoking only the roles leaves the PUBLIC grant in place. The private
-- function is revoked too — a path with no access check should not depend on
-- the private schema staying out of the Data API
revoke execute on function public.list_subtree_files(uuid) from public, anon, authenticated;
grant execute on function public.list_subtree_files(uuid) to service_role;
revoke execute on function private.list_subtree_files(uuid) from public, anon, authenticated;
grant execute on function private.list_subtree_files(uuid) to service_role;

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

create or replace function public.create_blob_entry(
    p_id uuid,
    p_workspace uuid,
    p_parent uuid,
    p_name text,
    p_mime text,
    p_storage_key text,
    p_size_bytes bigint,
    p_user uuid,
    p_client_id text default null
)
returns json
language sql
security invoker
set search_path = public, extensions
as $$
    select private.create_blob_entry(
        p_id, p_workspace, p_parent, p_name, p_mime, p_storage_key,
        p_size_bytes, p_user, p_client_id
    );
$$;

-- backend-only (service role): trusts p_user/p_size_bytes, which only the
-- backend can vouch for (it verified the JWT and stat'ed the object)
revoke execute on function public.create_blob_entry(uuid, uuid, uuid, text, text, text, bigint, uuid, text)
    from public, anon, authenticated;
grant execute on function public.create_blob_entry(uuid, uuid, uuid, text, text, text, bigint, uuid, text)
    to service_role;
revoke execute on function private.create_blob_entry(uuid, uuid, uuid, text, text, text, bigint, uuid, text)
    from public, anon, authenticated;
grant execute on function private.create_blob_entry(uuid, uuid, uuid, text, text, text, bigint, uuid, text)
    to service_role;

create or replace function public.replace_blob_entry(
    p_entry uuid,
    p_workspace uuid,
    p_storage_key text,
    p_size_bytes bigint,
    p_mime text,
    p_user uuid,
    p_client_id text default null
)
returns json
language sql
security invoker
set search_path = public, extensions
as $$
    select private.replace_blob_entry(
        p_entry, p_workspace, p_storage_key, p_size_bytes, p_mime, p_user, p_client_id
    );
$$;

-- backend-only, like create_blob_entry: p_user and the object size are the
-- backend's word, after it verified the JWT and stat'ed the copy
revoke execute on function public.replace_blob_entry(uuid, uuid, text, bigint, text, uuid, text)
    from public, anon, authenticated;
grant execute on function public.replace_blob_entry(uuid, uuid, text, bigint, text, uuid, text)
    to service_role;
revoke execute on function private.replace_blob_entry(uuid, uuid, text, bigint, text, uuid, text)
    from public, anon, authenticated;
grant execute on function private.replace_blob_entry(uuid, uuid, text, bigint, text, uuid, text)
    to service_role;

create or replace function public.record_hub_preview_upload(
    p_storage_key text,
    p_size_bytes bigint,
    p_user uuid
)
returns void
language sql
security invoker
set search_path = public, extensions
as $$
    select private.record_hub_preview_upload(p_storage_key, p_size_bytes, p_user);
$$;

-- backend-only (service role): POST /hub-preview/finalize stat'ed the object
revoke execute on function public.record_hub_preview_upload(text, bigint, uuid)
    from public, anon, authenticated;
grant execute on function public.record_hub_preview_upload(text, bigint, uuid) to service_role;
revoke execute on function private.record_hub_preview_upload(text, bigint, uuid)
    from public, anon, authenticated;
grant execute on function private.record_hub_preview_upload(text, bigint, uuid) to service_role;

create or replace function public.download_target(p_entry uuid)
returns table (
    owner_id uuid,
    storage_key text,
    size_bytes bigint,
    is_member boolean,
    deriv_key text,
    deriv_size_bytes bigint,
    deriv_kind text,
    allow_download boolean
)
language sql
security invoker
stable
set search_path = public, extensions
as $$
    select * from private.download_target(p_entry);
$$;

create or replace function public.hub_preview_target(p_key text)
returns table (owner_id uuid, size_bytes bigint)
language sql
security invoker
stable
set search_path = public, extensions
as $$
    select * from private.hub_preview_target(p_key);
$$;

-- readers behind GET /presign and GET /hub-preview: they reveal only what the
-- caller can already read (the entry row, the Hub listing) and never count
-- anything, so anon may call them — a visitor cannot burn a budget here
grant execute on function public.download_target(uuid) to anon, authenticated;
grant execute on function public.hub_preview_target(text) to anon, authenticated;

create or replace function public.egress_sync(p_today date, p_rows jsonb)
returns table (
    owner_id uuid,
    day_bytes bigint,
    month_bytes bigint,
    egress_bytes_month bigint,
    max_public_file_bytes bigint
)
language sql
security invoker
set search_path = public, extensions
as $$
    select * from private.egress_sync(p_today, p_rows);
$$;

-- backend-only (service role): the byte counts are the backend's own. The
-- private function is revoked too — a write path should not rely on the
-- private schema staying unexposed
revoke execute on function public.egress_sync(date, jsonb) from public, anon, authenticated;
grant execute on function public.egress_sync(date, jsonb) to service_role;
revoke execute on function private.egress_sync(date, jsonb) from public, anon, authenticated;
grant execute on function private.egress_sync(date, jsonb) to service_role;

create or replace function public.download_sync(p_today date, p_rows jsonb)
returns table (
    user_id uuid,
    day_bytes bigint,
    month_bytes bigint,
    download_bytes_month bigint
)
language sql
security invoker
set search_path = public, extensions
as $$
    select * from private.download_sync(p_today, p_rows);
$$;

-- backend-only (service role), like egress_sync
revoke execute on function public.download_sync(date, jsonb) from public, anon, authenticated;
grant execute on function public.download_sync(date, jsonb) to service_role;
revoke execute on function private.download_sync(date, jsonb) from public, anon, authenticated;
grant execute on function private.download_sync(date, jsonb) to service_role;

create or replace function public.list_pending_derivatives(
    p_kinds text[],
    p_max_attempts int,
    p_limit int default 10
)
returns table (storage_key text, kind text, mime text, size_bytes bigint, attempts int)
language sql
security invoker
stable
set search_path = public, extensions
as $$
    select * from private.list_pending_derivatives(p_kinds, p_max_attempts, p_limit);
$$;

create or replace function public.record_derivative(
    p_storage_key text,
    p_kind text,
    p_status text,
    p_deriv_key text,
    p_deriv_size_bytes bigint,
    p_width int,
    p_height int,
    p_reason text
)
returns boolean
language sql
security invoker
set search_path = public, extensions
as $$
    select private.record_derivative(
        p_storage_key, p_kind, p_status, p_deriv_key, p_deriv_size_bytes,
        p_width, p_height, p_reason
    );
$$;

create or replace function public.fail_derivative(
    p_storage_key text,
    p_kind text,
    p_error text,
    p_backoff_minutes int
)
returns int
language sql
security invoker
set search_path = public, extensions
as $$
    select private.fail_derivative(p_storage_key, p_kind, p_error, p_backoff_minutes);
$$;

create or replace function public.prune_entry_derivatives(p_limit int default 1000)
returns int
language sql
security invoker
set search_path = public, extensions
as $$
    select private.prune_entry_derivatives(p_limit);
$$;

-- backend-only (service role): the preview worker's queue and decisions and
-- the reconcile prune. They write and trust the backend's word on objects,
-- so the private functions are revoked too, like egress_sync
revoke execute on function public.list_pending_derivatives(text[], int, int) from public, anon, authenticated;
grant execute on function public.list_pending_derivatives(text[], int, int) to service_role;
revoke execute on function private.list_pending_derivatives(text[], int, int) from public, anon, authenticated;
grant execute on function private.list_pending_derivatives(text[], int, int) to service_role;

revoke execute on function public.record_derivative(text, text, text, text, bigint, int, int, text)
    from public, anon, authenticated;
grant execute on function public.record_derivative(text, text, text, text, bigint, int, int, text) to service_role;
revoke execute on function private.record_derivative(text, text, text, text, bigint, int, int, text)
    from public, anon, authenticated;
grant execute on function private.record_derivative(text, text, text, text, bigint, int, int, text) to service_role;

revoke execute on function public.fail_derivative(text, text, text, int) from public, anon, authenticated;
grant execute on function public.fail_derivative(text, text, text, int) to service_role;
revoke execute on function private.fail_derivative(text, text, text, int) from public, anon, authenticated;
grant execute on function private.fail_derivative(text, text, text, int) to service_role;

revoke execute on function public.prune_entry_derivatives(int) from public, anon, authenticated;
grant execute on function public.prune_entry_derivatives(int) to service_role;
revoke execute on function private.prune_entry_derivatives(int) from public, anon, authenticated;
grant execute on function private.prune_entry_derivatives(int) to service_role;

-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- What a visitor without a session may call. A new function is executable
-- by PUBLIC, so every wrapper above was an endpoint anyone with the
-- publishable key could hit. None of these did anything for a caller
-- without auth.uid(): each raised after a lookup or two. That lookup is the
-- cost: unauthenticated requests doing real work, held back by the rate
-- limiter alone. They are for signed-in callers now, and PostgREST refuses
-- the rest before the function runs.
--
-- Left to anon, because a public board and the Hub are read without an
-- account: folder_read, workspace_usage, download_target,
-- hub_preview_target, list_hub_publications, list_hub_authors,
-- list_hub_tags, preview_workspace_invite. rls.test.sql holds the list: a
-- new wrapper fails the suite until it is placed on one side.
-- ----------------------------------------------------------------------------
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
