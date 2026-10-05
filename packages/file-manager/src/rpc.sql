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
-- create_workspace: workspace + root entry (path '/', parent_id null)
-- The root create in board view by default (xattrs.view). p_desktop pins
-- the workspace to a cloud desktop's board (a folder child); the desktop
-- must be the caller's own.
-- ----------------------------------------------------------------------------

create or replace function private.create_workspace(p_name text, p_desktop uuid default null)
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
    if p_desktop is not null and not private.is_desktop_owner(p_desktop) then
        raise exception 'create_workspace: desktop % not found or not yours', p_desktop;
    end if;

    perform private.assert_owner_entries(auth.uid(), 1);

    insert into public.workspaces (owner_id, name, desktop_id)
    values (auth.uid(), p_name, p_desktop)
    returning id into v_workspace_id;

    insert into public.entries (workspace_id, parent_id, name, kind, xattrs)
    values (v_workspace_id, null, '', 'folder', '{"view": "board"}');

    return v_workspace_id;
end
$$;

-- ----------------------------------------------------------------------------
-- get_or_create_system_workspace: the hidden per-user workspace holding
-- desktop board FILES (/desktop-<id>/ folders). Idempotent; the partial
-- unique index workspaces_system_unique makes concurrent calls safe.
-- Filtered out of workspace lists; public/remove/share are forbidden (see
-- workspaces_insert/delete policies, set_workspace_public, add_workspace_member)
-- ----------------------------------------------------------------------------

create or replace function private.get_or_create_system_workspace()
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_id uuid;
begin
    if auth.uid() is null then
        raise exception 'get_or_create_system_workspace: not authenticated';
    end if;

    select w.id into v_id from public.workspaces w
     where w.owner_id = auth.uid() and w.is_system
     limit 1;
    if v_id is not null then
        return v_id;
    end if;

    perform private.assert_owner_entries(auth.uid(), 1);

    insert into public.workspaces (owner_id, name, is_system)
    values (auth.uid(), 'system', true)
    on conflict (owner_id) where is_system do nothing
    returning id into v_id;

    if v_id is null then
        -- lost the race: the concurrent call created it
        select w.id into v_id from public.workspaces w
         where w.owner_id = auth.uid() and w.is_system
         limit 1;
        return v_id;
    end if;

    insert into public.entries (workspace_id, parent_id, name, kind)
    values (v_id, null, '', 'folder');

    return v_id;
end
$$;

-- ----------------------------------------------------------------------------
-- set_workspace_xattr: single-key merge into workspaces.xattrs (jsonb_set),
-- mirroring fm.set_xattr semantics for entries — a whole-object overwrite
-- would lose keys written concurrently. Owner only: the board tile layout
-- belongs to the desktop owner.
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
-- (the entries.xattrs convention), each path at most once. Refused rows come
-- back instead of aborting the batch: 'missing' (gone, trashed, or not in
-- this workspace) and 'too_large' (the merge would break the 64 KB xattrs
-- CHECK; the row stays untouched)
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
                        where jsonb_typeof(a.value) <> 'string'
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
        select i->>'path' as item_path, i->'xattrs' as patch
          from jsonb_array_elements(p_items) i
    ),
    targets as (
        select e.id as entry_id,
               it.item_path,
               it.patch,
               pg_column_size(e.xattrs || it.patch) <= 65536 as fits
          from items it
          join public.entries e
            on e.workspace_id = p_workspace
           and e.path = it.item_path
           and e.deleted_at is null
    ),
    merged as (
        update public.entries e
           set xattrs = e.xattrs || t.patch,
               updated_by_client = p_client_id
          from targets t
         where e.id = t.entry_id
           and t.fits
    )
    select it.item_path,
           case when t.entry_id is null then 'missing' else 'too_large' end
      from items it
      left join targets t on t.item_path = it.item_path
     where t.entry_id is null
        or not t.fits;
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
-- asynchronously
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
    if not private.can_write_workspace(v_entry.workspace_id) then
        raise exception 'purge_entry: access denied';
    end if;

    delete from public.entries d
     where d.node_path <@ v_entry.node_path
       and d.deleted_at is not null;
end
$$;

create or replace function private.purge_trash(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if not private.can_write_workspace(p_workspace) then
        raise exception 'purge_trash: access denied';
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

    select * into v_workspace from public.workspaces w where w.id = p_workspace;
    if not found then
        raise exception 'set_workspace_public: workspace % not found', p_workspace;
    end if;
    if v_workspace.is_system then
        raise exception 'set_workspace_public: cannot make the system workspace public';
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
-- (no cascade from a non-delete). Owner only; system workspace is a no-op
-- path because it can never be public.
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
-- set_hub_listing / remove_from_hub: the /hub gallery rows. Owner only; the
-- workspace must already be public (the card links to /<username>/<slug>).
-- Description, tags, and preview_key are optional; each tag is validated
-- against the lowercase slug pattern. preview_key is a B2 object
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

    foreach v_tag in array coalesce(p_tags, '{}') loop
        if v_tag !~ '^[a-z0-9][a-z0-9-]{1,31}$' then
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
-- (workspace, reporter). Accounts younger than 7 days still report; they
-- do not count toward auto-hide. 20 reports / reporter / day.
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
-- GC sweep (list_foreign_blob_entries) catches whatever that call missed
-- ----------------------------------------------------------------------------
create or replace function private.fork_workspace(p_workspace uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_source public.workspaces%rowtype;
    v_workspace_id uuid;
    -- the loop row carries entry_contents.content alongside e.*, so a
    -- concrete %rowtype does not fit
    v_row record;
    v_new_id uuid;
    v_new_parent_id uuid;
    v_delta bigint;
    v_rows int;
begin
    if auth.uid() is null then
        raise exception 'fork_workspace: not authenticated';
    end if;
    if not private.can_read_workspace(p_workspace) then
        raise exception 'fork_workspace: workspace % is not public', p_workspace;
    end if;
    perform private.lock_workspace_tree(p_workspace);

    select * into v_source from public.workspaces w
     where w.id = p_workspace and w.is_public;
    if not found then
        raise exception 'fork_workspace: workspace % is not public', p_workspace;
    end if;
    if not v_source.allow_fork then
        raise exception 'fork_workspace: this workspace does not allow forks';
    end if;

    select coalesce(sum(e.size_bytes), 0), count(*) into v_delta, v_rows
      from public.entries e
     where e.workspace_id = p_workspace
       and e.deleted_at is null;
    perform private.assert_owner_can_add(auth.uid(), v_delta, null);
    perform private.assert_owner_entries(auth.uid(), v_rows);

    insert into public.workspaces (owner_id, name, xattrs)
    values (auth.uid(), v_source.name, v_source.xattrs)
    returning id into v_workspace_id;

    drop table if exists pg_temp.fork_map;
    create temp table fork_map (
        old_id uuid primary key,
        new_id uuid not null
    ) on commit drop;

    for v_row in
        select e.*, c.content as text_content
          from public.entries e
          left join public.entry_contents c on c.entry_id = e.id
         where e.workspace_id = p_workspace
           and e.deleted_at is null
        order by nlevel(e.node_path)
    loop
        v_new_id := gen_random_uuid();
        if v_row.parent_id is null then
            v_new_parent_id := null;
        else
            select m.new_id into v_new_parent_id
              from fork_map m
             where m.old_id = v_row.parent_id;
        end if;

        insert into public.entries (id, workspace_id, parent_id, name, kind, mime, xattrs, storage_key, size_bytes)
        values (v_new_id, v_workspace_id, v_new_parent_id, v_row.name, v_row.kind,
                v_row.mime, v_row.xattrs, v_row.storage_key,
                case when v_row.storage_key is not null then v_row.size_bytes end);

        if v_row.text_content is not null then
            insert into public.entry_contents (entry_id, workspace_id, content)
            values (v_new_id, v_workspace_id, v_row.text_content);
        end if;

        insert into fork_map (old_id, new_id) values (v_row.id, v_new_id);
    end loop;

    insert into public.folder_strokes (id, entry_id, workspace_id, z, position, points,
                                       color, stroke_width, width, height)
    select gen_random_uuid(), m.new_id, v_workspace_id, s.z, s.position, s.points,
           s.color, s.stroke_width, s.width, s.height
      from public.folder_strokes s
      join fork_map m on m.old_id = s.entry_id;

    insert into public.folder_connections (id, entry_id, workspace_id, from_entry, to_entry, props)
    select concat(mf.new_id, ':', coalesce(s.props->>'from_handle', 'default'), '-',
                  mt.new_id, ':', coalesce(s.props->>'to_handle', 'default')),
           mf_owner.new_id, v_workspace_id, mf.new_id, mt.new_id,
           s.props
      from public.folder_connections s
      join fork_map mf_owner on mf_owner.old_id = s.entry_id
      join fork_map mf on mf.old_id = s.from_entry
      join fork_map mt on mt.old_id = s.to_entry;

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
-- list_foreign_blob_entries: every row (live or trashed) whose blob sits
-- under another workspace's prefix, oldest first. The backend GC tick
-- drains this list (see apps/backend/src/gc.ts): the client's call to
-- /blobs/copy-clones right after a fork is only an accelerator — if the tab
-- closes first, this sweep still gives the fork its own objects, so the
-- source owner's later deletes actually free their blobs. Backed by the
-- partial index entries_foreign_blob_idx (schema.sql). Service role only
-- ----------------------------------------------------------------------------

create or replace function private.list_foreign_blob_entries(p_limit int default 100)
returns table (id uuid, workspace_id uuid, storage_key text)
language sql
security definer
stable
set search_path = public, extensions
as $$
    select e.id, e.workspace_id, e.storage_key
      from public.entries e
     where e.storage_key is not null
       and lower(left(e.storage_key, 36)) <> e.workspace_id::text
     order by e.created_at
     limit least(greatest(coalesce(p_limit, 100), 1), 1000);
$$;

-- ----------------------------------------------------------------------------
-- Preview derivatives (entry_derivatives in schema.sql, the worker in
-- apps/backend/src/derivatives.ts). The worker PULLS its work, like the
-- re-key sweep above: there is no enqueue at /finalize or at re-key to
-- forget, uploads made before a deploy are backfilled, and a crash in the
-- middle of a generation is simply picked up again. Only public workspaces:
-- previews go to non-members, and a non-member sees public boards alone —
-- publishing a board makes its blobs pending on the next tick, and until
-- then visitors get the original under max_public_file_bytes, as before.
-- Trashed rows count: the trash is restorable. All four are service role
-- only (revoked at the bottom of this file, private functions included)
-- ----------------------------------------------------------------------------

-- list_pending_derivatives: blobs that still need a decision for the kind
-- their mime maps to (image/* → thumb, video/* → poster; p_kinds lets the
-- backend leave video out while posters are off): no row yet, or a failed
-- row past its backoff with attempts left. One row per key — copies share
-- the object — oldest blob first. The grouping runs over every public blob
-- per call; fine at this scale, a cursor or a pending flag later
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
             and w.is_public
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

    select w.owner_id into v_owner from public.workspaces w where w.id = p_workspace;
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
        select 1 from public.workspaces w where w.id = p_workspace
        and (w.owner_id = p_user or (p_kind = 'blob' and exists (
            select 1 from public.workspace_members m where m.workspace_id = w.id
            and m.user_id = p_user and m.role = 'editor'
        )))
    ) then
        raise exception 'upload: access denied';
    end if;
end;
$$;

create or replace function private.register_upload(
    p_workspace uuid, p_user uuid, p_kind text, p_ext text, p_ttl int
)
returns text
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_key text;
begin
    perform private.assert_upload_access(p_workspace, p_user, p_kind);
    if p_ext is null or p_ext !~ '^(\.[a-z0-9]{1,16})?$'
       or (p_kind = 'hub_preview' and p_ext !~ '^\.(jpe?g|png|webp)$')
       or p_ttl is null or p_ttl < 1 or p_ttl > 604800 then
        raise exception 'upload: invalid extension or lifetime';
    end if;
    v_key := 'uploads/' || p_kind || '/' || p_workspace::text || '/' || gen_random_uuid()::text || p_ext;
    insert into private.upload_sessions(storage_key, workspace_id, uploaded_by, kind, expires_at)
    values (v_key, p_workspace, p_user, p_kind, clock_timestamp() + make_interval(secs => p_ttl + 1800));
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
    select case when p_kind = 'hub_preview' then 2097152 else b.max_file_bytes end into v_max
    from public.workspaces w join public.billing_accounts b on b.owner_id = w.owner_id
    where w.id = v_upload.workspace_id;
    return jsonb_build_object('workspace_id', v_upload.workspace_id, 'max_bytes', v_max, 'result', v_upload.result);
end;
$$;

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
    if p_kind = 'blob' then
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

create or replace function public.register_upload(p_workspace uuid, p_user uuid, p_kind text, p_ext text, p_ttl int)
returns text language sql security invoker set search_path = public, extensions
as $$ select private.register_upload(p_workspace, p_user, p_kind, p_ext, p_ttl); $$;
create or replace function public.prepare_upload(p_key text, p_user uuid, p_kind text, p_request jsonb)
returns jsonb language sql security invoker set search_path = public, extensions
as $$ select private.prepare_upload(p_key, p_user, p_kind, p_request); $$;
create or replace function public.complete_upload(p_key text, p_user uuid, p_kind text, p_request jsonb, p_final_key text, p_size bigint)
returns jsonb language sql security invoker set search_path = public, extensions
as $$ select private.complete_upload(p_key, p_user, p_kind, p_request, p_final_key, p_size); $$;

revoke execute on function private.assert_upload_access(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function private.register_upload(uuid, uuid, text, text, int) from public, anon, authenticated;
revoke execute on function public.register_upload(uuid, uuid, text, text, int) from public, anon, authenticated;
revoke execute on function private.prepare_upload(text, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.prepare_upload(text, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function private.complete_upload(text, uuid, text, jsonb, text, bigint) from public, anon, authenticated;
revoke execute on function public.complete_upload(text, uuid, text, jsonb, text, bigint) from public, anon, authenticated;
grant execute on function private.register_upload(uuid, uuid, text, text, int) to service_role;
grant execute on function public.register_upload(uuid, uuid, text, text, int) to service_role;
grant execute on function private.prepare_upload(text, uuid, text, jsonb) to service_role;
grant execute on function public.prepare_upload(text, uuid, text, jsonb) to service_role;
grant execute on function private.complete_upload(text, uuid, text, jsonb, text, bigint) to service_role;
grant execute on function public.complete_upload(text, uuid, text, jsonb, text, bigint) to service_role;

-- ----------------------------------------------------------------------------
-- add_workspace_member: share a workspace by exact email. User discovery is
-- impossible through RLS (auth.users is not exposed), so the lookup happens
-- here under security definer. Owner only. This is the ONLY insert path
-- for workspace_members and workspace_invites (clients have no INSERT).
-- Registered email → member; otherwise a pending invite (email is sent by
-- the backend, not from this function). Repeat (workspace, email) upserts
-- role/token/expiry. Role changes/removals of members need no RPC:
-- members_update (column grant: role) / members_delete allow them to the
-- owner directly. Pending revoke is a direct DELETE on workspace_invites.
-- ----------------------------------------------------------------------------

drop function if exists public.add_workspace_member(uuid, text, text);
drop function if exists private.add_workspace_member(uuid, text, text);

create or replace function private.add_workspace_member(
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
    v_user_id uuid;
    v_email text;
    v_token text;
    v_name text;
    v_inviter text;
    v_live boolean;
    v_pending int;
begin
    if auth.uid() is null then
        raise exception 'add_workspace_member: not authenticated';
    end if;
    if exists (
        select 1 from public.workspaces w
         where w.id = p_workspace and w.is_system
    ) then
        raise exception 'add_workspace_member: the system workspace cannot be shared';
    end if;
    if not private.is_workspace_owner(p_workspace) then
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

    select u.id into v_user_id
      from auth.users u
     where lower(u.email) = v_email;

    if v_user_id is not null then
        if v_user_id = auth.uid() then
            raise exception 'add_workspace_member: the owner needs no membership';
        end if;
        if exists (
            select 1 from public.workspace_members m
             where m.workspace_id = p_workspace and m.user_id = v_user_id
        ) then
            raise exception 'add_workspace_member: already a member';
        end if;

        insert into public.workspace_members (workspace_id, user_id, role)
        values (p_workspace, v_user_id, p_role);
        delete from public.workspace_invites
         where workspace_id = p_workspace and email = v_email;
        return json_build_object('kind', 'member');
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
         where i.invited_by = auth.uid() and i.expires_at > now();
        if v_pending >= 20 then
            raise exception 'add_workspace_member: too many pending invites';
        end if;
    end if;

    v_token := encode(gen_random_bytes(32), 'hex');
    insert into public.workspace_invites (
        workspace_id, email, role, invited_by, token, expires_at
    )
    values (
        p_workspace, v_email, p_role, auth.uid(), v_token,
        now() + interval '14 days'
    )
    on conflict (workspace_id, email) do update
        set role = excluded.role,
            token = excluded.token,
            invited_by = excluded.invited_by,
            expires_at = excluded.expires_at;

    select w.name into v_name from public.workspaces w where w.id = p_workspace;
    select coalesce(nullif(p.display_name, ''), p.username, u.email::text)
      into v_inviter
      from auth.users u
      left join public.profiles p on p.id = u.id
     where u.id = auth.uid();

    return json_build_object(
        'kind', 'pending',
        'token', v_token,
        'workspace_name', coalesce(v_name, ''),
        'inviter', coalesce(v_inviter, '')
    );
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
       and i.expires_at > now();
    return v_row;
end
$$;

-- ----------------------------------------------------------------------------
-- list_workspace_members: members with emails for the share dialog. The join
-- to auth.users is possible only under security definer; access mirrors the
-- members_select policy (owner or member)
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
    if not (
        private.is_workspace_owner(p_workspace)
        or private.is_workspace_member(p_workspace)
    ) then
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

create or replace function public.create_workspace(p_name text, p_desktop uuid default null)
returns uuid
language sql
security invoker
set search_path = public, extensions
as $$
    select private.create_workspace(p_name, p_desktop);
$$;

create or replace function public.get_or_create_system_workspace()
returns uuid
language sql
security invoker
set search_path = public, extensions
as $$
    select private.get_or_create_system_workspace();
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

create or replace function public.add_workspace_member(
    p_workspace uuid,
    p_email text,
    p_role text
)
returns json
language sql
security invoker
set search_path = public, extensions
as $$
    select private.add_workspace_member(p_workspace, p_email, p_role);
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
-- revoke BEFORE granting: both functions are dropped and recreated above, which
-- resets EXECUTE to PUBLIC, and a grant to `authenticated` does not take the
-- inherited PUBLIC one away. Without this line anon kept the wrapper (found by
-- the grant assertions in rls.test.sql, 2026-09-16)
revoke execute on function public.add_workspace_member(uuid, text, text) from public, anon;
grant execute on function public.add_workspace_member(uuid, text, text) to authenticated;
-- the wrapper is security invoker, so authenticated must keep EXECUTE on the
-- private function; the inherited PUBLIC grant (and anon) does not. Both were
-- dropped and recreated above, which resets EXECUTE to PUBLIC
revoke execute on function private.add_workspace_member(uuid, text, text) from public, anon;
grant execute on function private.add_workspace_member(uuid, text, text) to authenticated;

-- Existing session (invite landed after signup, or the address was pending
-- because the user row was missing at share time). Same conversion as
-- handle_new_user, bound to auth.uid() so the (uuid, text) overload never
-- needs a client EXECUTE. Public wrapper is invoker, matching
-- add_workspace_member: a public SECURITY DEFINER would trip the
-- authenticated_security_definer_function_executable advisor.
create or replace function private.claim_workspace_invites()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_email text;
begin
    if auth.uid() is null then
        raise exception 'claim_workspace_invites: not authenticated';
    end if;
    select u.email::text into v_email from auth.users u where u.id = auth.uid();
    perform private.claim_workspace_invites(auth.uid(), v_email);
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

create or replace function public.list_foreign_blob_entries(p_limit int default 100)
returns table (id uuid, workspace_id uuid, storage_key text)
language sql
security invoker
stable
set search_path = public, extensions
as $$
    select * from private.list_foreign_blob_entries(p_limit);
$$;

revoke execute on function public.list_foreign_blob_entries(int) from public, anon, authenticated;
grant execute on function public.list_foreign_blob_entries(int) to service_role;
revoke execute on function private.list_foreign_blob_entries(int) from public, anon, authenticated;
grant execute on function private.list_foreign_blob_entries(int) to service_role;

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
-- Desktops experiment (DESKTOPS_EXPERIMENT.md): the opt-in mark and the admin
-- report. The report reads only what cloud accounts already store — no event
-- log, no client analytics (the privacy page promises no trackers). Local and
-- browser desktops never reach the server, so they are not in it.
-- ----------------------------------------------------------------------------

create or replace function private.mark_desktops_opt_in()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if auth.uid() is null then
        raise exception 'mark_desktops_opt_in: not signed in';
    end if;
    insert into private.desktops_opt_ins (user_id) values (auth.uid())
    on conflict (user_id) do nothing;
end
$$;

create or replace function public.mark_desktops_opt_in()
returns void
language sql
security invoker
set search_path = public, extensions
as $$
    select private.mark_desktops_opt_in();
$$;

-- One row of counts over all accounts. "Loose files" are live entries inside
-- a /desktop-<id> folder of the owner's system workspace (files dropped on a
-- cloud desktop board itself, not into one of its workspaces)
drop function if exists public.desktops_experiment_report();
drop function if exists private.desktops_experiment_report();

create or replace function private.desktops_experiment_report()
returns table (
    opted_in_users bigint,
    users_with_desktops bigint,
    users_with_2plus_desktops bigint,
    desktop_workspaces bigint,
    users_with_2plus_desktop_workspaces bigint,
    users_with_loose_files bigint,
    users_with_2plus_windows bigint,
    max_windows int,
    active_14d bigint
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
    if auth.uid() is null or not private.is_admin() then
        raise exception 'desktops_experiment_report: not an admin';
    end if;

    return query
    with per_owner as (
        select d.owner_id,
               count(*) as desktops,
               max(jsonb_array_length(d.windows)) as windows,
               max(d.updated_at) as last_update
          from public.desktops d
         group by d.owner_id
    ),
    tiles as (
        select w.owner_id, count(*) as n
          from public.workspaces w
         where w.desktop_id is not null
         group by w.owner_id
    ),
    loose as (
        select distinct w.owner_id
          from public.workspaces w
          join public.entries e on e.workspace_id = w.id
         where w.is_system
           and e.deleted_at is null
           and e.path like '/desktop-%/%'
    )
    select
        (select count(*) from private.desktops_opt_ins),
        (select count(*) from per_owner),
        (select count(*) from per_owner where desktops >= 2),
        (select coalesce(sum(n), 0)::bigint from tiles),
        (select count(*) from tiles where n >= 2),
        (select count(*) from loose),
        (select count(*) from per_owner where windows >= 2),
        (select coalesce(max(windows), 0) from per_owner),
        (select count(*) from per_owner where last_update > now() - interval '14 days');
end
$$;

create or replace function public.desktops_experiment_report()
returns table (
    opted_in_users bigint,
    users_with_desktops bigint,
    users_with_2plus_desktops bigint,
    desktop_workspaces bigint,
    users_with_2plus_desktop_workspaces bigint,
    users_with_loose_files bigint,
    users_with_2plus_windows bigint,
    max_windows int,
    active_14d bigint
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
    select * from private.desktops_experiment_report();
$$;

-- signed-in only; the report refuses non-admins inside
revoke execute on function public.mark_desktops_opt_in() from public, anon;
grant execute on function public.mark_desktops_opt_in() to authenticated;
revoke execute on function private.mark_desktops_opt_in() from public, anon;
grant execute on function private.mark_desktops_opt_in() to authenticated;
revoke execute on function public.desktops_experiment_report() from public, anon;
grant execute on function public.desktops_experiment_report() to authenticated;
revoke execute on function private.desktops_experiment_report() from public, anon;
grant execute on function private.desktops_experiment_report() to authenticated;
