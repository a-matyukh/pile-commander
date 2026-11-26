-- П2 of the cloud security plan: forward diff for the live database.
-- Apply once, in one transaction. The backend and the web app from
-- feature/cloud-p2 work with the database before and after it, so the order
-- of the deploy and of this diff does not matter.
-- Rewrites no rows on a database without moderation_mail rows (checked on
-- 2026-11-25: none); the one UPDATE below is for rows that appear before
-- the diff is applied.
-- After it: `bun --filter @pile-commander/file-manager test:rls:remote`,
-- then Advisors.
begin;

-- ---------------------------------------------------------------------------
-- П2.12. Deleting for good is the owner's alone
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- П2.16. The backend may clear a feedback note's screenshots and delete the
-- note (retention, a deleted account, a request). It could only insert and
-- read, so the screenshot cleanup from П1 could not clear a row either
-- ---------------------------------------------------------------------------
grant delete on public.feedback to service_role;
grant update (attachments) on public.feedback to service_role;

-- ---------------------------------------------------------------------------
-- П2.17. Hub reports: an account's reports count toward hiding three cards
-- a week, a forked board takes more reports, and the moderator is mailed at
-- once (the backend stamps moderator_notified_at)
-- ---------------------------------------------------------------------------
alter table public.moderation_mail
    add column if not exists moderator_notified_at timestamptz;
update public.moderation_mail
   set moderator_notified_at = created_at
 where moderator_notified_at is null
   and kind = 'listing_hidden';

create or replace function private.maybe_auto_hide_hub_listing(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_cutoff timestamptz;
    v_count bigint;
    v_forks bigint;
    v_need int;
    v_owner uuid;
    v_username text;
    v_slug text;
    v_name text;
begin
    select h.reports_counted_after, h.owner_id, h.fork_count, p.username, w.slug, w.name
      into v_cutoff, v_owner, v_forks, v_username, v_slug, v_name
      from public.hub_publications h
      join public.workspaces w on w.id = h.source_workspace_id
      join public.profiles p on p.id = h.owner_id
     where h.source_workspace_id = p_workspace
       and h.hidden_at is null;
    if not found then
        return;
    end if;

    v_need := 3 + case
        when v_forks >= 31 then 5
        when v_forks >= 15 then 4
        when v_forks >= 7 then 3
        when v_forks >= 3 then 2
        when v_forks >= 1 then 1
        else 0
    end;

    select count(*) into v_count
      from private.hub_reports r
      join auth.users u on u.id = r.reporter_id
     where r.workspace_id = p_workspace
       and r.created_at > v_cutoff
       and u.created_at <= now() - interval '7 days'
       and (
           select count(*) from private.hub_reports o
            where o.reporter_id = r.reporter_id
              and o.workspace_id <> r.workspace_id
              and o.created_at > r.created_at - interval '7 days'
              -- "before it"; two reports of one instant are ordered by board
              and (o.created_at, o.workspace_id) < (r.created_at, r.workspace_id)
       ) < 3;

    if v_count < v_need then
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

-- ---------------------------------------------------------------------------
-- П2.11. Realtime: only a workspace's owner and members may join its
-- channels. Nothing changes for clients until "Allow public access" is
-- turned off in Realtime Settings (see the README: after the desktop release)
-- ---------------------------------------------------------------------------
create or replace function private.can_join_channel(p_topic text)
returns boolean
language plpgsql
security definer
stable
set search_path = public, extensions
as $$
declare
    v_id text;
    v_workspace uuid;
begin
    if (select auth.uid()) is null or p_topic is null or p_topic !~ '^file-manager-[a-z]+:' then
        return false;
    end if;
    v_id := split_part(p_topic, ':', 2);
    if v_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        return false;
    end if;
    v_workspace := v_id::uuid;
    return exists (
        select 1 from public.workspaces w
         where w.id = v_workspace
           and w.deleted_at is null
           and w.owner_id = (select auth.uid())
    ) or private.is_workspace_member(v_workspace);
end
$$;
revoke execute on function private.can_join_channel(text) from public, anon;
grant execute on function private.can_join_channel(text) to authenticated;

-- realtime.messages is Realtime's own table: RLS is already on and must not
-- be altered here; only the policy is ours
drop policy if exists pile_workspace_channels on realtime.messages;
create policy pile_workspace_channels on realtime.messages
    for select to authenticated
    using (private.can_join_channel((select realtime.topic())));

commit;
