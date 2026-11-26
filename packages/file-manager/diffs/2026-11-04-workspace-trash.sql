-- Apply once to the production project (SQL editor or apply_migration).
-- End state lives in schema.sql and rpc.sql. Does not rewrite existing rows.
-- A workspace in the trash stays invisible to ordinary checks; only the
-- owner's trash RPCs and workspace_state see it.

alter table public.workspaces
    add column if not exists deleted_at timestamptz;

create index if not exists workspaces_trashed_idx
    on public.workspaces (deleted_at)
    where deleted_at is not null;

drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
    for select using (
        deleted_at is null
        and (
            owner_id = (select auth.uid())
            or is_public
            or private.is_workspace_member(id)
        )
    );

drop policy if exists workspaces_update on public.workspaces;
create policy workspaces_update on public.workspaces
    for update using (owner_id = (select auth.uid()) and deleted_at is null)
    with check (owner_id = (select auth.uid()) and deleted_at is null);

drop policy if exists workspaces_delete on public.workspaces;
create policy workspaces_delete on public.workspaces
    for delete using (owner_id = (select auth.uid()) and deleted_at is null);

create or replace function private.is_workspace_owner(p_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, extensions
as $$
    select exists (
        select 1 from public.workspaces
        where id = p_workspace_id
          and owner_id = auth.uid()
          and deleted_at is null
    );
$$;

create or replace function private.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, extensions
as $$
    select exists (
        select 1 from public.workspace_members m
        join public.workspaces w on w.id = m.workspace_id
        where m.workspace_id = p_workspace_id
          and m.user_id = auth.uid()
          and w.deleted_at is null
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
        select 1 from public.workspace_members m
        join public.workspaces w on w.id = m.workspace_id
        where m.workspace_id = p_workspace_id
          and m.user_id = auth.uid()
          and m.role = 'editor'
          and w.deleted_at is null
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
          and deleted_at is null
          and (owner_id = auth.uid() or is_public)
    ) or private.is_workspace_member(p_workspace_id);
$$;

create or replace function private.readable_workspace_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public, extensions
as $$
    select w.id from public.workspaces w
     where w.deleted_at is null
       and (w.owner_id = (select auth.uid()) or w.is_public)
    union
    select m.workspace_id from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id
     where m.user_id = (select auth.uid())
       and w.deleted_at is null;
$$;

create or replace function private.writable_workspace_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public, extensions
as $$
    select w.id from public.workspaces w
     where w.deleted_at is null
       and w.owner_id = (select auth.uid())
    union
    select m.workspace_id from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id
     where m.user_id = (select auth.uid())
       and m.role = 'editor'
       and w.deleted_at is null;
$$;

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
        coalesce(sum(e.size_bytes) filter (where e.deleted_at is null and w.deleted_at is null), 0)::bigint,
        coalesce(sum(e.size_bytes) filter (where e.deleted_at is not null or w.deleted_at is not null), 0)::bigint
      from public.entries e
      join public.workspaces w on w.id = e.workspace_id
     where w.owner_id = p_owner;
$$;

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
       and w.deleted_at is null
    on conflict do nothing;
    delete from public.workspace_invites i
     where i.email = v_email
       and exists (
           select 1 from public.workspaces w
            where w.id = i.workspace_id
              and w.deleted_at is null
       );
end
$$;

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
    if not exists (
        select 1 from public.workspaces w
         where w.id = v_workspace and w.owner_id = p_user and w.deleted_at is null
    ) then
        raise exception 'record_hub_preview_upload: access denied';
    end if;
    insert into private.hub_preview_uploads (storage_key, workspace_id, size_bytes, uploaded_by)
    values (p_storage_key, v_workspace, p_size_bytes, p_user)
    on conflict (storage_key) do update
       set size_bytes = excluded.size_bytes;
end
$$;

create or replace function private.purge_expired_workspaces()
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare v_workspace uuid;
begin
    for v_workspace in
        select id from public.workspaces
         where deleted_at < now() - interval '30 days'
         order by id
    loop
        perform private.lock_workspace_tree(v_workspace);
        delete from public.workspaces
         where id = v_workspace
           and deleted_at < now() - interval '30 days';
    end loop;
end;
$$;
revoke execute on function private.purge_expired_workspaces() from public, anon, authenticated;

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
     where w.id = p_workspace and w.is_public and w.deleted_at is null;
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

    if v_old_key is not null then
        insert into public.blob_deletions (storage_key) values (v_old_key);
    end if;

    return to_json(v_row);
end
$$;

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


select cron.schedule(
    'workspaces-hard-delete',
    '20 3 * * *',
    $$select private.purge_expired_workspaces()$$
);
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
