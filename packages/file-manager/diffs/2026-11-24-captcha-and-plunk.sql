-- Sign-up CAPTCHA (Turnstile, through the "Before User Created" hook) and
-- Plunk bounce/complaint tracking for invite mails. One transaction; adds a
-- column, a table, functions, a trigger and a cron job. Rewrites no rows.
begin;

alter table private.rate_events
    add column if not exists mail_id text check (mail_id is null or char_length(mail_id) <= 128);
create index if not exists rate_events_mail_idx on private.rate_events (mail_id) where mail_id is not null;


create table private.mail_events (
    id bigint generated always as identity primary key,
    actor uuid references auth.users (id) on delete set null,
    kind text not null check (kind in ('bounce', 'complaint')),
    mail_id text check (mail_id is null or char_length(mail_id) <= 128),
    email text check (email is null or char_length(email) <= 254),
    created_at timestamptz not null default now()
);
create index mail_events_actor_idx on private.mail_events (actor, created_at);
create index mail_events_created_idx on private.mail_events (created_at);
revoke all on private.mail_events from public, anon, authenticated;


-- The sign-up form's Turnstile token rides in the user metadata to the
-- "Before User Created" hook (apps/backend/src/signup.ts), which has checked
-- it by the time the row is inserted; it is not kept on the account
create or replace function private.drop_signup_captcha()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if NEW.raw_user_meta_data ? 'captcha_token' then
        NEW.raw_user_meta_data := NEW.raw_user_meta_data - 'captcha_token';
    end if;
    return NEW;
end
$$;

revoke execute on function private.drop_signup_captcha() from public, anon, authenticated;

drop trigger if exists on_auth_user_signup_captcha on auth.users;
create trigger on_auth_user_signup_captcha
    before insert on auth.users
    for each row execute function private.drop_signup_captcha();


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

select cron.schedule(
    'mail-events-prune',
    '48 3 * * *',
    $$delete from private.mail_events where created_at < now() - interval '90 days'$$
);


commit;
