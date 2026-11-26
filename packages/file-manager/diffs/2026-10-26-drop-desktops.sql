-- drop-desktops.sql
-- One forward diff for the live database. schema.sql and rpc.sql are the
-- end state of a fresh database; do not reapply those files to production.
--
-- ON DELETE CASCADE fires when a row is deleted, not when a table is
-- dropped. desktop_id is cleared first so deleting a desktop row cannot
-- cascade into workspaces. The billing_accounts seed at the bottom of
-- schema.sql is for an empty database and is not part of this diff.
--
-- Apply in one transaction. A failure, including the safety check, rolls
-- the whole diff back.

begin;

-- 0. Stop if a system workspace appeared after the 2026-10-26 count.
do $$ begin
    if exists (select 1 from public.workspaces where is_system) then
        raise exception 'system workspaces exist: review them first';
    end if;
end $$;

-- 1. Unpin workspaces before the desktop table can go away.
update public.workspaces set desktop_id = null where desktop_id is not null;

-- 2. Policies cannot be replaced in place. The partial unique index
--    depends on is_system, so it has to go before that column does.
drop policy workspaces_insert on public.workspaces;
create policy workspaces_insert on public.workspaces
    for insert with check (
        owner_id = (select auth.uid())
        and not is_public
        and slug is null
    );

drop policy workspaces_delete on public.workspaces;
create policy workspaces_delete on public.workspaces
    for delete using (owner_id = (select auth.uid()));

drop index public.workspaces_system_unique;

-- 3. Replace functions that read the columns before the columns go.
--    public.plan_limits is language sql and depends on plan_defaults, so
--    it is dropped for the return-type change and created again below.
--    drop function resets EXECUTE to PUBLIC.
drop function public.plan_limits(text);
drop function private.plan_defaults(text);

create or replace function private.plan_defaults(p_plan text)
returns table (
    quota_bytes bigint,
    max_file_bytes bigint,
    max_hub_listings int,
    max_entries int,
    max_strokes int,
    max_connections int,
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
            (20::bigint * 1024 * 1024 * 1024),
            (10 * 1024 * 1024)::bigint,
            (20::bigint * 1024 * 1024 * 1024);
        return;
    end if;
    raise exception 'plan_defaults: unknown plan %', p_plan;
end
$$;

revoke execute on function private.plan_defaults(text) from public, anon;
grant execute on function private.plan_defaults(text) to authenticated;

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
    on conflict do nothing;
    delete from public.workspace_invites
     where email = v_email;
end
$$;

revoke execute on function private.claim_workspace_invites(uuid, text)
    from public, anon, authenticated;

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
        max_strokes, max_connections,
        egress_bytes_month, max_public_file_bytes, download_bytes_month
    )
    select new.id, 'free', 'active', d.quota_bytes, d.max_file_bytes, d.max_hub_listings, d.max_entries,
           d.max_strokes, d.max_connections,
           d.egress_bytes_month, d.max_public_file_bytes, d.download_bytes_month
      from private.plan_defaults('free') d;

    -- Live pending invites for this address become memberships. Expired rows
    -- are only deleted so a later invite can reuse (workspace_id, email).
    perform private.claim_workspace_invites(new.id, new.email);
    return new;
end
$$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;

-- 4. create_workspace loses p_desktop. The public wrapper is language sql
--    and depends on the private function, so it is dropped first. The new
--    signature is one argument, which is what existing clients send.
drop function public.create_workspace(text, uuid);
drop function private.create_workspace(text, uuid);

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

    insert into public.workspaces (owner_id, name)
    values (auth.uid(), p_name)
    returning id into v_workspace_id;

    insert into public.entries (workspace_id, parent_id, name, kind, xattrs)
    values (v_workspace_id, null, '', 'folder', '{"view": "board"}');

    return v_workspace_id;
end
$$;

create or replace function public.create_workspace(p_name text)
returns uuid
language sql
security invoker
set search_path = public, extensions
as $$
    select private.create_workspace(p_name);
$$;

-- 5. Functions that exist only for desktops. Trigger functions are dropped
--    after their triggers: a trigger depends on its function, the table
--    does not. Public SQL wrappers are dropped before the private functions
--    they call. is_desktop_owner is language sql over public.desktops, so
--    it goes before the table.
drop trigger if exists desktops_touch on public.desktops;
drop trigger if exists desktops_count_guard on public.desktops;
drop function public.desktops_touch();
drop function public.desktops_count_guard();

drop function public.get_or_create_system_workspace();
drop function private.get_or_create_system_workspace();

drop function public.mark_desktops_opt_in();
drop function private.mark_desktops_opt_in();
drop function public.desktops_experiment_report();
drop function private.desktops_experiment_report();

drop function private.is_desktop_owner(uuid);
drop function private.assert_owner_desktops(uuid, integer);

-- 6. The desktop index depends on desktop_id. Dropping the column drops
--    the foreign key; it does not delete workspace rows.
drop index public.workspaces_desktop_idx;
alter table public.workspaces drop column desktop_id;
drop table public.desktops;
drop table private.desktops_opt_ins;

-- 7. Nothing left reads is_system.
alter table public.workspaces drop column is_system;

-- 8. Nothing left reads max_desktops.
alter table public.billing_accounts drop column max_desktops;

commit;
