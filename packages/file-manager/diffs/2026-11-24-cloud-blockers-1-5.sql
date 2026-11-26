-- Cloud blockers 1–5 (branch feature/cloud-blockers), forward diff for the
-- live project, with the fixes from the Grok and Kimi reviews (round 3).
-- One transaction. Rewrites no rows; adds tables, a column with a constant
-- default, constraints, functions, triggers and three cron jobs.
-- Apply AFTER the backend and the web client of this branch are live: from
-- here on invites come only from the backend (invite_workspace_member).
begin;

-- ---------------------------------------------------------------- blocker 1/5

create table private.rate_events (
    id bigint generated always as identity primary key,
    -- set null, not cascade: deleting the account must not reset the
    -- per-address count its invites made
    actor uuid references auth.users (id) on delete set null,
    action text not null check (action in ('invite', 'fork')),
    -- invite: the mailbox (private.mailbox_of); fork: null
    subject text check (subject is null or char_length(subject) <= 254),
    workspace_id uuid,
    created_at timestamptz not null default now()
);
create index rate_events_actor_idx on private.rate_events (actor, action, created_at);
create index rate_events_subject_idx on private.rate_events (action, subject, created_at)
    where subject is not null;
revoke all on private.rate_events from public, anon, authenticated;


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

    -- Pending invites stay pending: this row exists before anyone proved they
    -- own the address (an unconfirmed signup can be anybody's). The invitee
    -- accepts them once confirmed (accept_workspace_invite)
    return new;
end
$$;

-- The password typed at signup is dropped when the address is confirmed.
-- Supabase Auth keeps an unconfirmed signup as is when the address signs up
-- again, password included, so the password on the row may be whoever
-- registered the address first; the confirmation is the first moment the
-- owner of the mailbox is known. The app then asks the confirmed session for
-- a password (password_prompt = 'confirm_signup'); someone who closes it
-- signs in with "Forgot password". Only the null → set step of
-- email_confirmed_at: an email change or an admin confirmation at insert
-- keeps the password
create or replace function private.drop_password_on_confirm()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if OLD.email_confirmed_at is null and NEW.email_confirmed_at is not null then
        NEW.encrypted_password := '';
    end if;
    return NEW;
end
$$;

revoke execute on function private.drop_password_on_confirm() from public, anon, authenticated;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
    before update of email_confirmed_at on auth.users
    for each row execute function private.drop_password_on_confirm();


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

-- the backend only (service role): see add_workspace_member. Both were
-- created above, which grants EXECUTE to PUBLIC; take it back first
revoke execute on function public.invite_workspace_member(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.invite_workspace_member(uuid, uuid, text, text) to service_role;
revoke execute on function private.add_workspace_member(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function private.add_workspace_member(uuid, uuid, text, text) to service_role;


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



-- ---------------------------------------------------------------- blocker 2
drop policy if exists workspaces_insert on public.workspaces;
revoke insert on public.workspaces from authenticated;

alter table public.quota_wall_events
    add constraint quota_wall_events_answer_len check (answer is null or char_length(answer) <= 2000);
revoke all on public.quota_wall_events from public, anon, authenticated;
grant select, insert on public.quota_wall_events to authenticated;
grant update (answer) on public.quota_wall_events to authenticated;


create or replace function private.owner_rows_cap()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_total int := TG_ARGV[0]::int;
    v_day int := TG_ARGV[1]::int;
    v_n bigint;
begin
    if NEW.owner_id is null then
        return NEW;
    end if;
    -- the day window counts server time, never a client's claim
    NEW.created_at := now();
    -- nested: PL/pgSQL resolves every NEW field of a condition, and only
    -- sync_devices has device_id
    if TG_TABLE_NAME = 'sync_devices' then
        if exists (
            select 1 from public.sync_devices d
             where d.owner_id = NEW.owner_id
               and d.workspace_id = (to_jsonb(NEW)->>'workspace_id')::uuid
               and d.device_id = to_jsonb(NEW)->>'device_id'
        ) then
            return NEW;
        end if;
    end if;
    perform pg_advisory_xact_lock(hashtextextended(NEW.owner_id::text || ':' || TG_TABLE_NAME, 43));
    execute format('select count(*) from %I.%I where owner_id = $1', TG_TABLE_SCHEMA, TG_TABLE_NAME)
       into v_n using NEW.owner_id;
    if v_n >= v_total then
        raise exception 'rows_limit_exceeded: % keeps % rows per account', TG_TABLE_NAME, v_total
            using errcode = 'P0001';
    end if;
    execute format(
        'select count(*) from %I.%I where owner_id = $1 and created_at > now() - interval ''1 day''',
        TG_TABLE_SCHEMA, TG_TABLE_NAME
    ) into v_n using NEW.owner_id;
    if v_n >= v_day then
        raise exception 'rows_limit_exceeded: % takes % rows per account a day', TG_TABLE_NAME, v_day
            using errcode = 'P0001';
    end if;
    return NEW;
end
$$;
revoke execute on function private.owner_rows_cap() from public, anon, authenticated;

drop trigger if exists quota_wall_events_cap on public.quota_wall_events;
create trigger quota_wall_events_cap
    before insert on public.quota_wall_events
    for each row execute function private.owner_rows_cap('2000', '200');

drop trigger if exists bridge_events_cap on public.bridge_events;
create trigger bridge_events_cap
    before insert on public.bridge_events
    for each row execute function private.owner_rows_cap('20000', '1000');

drop trigger if exists sync_devices_cap on public.sync_devices;
create trigger sync_devices_cap
    before insert on public.sync_devices
    for each row execute function private.owner_rows_cap('1000', '1000');


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
    -- An UPDATE must not carry ink past the caps the INSERT counted: moving
    -- strokes to another workspace would free the mover's own owner budget
    -- and fill someone else's, and moving them into a folder would beat its
    -- 5000. A PostgREST upsert needs UPDATE on every column of its body, so
    -- column grants cannot stop this; the trigger does
    if TG_OP = 'UPDATE' then
        if NEW.workspace_id <> OLD.workspace_id then
            raise exception 'folder_strokes: a stroke cannot move to another workspace';
        end if;
        if NEW.entry_id <> OLD.entry_id then
            perform pg_advisory_xact_lock(hashtextextended(NEW.entry_id::text || ':strokes', 45));
            if (select count(*) from public.folder_strokes s where s.entry_id = NEW.entry_id) >= 5000 then
                raise exception 'folder_strokes: folder % already holds 5000 strokes', NEW.entry_id;
            end if;
        end if;
    end if;
    v_new := TG_OP = 'INSERT'
        and not exists (select 1 from public.folder_strokes s where s.id = NEW.id);
    -- one writer per folder at a time while it counts: two transactions
    -- adding to a folder at 4999 would both read 4999 (held to the commit)
    if v_new then
        perform pg_advisory_xact_lock(hashtextextended(NEW.entry_id::text || ':strokes', 45));
    end if;
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
    -- same as folder_strokes_guard: an UPDATE moves no edge past the caps
    if TG_OP = 'UPDATE' then
        if NEW.workspace_id <> OLD.workspace_id then
            raise exception 'folder_connections: a connection cannot move to another workspace';
        end if;
        if NEW.entry_id <> OLD.entry_id then
            perform pg_advisory_xact_lock(hashtextextended(NEW.entry_id::text || ':connections', 45));
            if (select count(*) from public.folder_connections c where c.entry_id = NEW.entry_id) >= 5000 then
                raise exception 'folder_connections: folder % already holds 5000 connections', NEW.entry_id;
            end if;
        end if;
    end if;
    v_new := TG_OP = 'INSERT'
        and not exists (
            select 1 from public.folder_connections c
             where c.workspace_id = NEW.workspace_id and c.id = NEW.id
        );
    -- one writer per folder at a time while it counts (see folder_strokes_guard)
    if v_new then
        perform pg_advisory_xact_lock(hashtextextended(NEW.entry_id::text || ':connections', 45));
    end if;
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


alter table public.workspaces drop constraint if exists workspaces_xattrs_size;
alter table public.workspaces drop constraint if exists workspaces_xattrs_check;
alter table public.workspaces
    add constraint workspaces_xattrs_size check (pg_column_size(xattrs) <= 16384) not valid;
alter table public.workspaces validate constraint workspaces_xattrs_size;
alter table public.entries drop constraint if exists entries_xattrs_size;
alter table public.entries drop constraint if exists entries_xattrs_check;
alter table public.entries
    add constraint entries_xattrs_size check (pg_column_size(xattrs) <= 16384) not valid;
alter table public.entries validate constraint entries_xattrs_size;


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
    perform private.assert_owner_workspaces(auth.uid());

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


-- ---------------------------------------------------------------- blocker 3
alter table private.upload_sessions add column if not exists attempts int not null default 0;

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


create or replace function private.list_foreign_blob_entries(p_limit int default 100)
returns table (id uuid, workspace_id uuid, storage_key text)
language sql
security definer
stable
set search_path = public, extensions
as $$
    -- Trashed rows wait: their copy would only sit in storage until the
    -- purge. Until re-keyed they keep the source's object alive (GC checks
    -- references), and a restore puts them back in this list
    select e.id, e.workspace_id, e.storage_key
      from public.entries e
      join public.workspaces w on w.id = e.workspace_id
     where e.storage_key is not null
       and lower(left(e.storage_key, 36)) <> e.workspace_id::text
       and e.deleted_at is null
       and w.deleted_at is null
     order by e.created_at
     limit least(greatest(coalesce(p_limit, 100), 1), 1000);
$$;


-- ---------------------------------------------------------------- cron

-- expired invites are only kept so the owner's list can say "expired" for a while
select cron.schedule(
    'workspace-invites-prune',
    '47 3 * * *',
    $$delete from public.workspace_invites where expires_at < now() - interval '30 days'$$
);

-- the windows in rate_events are a day at most
select cron.schedule(
    'rate-events-prune',
    '45 3 * * *',
    $$delete from private.rate_events where created_at < now() - interval '2 days'$$
);

-- An address nobody confirmed within a day is freed for its real owner.
-- Supabase Auth keeps an unconfirmed signup as is and only resends the
-- mail when the address signs up again, so whoever registered someone
-- else's address first would otherwise keep that account, and the password
-- they chose, once the owner confirms. The account has no data (every write
-- needs a session, and a session needs the confirmation)
select cron.schedule(
    'unconfirmed-users-prune',
    '50 3 * * *',
    $$delete from auth.users u
       where u.email_confirmed_at is null
         and u.created_at < now() - interval '1 day'
         and not exists (select 1 from public.workspaces w where w.owner_id = u.id)$$
);


commit;
