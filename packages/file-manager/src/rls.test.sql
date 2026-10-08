-- ============================================================================
-- Pile Commander — RLS / RPC regression suite (Supabase)
-- ============================================================================
-- Run the WHOLE file as one script against the project (Supabase SQL editor
-- or the MCP execute_sql tool). It opens a transaction, creates its own
-- fixtures (two users, a workspace, a member), exercises every role
-- (owner / editor / viewer / anon / service_role) through the real policies,
-- grants and RPCs, prints one row per check, and ROLLS BACK — the database is
-- left exactly as it was. Every row must have ok = true.
--
-- The role switch is what PostgREST does per request: `set local role` plus
-- `request.jwt.claims` (auth.uid() reads `sub` from it). Statements that are
-- expected to fail run in their own BEGIN ... EXCEPTION block so the outer
-- transaction survives; the failing sub-block's role/claims changes are
-- rolled back with it, hence the explicit re-`set local role` after each.
-- ============================================================================

begin;

create temp table __results (step text, ok boolean, detail text);
grant all on __results to public;

do $$
declare
    -- fixtures (ids are fixed so the script is deterministic; the rollback
    -- removes them)
    c_owner   constant uuid := '11111111-1111-4111-8111-111111111111';
    c_editor  constant uuid := '22222222-2222-4222-8222-222222222222';
    c_viewer  constant uuid := '33333333-3333-4333-8333-333333333333';
    c_other   constant uuid := '44444444-4444-4444-8444-444444444444';
    c_pending constant uuid := '55555555-5555-4555-8555-555555555555';
    c_expired constant uuid := '66666666-6666-4666-8666-666666666666';
    c_admin   constant uuid := '77777777-7777-4777-8777-777777777777';
    c_young   constant uuid := '88888888-8888-4888-8888-888888888888';
    v_ws      uuid;
    v_root    uuid;
    v_folder  uuid;
    v_file    uuid;
    v_old     uuid;
    v_new     uuid;
    v_fork    uuid;
    v_json    json;
    v_key     text;
    v_invite_token text;
    v_n       int;
    v_mtime   timestamptz;
    v_blob    uuid;
    v_hub_key text;
    v_used    bigint;
    v_ws_used bigint;
    v_deriv   text;
    v_video   uuid;
    v_retry   uuid;
    v_ws2     uuid;
    v_root2   uuid;
    v_file2   uuid;
    v_gone    uuid;   -- a trashed folder that carries ink and an edge
    v_gone_stroke uuid;
    v_gone_edge   text;
    v_grant   record;
    v_gc_a    text;
    v_gc_b    text;
    v_upload  text;
    v_request jsonb;
    v_receipt jsonb;
begin
    -- ------------------------------------------------------------------
    -- fixtures (as postgres): users → profiles/billing via handle_new_user
    -- ------------------------------------------------------------------
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u.email, '', now(),
           '{"provider":"email","providers":["email"]}', '{}', u.created, now()
      from (values (c_owner,  'rls-owner@example.invalid', now() - interval '8 days'),
                   (c_editor, 'rls-editor@example.invalid', now() - interval '8 days'),
                   (c_viewer, 'rls-viewer@example.invalid', now() - interval '8 days'),
                   (c_other,  'rls-other@example.invalid', now() - interval '8 days'),
                   (c_admin,  'rls-admin@example.invalid', now() - interval '8 days'),
                   (c_young,  'rls-young@example.invalid', now())) as u(id, email, created);
    update public.profiles set username = 'rls-owner' where id = c_owner;
    insert into private.admins (user_id) values (c_admin);

    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    v_ws := private.create_workspace('rls-suite', null);
    select e.id into v_root from public.entries e where e.workspace_id = v_ws and e.parent_id is null;
    perform private.add_workspace_member(v_ws, 'rls-editor@example.invalid', 'editor');
    perform private.add_workspace_member(v_ws, 'rls-viewer@example.invalid', 'viewer');
    insert into __results values ('fixtures', v_ws is not null and v_root is not null, format('ws=%s', v_ws));
    insert into __results values ('fixtures: free plan seeds the egress, download and row fences',
        (select egress_bytes_month = 20::bigint * 1024 * 1024 * 1024 and max_public_file_bytes = 10 * 1024 * 1024
                and download_bytes_month = 20::bigint * 1024 * 1024 * 1024
                and max_entries = 20000 and max_strokes = 20000
                and max_connections = 20000 and max_desktops = 20
           from public.billing_accounts where owner_id = c_owner), null);

    -- ------------------------------------------------------------------
    -- owner
    -- ------------------------------------------------------------------
    execute 'set local role authenticated';

    insert into public.entries (workspace_id, parent_id, name, kind) values (v_ws, v_root, 'docs', 'folder') returning id into v_folder;
    insert into __results values ('owner: folder insert', v_folder is not null, null);

    v_json := public.create_text_file(v_folder, 'note.md', 'text/markdown', 'hello', 'suite', null);
    v_file := (v_json->>'id')::uuid;
    insert into __results values ('owner: create_text_file writes both rows',
        (select count(*) from public.entry_contents where entry_id = v_file and content = 'hello') = 1
        and (v_json->>'size_bytes')::int = 5, v_json->>'path');

    v_json := public.create_text_file(v_folder, 'placed.md', 'text/markdown', '', 'suite', null,
        '{"is_preview": "true", "position": "{\"x\":10,\"y\":20}"}'::jsonb);
    insert into __results values ('owner: create_text_file writes initial xattrs',
        (select xattrs->>'position' = '{"x":10,"y":20}' and xattrs->>'is_preview' = 'true'
           from public.entries where id = (v_json->>'id')::uuid), v_json->>'xattrs');

    begin
        v_json := public.create_text_file(v_folder, 'bad-xattrs.md', 'text/markdown', '', null, null, '{"position": 1}'::jsonb);
        insert into __results values ('owner: create_text_file refuses non-string xattrs', false, 'accepted');
    exception when others then
        insert into __results values ('owner: create_text_file refuses non-string xattrs',
            sqlerrm like '%xattrs must be an object of strings%', sqlerrm);
        execute 'set local role authenticated';
    end;

    begin
        insert into public.entries (workspace_id, parent_id, name, kind, mime) values (v_ws, v_root, 'husk.txt', 'file', 'text/plain');
        insert into __results values ('owner: direct file insert refused (folders only)', false, 'accepted');
    exception when others then
        insert into __results values ('owner: direct file insert refused (folders only)', sqlstate = '42501', sqlerrm);
        execute 'set local role authenticated';
    end;

    begin
        insert into public.entries (workspace_id, parent_id, name, kind, mime, storage_key, size_bytes)
        values (v_ws, v_root, 'evil.png', 'file', 'image/png', v_ws::text || '/00000000-0000-0000-0000-000000000000.png', 0);
        insert into __results values ('owner: cannot mention storage_key/size_bytes on insert', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('owner: cannot mention storage_key/size_bytes on insert', true, sqlerrm);
        execute 'set local role authenticated';
    end;

    begin
        update public.entries set size_bytes = 0 where id = v_file;
        insert into __results values ('owner: cannot update size_bytes', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('owner: cannot update size_bytes', true, sqlerrm);
        execute 'set local role authenticated';
    end;

    begin
        delete from public.entries where id = v_file;
        insert into __results values ('owner: no hard delete', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('owner: no hard delete', true, sqlerrm);
        execute 'set local role authenticated';
    end;

    update public.entries set xattrs = xattrs || '{"x":"1"}' where id = v_file;
    insert into __results values ('owner: xattrs update', (select xattrs ? 'x' from public.entries where id = v_file), null);

    begin
        insert into public.entries (workspace_id, parent_id, name, kind) values (v_ws, v_root, '..', 'folder');
        insert into __results values ('names: .. refused', false, 'accepted');
    exception when check_violation then
        insert into __results values ('names: .. refused', true, null);
        execute 'set local role authenticated';
    end;

    begin
        insert into public.entries (workspace_id, parent_id, name, kind, xattrs)
        values (v_ws, v_root, 'fat', 'folder', jsonb_build_object('blob', repeat('x', 70000)));
        insert into __results values ('xattrs: 64 KB cap', false, 'accepted');
    exception when check_violation then
        insert into __results values ('xattrs: 64 KB cap', true, null);
        execute 'set local role authenticated';
    end;

    -- merge_entry_xattrs: server-side jsonb merge by path; refused rows are
    -- reported instead of aborting the batch
    select count(*) into v_n from public.merge_entry_xattrs(v_ws, jsonb_build_array(
        jsonb_build_object('path', '/docs/note.md', 'xattrs', jsonb_build_object('a', '1', 'b', '2'))), 'suite');
    insert into __results values ('owner: merge_entry_xattrs merges keys',
        v_n = 0 and (select xattrs ? 'x' and xattrs->>'a' = '1' and xattrs->>'b' = '2'
                       from public.entries where id = v_file), null);

    select count(*) into v_n
      from public.merge_entry_xattrs(v_ws, jsonb_build_array(
               jsonb_build_object('path', '/docs', 'xattrs', jsonb_build_object('fat', repeat('x', 70000))),
               jsonb_build_object('path', '/nope', 'xattrs', jsonb_build_object('a', '1')),
               jsonb_build_object('path', '/docs/note.md', 'xattrs', jsonb_build_object('c', '3'))), null) s
     where (s.path, s.status) in (('/docs', 'too_large'), ('/nope', 'missing'));
    insert into __results values ('owner: merge_entry_xattrs reports too_large and missing, applies the rest',
        v_n = 2
        and (select not (xattrs ? 'fat') from public.entries where id = v_folder)
        and (select xattrs->>'c' = '3' from public.entries where id = v_file),
        format('refused=%s', v_n));

    begin
        perform public.merge_entry_xattrs(v_ws, jsonb_build_array(
            jsonb_build_object('path', '/docs/note.md', 'xattrs', jsonb_build_object('n', 1))), null);
        insert into __results values ('owner: merge_entry_xattrs refuses non-string values', false, 'accepted');
    exception when others then
        insert into __results values ('owner: merge_entry_xattrs refuses non-string values',
            sqlerrm like '%string xattr values%', sqlerrm);
        execute 'set local role authenticated';
    end;

    begin
        perform public.merge_entry_xattrs(v_ws, jsonb_build_array(
            jsonb_build_object('path', '/docs', 'xattrs', jsonb_build_object('a', '1')),
            jsonb_build_object('path', '/docs', 'xattrs', jsonb_build_object('b', '2'))), null);
        insert into __results values ('owner: merge_entry_xattrs refuses duplicate paths', false, 'accepted');
    exception when others then
        insert into __results values ('owner: merge_entry_xattrs refuses duplicate paths',
            sqlerrm like '%duplicate paths%', sqlerrm);
        execute 'set local role authenticated';
    end;

    -- a second workspace with the same layout: paths, and so deterministic
    -- edge ids, repeat across workspaces
    v_ws2 := public.create_workspace('rls-suite-2', null);
    select e.id into v_root2 from public.entries e where e.workspace_id = v_ws2 and e.parent_id is null;
    insert into public.entries (workspace_id, parent_id, name, kind) values (v_ws2, v_root2, 'docs', 'folder');
    v_json := public.create_text_file(
        (select e.id from public.entries e where e.workspace_id = v_ws2 and e.path = '/docs'),
        'note.md', 'text/markdown', 'twin', null, null);
    v_file2 := (v_json->>'id')::uuid;

    select count(*) into v_n from public.merge_entry_xattrs(v_ws, jsonb_build_array(
        jsonb_build_object('path', '/docs/note.md', 'xattrs', jsonb_build_object('only', 'ws1'))), null);
    insert into __results values ('owner: merge_entry_xattrs stays inside the given workspace',
        v_n = 0 and (select not (xattrs ? 'only') from public.entries where id = v_file2), null);

    insert into public.folder_connections (id, entry_id, workspace_id, from_entry, to_entry)
    values ('/docs:default-/docs/note.md:default', v_root, v_ws, v_folder, v_file);
    insert into public.folder_connections (id, entry_id, workspace_id, from_entry, to_entry)
    values ('/docs:default-/docs/note.md:default', v_root2, v_ws2,
            (select e.id from public.entries e where e.workspace_id = v_ws2 and e.path = '/docs'), v_file2);
    insert into __results values ('connections: the same edge id lives in two workspaces',
        (select count(*) from public.folder_connections where id = '/docs:default-/docs/note.md:default') = 2
        and (select entry_id from public.folder_connections
               where workspace_id = v_ws and id = '/docs:default-/docs/note.md:default') = v_root, null);
    insert into __results values ('connections: DELETE primary key contains no paths or workspace',
        (select array_agg(a.attname::text order by a.attnum) = array['record_id']
           from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
          where i.indrelid = 'public.folder_connections'::regclass and i.indisprimary)
        and not has_column_privilege('authenticated', 'public.folder_connections', 'record_id', 'INSERT')
        and not has_column_privilege('authenticated', 'public.folder_connections', 'record_id', 'UPDATE'), null);
    -- The replica identity is what a DELETE writes to the WAL, and
    -- realtime.apply_rls matches the subscriber's filter against THAT set
    -- only: without workspace_id the workspace filter matches nothing and
    -- the deletion is never delivered; with `id` the payload carries paths.
    insert into __results values ('realtime: published DELETE identity carries workspace_id and no path',
        (select count(*) = 2 from (values
            ('public.folder_connections'::regclass, 'record_id'),
            ('public.folder_strokes'::regclass, 'id')
         ) t(relation, key)
         where (select c.relreplident from pg_class c where c.oid = t.relation) = 'i'
           and (select array_agg(a.attname::text order by a.attname)
                  from pg_index i join pg_attribute a
                    on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
                 where i.indrelid = t.relation and i.indisreplident)
               = array(select unnest(array['workspace_id', t.key]) order by 1)), null);

    insert into __results values ('plan_limits: pro storage numbers',
        (select quota_bytes = 50::bigint * 1024 * 1024 * 1024 and max_file_bytes = 1024 * 1024 * 1024
           from public.plan_limits('pro')), null);
    insert into __results values ('plan_defaults: pro row fences are finite',
        (select max_entries = 200000 and max_strokes = 100000
                and max_connections = 100000 and max_desktops = 50
           from private.plan_defaults('pro')), null);

    insert into public.bridge_events (owner_id, step, door, source_type, total_bytes)
    values (c_owner, 'preflight', 'share', 'local', 1000);
    insert into public.bridge_events (owner_id, step, door, source_type)
    values (c_owner, 'opened', 'sync', 'local');
    insert into __results values ('bridge_events: owner records own steps',
        (select count(*) from public.bridge_events where owner_id = c_owner and door = 'share') = 1, null);
    insert into __results values ('bridge_events: door sync is accepted',
        (select count(*) from public.bridge_events where owner_id = c_owner and door = 'sync') = 1, null);
    begin
        insert into public.bridge_events (owner_id, step, door, source_type)
        values (c_other, 'opened', 'list', 'browser');
        insert into __results values ('bridge_events: cannot record for another account', false, 'accepted');
    exception when others then
        insert into __results values ('bridge_events: cannot record for another account', sqlstate = '42501', sqlerrm);
        execute 'set local role authenticated';
    end;
    begin
        update public.bridge_events set answer = 'edited' where owner_id = c_owner;
        insert into __results values ('bridge_events: insert-only', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('bridge_events: insert-only', true, null);
        execute 'set local role authenticated';
    end;

    begin
        v_json := public.create_text_file(v_folder, 'big.txt', 'text/plain', repeat('x', 8388609), null, null);
        insert into __results values ('text: 8 MB gate', false, 'accepted');
    exception when others then
        insert into __results values ('text: 8 MB gate', sqlerrm like '%exceeds 8388608%', sqlerrm);
        execute 'set local role authenticated';
    end;

    begin
        insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, c_other, 'viewer');
        insert into __results values ('members: direct insert refused', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('members: direct insert refused', true, sqlerrm);
        execute 'set local role authenticated';
    end;

    update public.workspace_members set role = 'viewer' where workspace_id = v_ws and user_id = c_editor;
    insert into __results values ('members: owner changes role',
        (select role from public.workspace_members where workspace_id = v_ws and user_id = c_editor) = 'viewer', null);
    update public.workspace_members set role = 'editor' where workspace_id = v_ws and user_id = c_editor;

    begin
        insert into public.workspace_invites (
            workspace_id, email, role, invited_by, token, expires_at
        ) values (
            v_ws, 'rls-direct@example.invalid', 'viewer', c_owner, repeat('0', 64), now() + interval '14 days'
        );
        insert into __results values ('invites: direct insert refused', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('invites: direct insert refused', true, sqlerrm);
        execute 'set local role authenticated';
    end;

    v_json := public.add_workspace_member(v_ws, '  RLS-Wait@example.invalid ', 'editor');
    insert into __results values ('invites: pending for unknown email',
        v_json->>'kind' = 'pending'
        and (select count(*) from public.workspace_invites
              where workspace_id = v_ws and email = 'rls-wait@example.invalid') = 1,
        v_json::text);
    v_key := v_json->>'token';

    v_json := public.add_workspace_member(v_ws, 'rls-wait@example.invalid', 'viewer');
    insert into __results values ('invites: upsert updates role without a second row',
        v_json->>'kind' = 'pending'
        and (select count(*) from public.workspace_invites
              where workspace_id = v_ws and email = 'rls-wait@example.invalid') = 1
        and (select role from public.workspace_invites
              where workspace_id = v_ws and email = 'rls-wait@example.invalid') = 'viewer'
        and (v_json->>'token') is distinct from v_key,
        v_json::text);
    v_invite_token := v_json->>'token';

    begin
        perform (select token from public.workspace_invites where workspace_id = v_ws limit 1);
        insert into __results values ('invites: token column not granted', false, 'selected');
    exception when insufficient_privilege then
        insert into __results values ('invites: token column not granted', true, sqlerrm);
        execute 'set local role authenticated';
    end;

    insert into __results values ('invites: owner preview',
        (public.preview_workspace_invite(v_invite_token)->>'email') = 'rls-wait@example.invalid',
        public.preview_workspace_invite(v_invite_token)::text);

    v_json := public.add_workspace_member(v_ws, 'rls-new@example.invalid', 'editor');
    execute 'reset role';
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (c_pending, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'rls-new@example.invalid', '', now(),
            '{"provider":"email","providers":["email"]}', '{}', now(), now());
    insert into __results values ('invites: signup converts pending',
        exists (
            select 1 from public.workspace_members
             where workspace_id = v_ws and user_id = c_pending and role = 'editor'
        ), null);
    insert into __results values ('invites: pending removed after signup',
        (select count(*) from public.workspace_invites where email = 'rls-new@example.invalid') = 0, null);

    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_json := public.add_workspace_member(v_ws, 'rls-expired@example.invalid', 'viewer');
    execute 'reset role';
    update public.workspace_invites
       set expires_at = now() - interval '1 day'
     where email = 'rls-expired@example.invalid';
    insert into __results values ('invites: expired preview is null',
        public.preview_workspace_invite(v_json->>'token') is null, null);
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (c_expired, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'rls-expired@example.invalid', '', now(),
            '{"provider":"email","providers":["email"]}', '{}', now(), now());
    insert into __results values ('invites: expired signup does not convert',
        not exists (
            select 1 from public.workspace_members
             where workspace_id = v_ws and user_id = c_expired
        ), null);
    insert into __results values ('invites: expired pending is deleted on signup',
        (select count(*) from public.workspace_invites where email = 'rls-expired@example.invalid') = 0, null);

    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_old := private.get_or_create_system_workspace();
    begin
        perform public.add_workspace_member(v_old, 'rls-system@example.invalid', 'viewer');
        insert into __results values ('invites: system workspace refused', false, 'accepted');
    exception when others then
        insert into __results values ('invites: system workspace refused',
            sqlerrm like '%cannot be shared%', sqlerrm);
        execute 'set local role authenticated';
    end;

    begin
        perform public.add_workspace_member(v_ws, 'rls-editor@example.invalid', 'editor');
        insert into __results values ('invites: already a member refused', false, 'accepted');
    exception when others then
        insert into __results values ('invites: already a member refused',
            sqlerrm like '%already a member%', sqlerrm);
        execute 'set local role authenticated';
    end;

    for v_n in 1..19 loop
        v_json := public.add_workspace_member(v_ws, 'rls-cap-' || v_n || '@example.invalid', 'viewer');
    end loop;
    begin
        v_json := public.add_workspace_member(v_ws, 'rls-cap-20@example.invalid', 'viewer');
        insert into __results values ('invites: 21st live pending refused', false, 'accepted');
    exception when others then
        insert into __results values ('invites: 21st live pending refused',
            sqlerrm like '%too many pending invites%', sqlerrm);
        execute 'set local role authenticated';
    end;
    v_json := public.add_workspace_member(v_ws, 'rls-wait@example.invalid', 'viewer');
    insert into __results values ('invites: resend of a live row is not capped',
        v_json->>'kind' = 'pending', v_json::text);
    v_invite_token := v_json->>'token';
    delete from public.workspace_invites where email like 'rls-cap-%@example.invalid';

    execute 'reset role';
    insert into public.workspace_invites (
        workspace_id, email, role, invited_by, token, expires_at
    ) values (
        v_ws, 'rls-other@example.invalid', 'viewer', c_owner, repeat('c', 64), now() + interval '14 days'
    );
    perform set_config('request.jwt.claims', json_build_object('sub', c_other, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.claim_workspace_invites();
    insert into __results values ('invites: existing user claims pending',
        exists (
            select 1 from public.workspace_members
             where workspace_id = v_ws and user_id = c_other and role = 'viewer'
        )
        and (select count(*) from public.workspace_invites where email = 'rls-other@example.invalid') = 0,
        null);
    execute 'reset role';
    delete from public.workspace_members where workspace_id = v_ws and user_id = c_other;
    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';

    begin
        update public.profiles set username = 'hub' where id = c_owner;
        insert into __results values ('profiles: reserved username refused', false, 'accepted');
    exception when check_violation then
        insert into __results values ('profiles: reserved username refused', true, null);
        execute 'set local role authenticated';
    end;

    begin
        update public.profiles set username = 'invite' where id = c_owner;
        insert into __results values ('profiles: reserved invite username refused', false, 'accepted');
    exception when check_violation then
        insert into __results values ('profiles: reserved invite username refused', true, null);
        execute 'set local role authenticated';
    end;

    -- trash: restore brings back only the batch trashed with the root
    v_json := public.create_text_file(v_folder, 'a.txt', 'text/plain', 'old', null, null);
    v_old := (v_json->>'id')::uuid;
    perform public.delete_entry(v_old, null);
    execute 'reset role';
    update public.entries set deleted_at = deleted_at - interval '1 day' where id = v_old; -- an earlier batch
    execute 'set local role authenticated';
    v_json := public.create_text_file(v_folder, 'a.txt', 'text/plain', 'new', null, null);
    v_new := (v_json->>'id')::uuid;
    perform public.delete_entry(v_folder, null);
    perform public.restore_entry(v_folder, null);
    insert into __results values ('trash: restore keeps an earlier-trashed child in the trash',
        (select deleted_at is null from public.entries where id = v_new)
        and (select deleted_at is not null from public.entries where id = v_old), null);
    insert into __results values ('trash: list_trash shows it at top level again',
        (select count(*) from public.list_trash(v_ws) t where t.id = v_old) = 1, null);

    -- a folder that carries ink and an edge, then goes to the trash: readers
    -- must lose both with it (checked in the anon section below)
    insert into public.entries (workspace_id, parent_id, name, kind)
    values (v_ws, v_root, 'gone', 'folder')
    returning id into v_gone;
    v_gone_stroke := gen_random_uuid();
    insert into public.folder_strokes (id, entry_id, workspace_id, z, position, points,
                                       color, stroke_width, width, height)
    values (v_gone_stroke, v_gone, v_ws, 1, '{"x":0,"y":0}', '[]', '#000', 1, 1, 1);
    v_gone_edge := 'gone:default-gone:default';
    insert into public.folder_connections (id, entry_id, workspace_id, from_entry, to_entry)
    values (v_gone_edge, v_gone, v_ws, v_folder, v_file);
    perform public.delete_entry(v_gone, null);
    insert into __results values ('trash: a trashed folder keeps its ink and edge rows',
        (select count(*) from public.folder_strokes where id = v_gone_stroke) = 1
        and (select count(*) from public.folder_connections
              where workspace_id = v_ws and id = v_gone_edge) = 1, null);

    execute 'reset role';

    -- ------------------------------------------------------------------
    -- service_role: blob rows, hub preview registry
    -- ------------------------------------------------------------------
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role service_role';

    v_key := v_ws::text || '/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png';
    v_json := public.create_blob_entry(null, v_ws, v_root, 'photo.png', 'image/png', v_key, 1000, c_owner, 'suite');
    insert into __results values ('service: create_blob_entry',
        (v_json->>'size_bytes')::int = 1000 and (v_json->>'updated_by')::uuid = c_owner, v_json->>'path');

    begin
        v_json := public.create_blob_entry(null, v_ws, v_root, 'foreign.png', 'image/png',
            '99999999-9999-4999-8999-999999999999/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png', 1, c_owner, null);
        insert into __results values ('service: foreign key prefix refused', false, 'accepted');
    exception when others then
        insert into __results values ('service: foreign key prefix refused', sqlerrm like '%does not belong%', sqlerrm);
        execute 'set local role service_role';
    end;

    begin
        v_json := public.create_blob_entry(null, v_ws, v_root, 'viewer.png', 'image/png',
            v_ws::text || '/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png', 1, c_viewer, null);
        insert into __results values ('service: viewer cannot own a blob row', false, 'accepted');
    exception when others then
        insert into __results values ('service: viewer cannot own a blob row', sqlerrm like '%access denied%', sqlerrm);
        execute 'set local role service_role';
    end;

    begin
        v_json := public.create_blob_entry(null, v_ws, v_root, 'huge.bin', 'application/octet-stream',
            v_ws::text || '/cccccccc-cccc-4ccc-8ccc-cccccccccccc.bin', 30::bigint * 1024 * 1024, c_owner, null);
        insert into __results values ('service: file_too_large enforced', false, 'accepted');
    exception when others then
        insert into __results values ('service: file_too_large enforced', sqlerrm like '%file_too_large%', sqlerrm);
        execute 'set local role service_role';
    end;

    -- re-key does not bump the mtime
    select content_modified_at into v_mtime from public.entries where storage_key = v_key;
    perform pg_sleep(0.01);
    update public.entries set storage_key = v_ws::text || '/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png' where storage_key = v_key;
    insert into __results values ('service: re-key keeps content_modified_at',
        (select content_modified_at from public.entries where id = (select id from public.entries where storage_key = v_ws::text || '/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png')) = v_mtime, null);

    begin
        perform public.record_hub_preview_upload('hub/' || v_ws::text || '/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.png', 3 * 1024 * 1024, c_owner);
        insert into __results values ('service: oversize hub preview refused', false, 'accepted');
    exception when others then
        insert into __results values ('service: oversize hub preview refused', sqlerrm like '%exceeds%', sqlerrm);
        execute 'set local role service_role';
    end;

    insert into public.plan_launch_subscribers (email) values ('wait@example.invalid');
    insert into __results values ('service: plan_launch_subscribers insert',
        (select count(*) from public.plan_launch_subscribers where email = 'wait@example.invalid') = 1, null);

    insert into public.feedback (email, category, message, attachments)
    values (
        'fb@example.invalid',
        'idea',
        'hello from the rls suite',
        '[{"path":"11111111-1111-4111-8111-111111111111/a.png","mime":"image/png","size_bytes":12}]'::jsonb
    );
    insert into __results values ('service: feedback insert',
        (select count(*) from public.feedback where email = 'fb@example.invalid') = 1, null);
    begin
        insert into public.feedback (email, category, message, attachments)
        values (
            'fb-cap@example.invalid',
            'bug',
            'too many pictures',
            '[1,2,3,4,5,6]'::jsonb
        );
        insert into __results values ('service: feedback attachments cap', false, 'accepted');
    exception when check_violation then
        insert into __results values ('service: feedback attachments cap', true, null);
        execute 'set local role service_role';
    end;

    -- egress: the blob row the readers below resolve, a finalized Hub
    -- preview to list later, and the meter's flush
    select id into v_blob from public.entries where storage_key = v_ws::text || '/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png';
    v_hub_key := 'hub/' || v_ws::text || '/abababab-abab-4bab-8bab-abababababab.png';
    perform public.record_hub_preview_upload(v_hub_key, 1234, c_owner);

    perform public.egress_sync(current_date, jsonb_build_array(
        jsonb_build_object('owner_id', c_owner, 'day', current_date, 'bytes', 150),
        jsonb_build_object('owner_id', c_owner, 'day', current_date, 'bytes', 50)));
    select count(*) into v_n
      from public.egress_sync(current_date, jsonb_build_array(
               jsonb_build_object('owner_id', c_owner, 'day', current_date, 'bytes', 0))) s
     where s.owner_id = c_owner and s.day_bytes = 200 and s.month_bytes = 200
       and s.egress_bytes_month = 20::bigint * 1024 * 1024 * 1024
       and s.max_public_file_bytes = 10 * 1024 * 1024;
    insert into __results values ('service: egress_sync adds per owner/day, zero bytes only read',
        v_n = 1 and (select count(*) from public.egress_daily where owner_id = c_owner) = 1, null);

    select count(*) into v_n
      from public.egress_sync(current_date, jsonb_build_array(
               jsonb_build_object('owner_id', '99999999-9999-4999-8999-999999999999', 'day', current_date, 'bytes', 10)));
    insert into __results values ('service: egress_sync skips unknown owners',
        v_n = 0 and (select count(*) from public.egress_daily
                      where owner_id = '99999999-9999-4999-8999-999999999999') = 0, null);

    -- the Download as .pile ledger: the same flush, charged to the downloader
    perform public.download_sync(current_date, jsonb_build_array(
        jsonb_build_object('user_id', c_other, 'day', current_date, 'bytes', 300),
        jsonb_build_object('user_id', c_other, 'day', current_date, 'bytes', 20)));
    select count(*) into v_n
      from public.download_sync(current_date, jsonb_build_array(
               jsonb_build_object('user_id', c_other, 'day', current_date, 'bytes', 0))) s
     where s.user_id = c_other and s.day_bytes = 320 and s.month_bytes = 320
       and s.download_bytes_month = 20::bigint * 1024 * 1024 * 1024;
    insert into __results values ('service: download_sync adds per user/day, zero bytes only read',
        v_n = 1 and (select count(*) from public.download_daily where user_id = c_other) = 1
        and (select count(*) from public.egress_daily where owner_id = c_other) = 0, null);

    select count(*) into v_n
      from public.download_sync(current_date, jsonb_build_array(
               jsonb_build_object('user_id', '99999999-9999-4999-8999-999999999999', 'day', current_date, 'bytes', 10)));
    insert into __results values ('service: download_sync skips unknown accounts',
        v_n = 0 and (select count(*) from public.download_daily
                      where user_id = '99999999-9999-4999-8999-999999999999') = 0, null);

    insert into public.egress_notices (owner_id, period, kind) values (c_owner, current_date, 'alert_day');
    begin
        insert into public.egress_notices (owner_id, period, kind) values (c_owner, current_date, 'alert_day');
        insert into __results values ('service: egress_notices is send-once', false, 'accepted');
    exception when unique_violation then
        insert into __results values ('service: egress_notices is send-once', true, null);
        execute 'set local role service_role';
    end;

    -- previews go to non-members only, who see public boards alone: the
    -- blobs of a private board are never pending
    insert into __results values ('service: list_pending_derivatives skips private boards',
        (select count(*) from public.list_pending_derivatives(array['thumb', 'poster'], 5, 100) p
          where p.storage_key like v_ws::text || '/%') = 0, null);

    execute 'reset role';

    -- ------------------------------------------------------------------
    -- egress readers: download_target resolves by entry, the owner is exempt
    -- ------------------------------------------------------------------
    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into __results values ('owner: download_target exempts the owner',
        (select count(*) from public.download_target(v_blob) t
          where t.owner_id = c_owner and t.is_member and t.size_bytes = 1000
            and t.storage_key = v_ws::text || '/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png') = 1, null);
    insert into __results values ('owner: download_target is empty for text files',
        (select count(*) from public.download_target(v_file)) = 0, null);
    perform public.delete_entry(v_blob, null);
    insert into __results values ('owner: download_target hides trashed rows',
        (select count(*) from public.download_target(v_blob)) = 0, null);
    perform public.restore_entry(v_blob, null);
    insert into __results values ('owner: download_target is back after restore',
        (select count(*) from public.download_target(v_blob)) = 1, null);
    execute 'reset role';

    -- ------------------------------------------------------------------
    -- authenticated may not touch the backend-only RPCs
    -- ------------------------------------------------------------------
    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
        v_json := public.create_blob_entry(null, v_ws, v_root, 'x.png', 'image/png', v_ws::text || '/ffffffff-ffff-4fff-8fff-ffffffffffff.png', 1, c_owner, null);
        insert into __results values ('authenticated: create_blob_entry revoked', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('authenticated: create_blob_entry revoked', true, null);
        execute 'set local role authenticated';
    end;
    begin
        perform public.replace_blob_entry(v_file, v_ws, v_ws::text || '/ffffffff-ffff-4fff-8fff-ffffffffffff.png', 1, 'image/png', c_owner, null);
        insert into __results values ('authenticated: replace_blob_entry revoked', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('authenticated: replace_blob_entry revoked', true, null);
        execute 'set local role authenticated';
    end;
    begin
        select count(*) into v_n from public.list_foreign_blob_entries(10);
        insert into __results values ('authenticated: list_foreign_blob_entries revoked', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('authenticated: list_foreign_blob_entries revoked', true, null);
        execute 'set local role authenticated';
    end;
    begin
        select count(*) into v_n from public.list_subtree_files(v_root);
        insert into __results values ('authenticated: list_subtree_files revoked', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('authenticated: list_subtree_files revoked', true, null);
        execute 'set local role authenticated';
    end;
    begin
        perform public.record_hub_preview_upload('hub/' || v_ws::text || '/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.png', 1, c_owner);
        insert into __results values ('authenticated: record_hub_preview_upload revoked', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('authenticated: record_hub_preview_upload revoked', true, null);
        execute 'set local role authenticated';
    end;
    begin
        insert into public.plan_launch_subscribers (email) values ('auth-leak@example.invalid');
        insert into __results values ('authenticated: cannot insert plan_launch_subscribers', false, 'accepted');
    exception when others then
        insert into __results values ('authenticated: cannot insert plan_launch_subscribers', true, sqlerrm);
        execute 'set local role authenticated';
    end;
    begin
        select count(*) into v_n from public.plan_launch_subscribers;
        insert into __results values ('authenticated: cannot read plan_launch_subscribers', v_n = 0, format('count=%s', v_n));
    exception when insufficient_privilege then
        insert into __results values ('authenticated: cannot read plan_launch_subscribers', true, sqlerrm);
        execute 'set local role authenticated';
    end;
    begin
        insert into public.feedback (email, category, message)
        values ('auth-fb@example.invalid', 'bug', 'nope');
        insert into __results values ('authenticated: cannot insert feedback', false, 'accepted');
    exception when others then
        insert into __results values ('authenticated: cannot insert feedback', true, sqlerrm);
        execute 'set local role authenticated';
    end;
    begin
        select count(*) into v_n from public.feedback;
        insert into __results values ('authenticated: cannot read feedback', v_n = 0, format('count=%s', v_n));
    exception when insufficient_privilege then
        insert into __results values ('authenticated: cannot read feedback', true, sqlerrm);
        execute 'set local role authenticated';
    end;
    begin
        select count(*) into v_n from public.egress_sync(current_date, '[]'::jsonb);
        insert into __results values ('authenticated: egress_sync revoked', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('authenticated: egress_sync revoked', true, null);
        execute 'set local role authenticated';
    end;
    begin
        select count(*) into v_n from public.egress_daily;
        insert into __results values ('authenticated: cannot read egress_daily', v_n = 0, format('count=%s', v_n));
    exception when insufficient_privilege then
        insert into __results values ('authenticated: cannot read egress_daily', true, sqlerrm);
        execute 'set local role authenticated';
    end;
    begin
        select count(*) into v_n from public.download_sync(current_date, '[]'::jsonb);
        insert into __results values ('authenticated: download_sync revoked', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('authenticated: download_sync revoked', true, null);
        execute 'set local role authenticated';
    end;
    begin
        select count(*) into v_n from public.download_daily;
        insert into __results values ('authenticated: cannot read download_daily', v_n = 0, format('count=%s', v_n));
    exception when insufficient_privilege then
        insert into __results values ('authenticated: cannot read download_daily', true, sqlerrm);
        execute 'set local role authenticated';
    end;
    begin
        insert into public.egress_notices (owner_id, period, kind) values (c_owner, current_date, 'alert_month');
        insert into __results values ('authenticated: cannot insert egress_notices', false, 'accepted');
    exception when others then
        insert into __results values ('authenticated: cannot insert egress_notices', true, sqlerrm);
        execute 'set local role authenticated';
    end;
    execute 'reset role';

    -- ------------------------------------------------------------------
    -- editor
    -- ------------------------------------------------------------------
    perform set_config('request.jwt.claims', json_build_object('sub', c_editor, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into public.entries (workspace_id, parent_id, name, kind) values (v_ws, v_root, 'by-editor', 'folder');
    v_json := public.create_text_file(v_root, 'editor.md', 'text/markdown', 'e', null, null);
    insert into __results values ('editor: writes folders and text files', v_json->>'id' is not null, null);
    insert into __results values ('editor: sees the trash', (select count(*) from public.entries where id = v_old) = 1, null);
    insert into __results values ('editor: still sees the ink and edges of a trashed folder',
        (select count(*) from public.folder_strokes where id = v_gone_stroke) = 1
        and (select count(*) from public.folder_connections
              where workspace_id = v_ws and id = v_gone_edge) = 1, null);
    insert into __results values ('editor: download_target exempts members',
        (select count(*) from public.download_target(v_blob) t where t.is_member and t.owner_id = c_owner) = 1, null);
    insert into __results values ('editor: cannot see pending invites',
        (select count(*) from public.workspace_invites) = 0, null);
    select count(*) into v_n from public.merge_entry_xattrs(v_ws, jsonb_build_array(
        jsonb_build_object('path', '/docs/note.md', 'xattrs', jsonb_build_object('by', 'editor'))), null);
    insert into __results values ('editor: merge_entry_xattrs',
        v_n = 0 and (select xattrs->>'by' = 'editor' from public.entries where id = v_file), null);
    execute 'reset role';

    -- ------------------------------------------------------------------
    -- viewer
    -- ------------------------------------------------------------------
    perform set_config('request.jwt.claims', json_build_object('sub', c_viewer, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
        perform public.merge_entry_xattrs(v_ws, jsonb_build_array(
            jsonb_build_object('path', '/docs/note.md', 'xattrs', jsonb_build_object('v', '1'))), null);
        insert into __results values ('viewer: merge_entry_xattrs refused', false, 'accepted');
    exception when others then
        insert into __results values ('viewer: merge_entry_xattrs refused', sqlerrm like '%access denied%', sqlerrm);
        execute 'set local role authenticated';
    end;
    insert into __results values ('viewer: reads live rows', (select count(*) from public.entries where id = v_file) = 1, null);
    insert into __results values ('viewer: reads content', (select count(*) from public.entry_contents where entry_id = v_file) = 1, null);
    insert into __results values ('viewer: does not see the trash', (select count(*) from public.entries where id = v_old) = 0, null);
    insert into __results values ('viewer: does not see the ink or edges of a trashed folder',
        (select count(*) from public.folder_strokes where id = v_gone_stroke) = 0
        and (select count(*) from public.folder_connections
              where workspace_id = v_ws and id = v_gone_edge) = 0, null);
    insert into __results values ('viewer: download_target exempts members',
        (select count(*) from public.download_target(v_blob) t where t.is_member and t.owner_id = c_owner) = 1, null);
    begin
        insert into public.entries (workspace_id, parent_id, name, kind) values (v_ws, v_root, 'by-viewer', 'folder');
        insert into __results values ('viewer: insert refused', false, 'accepted');
    exception when others then
        insert into __results values ('viewer: insert refused', sqlstate = '42501', sqlerrm);
        execute 'set local role authenticated';
    end;
    update public.entries set xattrs = '{"v":"1"}' where id = v_file;
    insert into __results values ('viewer: update is a no-op', (select xattrs ? 'v' from public.entries where id = v_file) is false, null);
    begin
        v_json := public.create_text_file(v_root, 'viewer.md', 'text/markdown', 'v', null, null);
        insert into __results values ('viewer: create_text_file refused', false, 'accepted');
    exception when others then
        insert into __results values ('viewer: create_text_file refused', sqlerrm like '%access denied%', sqlerrm);
        execute 'set local role authenticated';
    end;
    begin
        perform public.delete_entry(v_file, null);
        insert into __results values ('viewer: delete_entry refused', false, 'accepted');
    exception when others then
        insert into __results values ('viewer: delete_entry refused', sqlerrm like '%access denied%', sqlerrm);
        execute 'set local role authenticated';
    end;
    execute 'reset role';

    -- ------------------------------------------------------------------
    -- stranger (authenticated, not a member)
    -- ------------------------------------------------------------------
    perform set_config('request.jwt.claims', json_build_object('sub', c_other, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into __results values ('stranger: sees nothing', (select count(*) from public.entries where workspace_id = v_ws) = 0, null);
    insert into __results values ('stranger: download_target on a private board is empty',
        (select count(*) from public.download_target(v_blob)) = 0, null);
    insert into __results values ('stranger: username-less profiles hidden',
        (select count(*) from public.profiles where id in (c_editor, c_viewer)) = 0, null);
    insert into __results values ('stranger: profiles with username visible',
        (select count(*) from public.profiles where id = c_owner) = 1, null);
    insert into __results values ('stranger: cannot see pending invites',
        (select count(*) from public.workspace_invites) = 0, null);
    insert into __results values ('stranger: cannot see bridge_events of others',
        (select count(*) from public.bridge_events where owner_id = c_owner) = 0, null);
    begin
        v_json := public.folder_read(v_ws, '/');
        insert into __results values ('stranger: folder_read refused', false, 'accepted');
    exception when others then
        insert into __results values ('stranger: folder_read refused', sqlerrm like '%access denied%', sqlerrm);
        execute 'set local role authenticated';
    end;
    execute 'reset role';

    -- ------------------------------------------------------------------
    -- anon: private → nothing; public → live rows only, no writes
    -- ------------------------------------------------------------------
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
    insert into __results values ('anon: private workspace invisible', (select count(*) from public.entries where workspace_id = v_ws) = 0, null);
    insert into __results values ('anon: download_target on a private board is empty',
        (select count(*) from public.download_target(v_blob)) = 0, null);
    insert into __results values ('anon: preview by token',
        (public.preview_workspace_invite(v_invite_token)->>'email') = 'rls-wait@example.invalid',
        public.preview_workspace_invite(v_invite_token)::text);
    insert into __results values ('anon: preview unknown token is null',
        public.preview_workspace_invite(repeat('f', 64)) is null, null);
    begin
        perform public.claim_workspace_invites();
        insert into __results values ('anon: claim_workspace_invites revoked', false, 'accepted');
    exception when others then
        insert into __results values ('anon: claim_workspace_invites revoked', true, sqlerrm);
        execute 'set local role anon';
    end;
    begin
        perform public.merge_entry_xattrs(v_ws, '[]'::jsonb, null);
        insert into __results values ('anon: merge_entry_xattrs revoked', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('anon: merge_entry_xattrs revoked', true, null);
        execute 'set local role anon';
    end;
    begin
        insert into public.bridge_events (owner_id, step, door, source_type)
        values (c_owner, 'opened', 'list', 'local');
        insert into __results values ('anon: cannot insert bridge_events', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('anon: cannot insert bridge_events', true, null);
        execute 'set local role anon';
    end;
    begin
        perform public.replace_blob_entry(v_file, v_ws, v_ws::text || '/ffffffff-ffff-4fff-8fff-ffffffffffff.png', 1, 'image/png', c_owner, null);
        insert into __results values ('anon: replace_blob_entry revoked', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('anon: replace_blob_entry revoked', true, null);
        execute 'set local role anon';
    end;
    begin
        select count(*) into v_n from public.plan_limits('pro');
        insert into __results values ('anon: plan_limits revoked', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('anon: plan_limits revoked', true, null);
        execute 'set local role anon';
    end;
    begin
        select count(*) into v_n from public.workspace_invites;
        insert into __results values ('anon: cannot select invites', v_n = 0, format('count=%s', v_n));
    exception when insufficient_privilege then
        insert into __results values ('anon: cannot select invites', true, sqlerrm);
        execute 'set local role anon';
    end;
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    perform private.set_workspace_public(v_ws, 'rls-public', true);
    perform private.set_hub_listing(v_ws, 'suite', array['rls'], true, v_hub_key);
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
    insert into __results values ('anon: public live rows visible',
        (select count(*) from public.entries where workspace_id = v_ws and deleted_at is null) > 0, null);
    insert into __results values ('anon: trash invisible', (select count(*) from public.entries where id = v_old) = 0, null);
    insert into __results values ('anon: trashed content invisible', (select count(*) from public.entry_contents where entry_id = v_old) = 0, null);
    insert into __results values ('anon: live content visible', (select count(*) from public.entry_contents where entry_id = v_file) = 1, null);
    insert into __results values ('anon: ink of a trashed folder invisible',
        (select count(*) from public.folder_strokes where id = v_gone_stroke) = 0, null);
    insert into __results values ('anon: edges of a trashed folder invisible',
        (select count(*) from public.folder_connections
          where workspace_id = v_ws and id = v_gone_edge) = 0, null);
    insert into __results values ('anon: ink of a live folder still visible',
        (select count(*) from public.folder_strokes where entry_id = v_root) >= 0
        and (select count(*) from public.folder_connections
              where workspace_id = v_ws and id = '/docs:default-/docs/note.md:default') = 1, null);
    insert into __results values ('anon: download_target charges the owner of a public board',
        (select count(*) from public.download_target(v_blob) t
          where t.owner_id = c_owner and not t.is_member and t.size_bytes = 1000) = 1, null);
    insert into __results values ('anon: download_target offers originals when forks and downloads are allowed',
        (select count(*) from public.download_target(v_blob) t where t.allow_download) = 1, null);
    insert into __results values ('anon: hub_preview_target resolves a listed preview',
        (select count(*) from public.hub_preview_target(v_hub_key) t
          where t.owner_id = c_owner and t.size_bytes = 1234) = 1, null);
    insert into __results values ('anon: hub_preview_target ignores unlisted keys',
        (select count(*) from public.hub_preview_target('hub/' || v_ws::text || '/cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd.png')) = 0, null);
    begin
        select count(*) into v_n from public.egress_sync(current_date, '[]'::jsonb);
        insert into __results values ('anon: egress_sync revoked', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('anon: egress_sync revoked', true, null);
        execute 'set local role anon';
    end;
    begin
        select count(*) into v_n from public.download_sync(current_date, '[]'::jsonb);
        insert into __results values ('anon: download_sync revoked', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('anon: download_sync revoked', true, null);
        execute 'set local role anon';
    end;
    begin
        select count(*) into v_n from public.download_daily;
        insert into __results values ('anon: cannot read download_daily', v_n = 0, format('count=%s', v_n));
    exception when insufficient_privilege then
        insert into __results values ('anon: cannot read download_daily', true, sqlerrm);
        execute 'set local role anon';
    end;
    begin
        select count(*) into v_n from public.egress_notices;
        insert into __results values ('anon: cannot read egress_notices', v_n = 0, format('count=%s', v_n));
    exception when insufficient_privilege then
        insert into __results values ('anon: cannot read egress_notices', true, sqlerrm);
        execute 'set local role anon';
    end;
    begin
        insert into public.folder_strokes (id, entry_id, workspace_id, z, position, points, color, stroke_width, width, height)
        values (gen_random_uuid(), v_root, v_ws, 1, '{"x":0,"y":0}', '[]', '#000', 1, 1, 1);
        insert into __results values ('anon: cannot write strokes', false, 'accepted');
    exception when others then
        insert into __results values ('anon: cannot write strokes', sqlstate = '42501', sqlerrm);
        execute 'set local role anon';
    end;
    begin
        insert into public.plan_launch_subscribers (email) values ('anon-leak@example.invalid');
        insert into __results values ('anon: cannot insert plan_launch_subscribers', false, 'accepted');
    exception when others then
        insert into __results values ('anon: cannot insert plan_launch_subscribers', true, sqlerrm);
        execute 'set local role anon';
    end;
    begin
        select count(*) into v_n from public.plan_launch_subscribers;
        insert into __results values ('anon: cannot read plan_launch_subscribers', v_n = 0, format('count=%s', v_n));
    exception when insufficient_privilege then
        insert into __results values ('anon: cannot read plan_launch_subscribers', true, sqlerrm);
        execute 'set local role anon';
    end;
    begin
        insert into public.feedback (email, category, message)
        values ('anon-fb@example.invalid', 'other', 'nope');
        insert into __results values ('anon: cannot insert feedback', false, 'accepted');
    exception when others then
        insert into __results values ('anon: cannot insert feedback', true, sqlerrm);
        execute 'set local role anon';
    end;
    begin
        select count(*) into v_n from public.feedback;
        insert into __results values ('anon: cannot read feedback', v_n = 0, format('count=%s', v_n));
    exception when insufficient_privilege then
        insert into __results values ('anon: cannot read feedback', true, sqlerrm);
        execute 'set local role anon';
    end;
    execute 'reset role';

    -- ------------------------------------------------------------------
    -- allow_fork off: no originals for visitors and no forks; back on after
    -- ------------------------------------------------------------------
    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    perform private.set_workspace_public(v_ws, 'rls-public', false);
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
    insert into __results values ('anon: download_target withholds originals when the author disallows downloads',
        (select count(*) from public.download_target(v_blob) t
          where not t.allow_download and not t.is_member) = 1, null);
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', c_other, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
        perform public.fork_workspace(v_ws);
        insert into __results values ('stranger: fork refused when the author disallows forks', false, 'accepted');
    exception when others then
        insert into __results values ('stranger: fork refused when the author disallows forks',
            sqlerrm like '%does not allow forks%', sqlerrm);
        execute 'set local role authenticated';
    end;
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    perform private.set_workspace_public(v_ws, 'rls-public', true);
    perform set_config('request.jwt.claims', '', true);

    -- ------------------------------------------------------------------
    -- fork: rows carry the source prefix and are listed for re-key
    -- ------------------------------------------------------------------
    perform set_config('request.jwt.claims', json_build_object('sub', c_other, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_fork := public.fork_workspace(v_ws);
    insert into __results values ('fork: a stranger is metered on the public source',
        (select count(*) from public.download_target(v_blob) t where t.owner_id = c_owner and not t.is_member) = 1, null);
    -- the fork row still points at the source's key, yet the forker owns it
    insert into __results values ('fork: download_target attributes by entry, not by key prefix',
        (select count(*) from public.entries e
           cross join lateral public.download_target(e.id) t
          where e.workspace_id = v_fork and e.storage_key is not null
            and t.owner_id = c_other and t.is_member
            and t.storage_key like v_ws::text || '/%') = 1, null);
    execute 'reset role';
    execute 'set local role service_role';
    insert into __results values ('fork: foreign-prefixed rows queued for re-key',
        (select count(*) from public.list_foreign_blob_entries(100) f where f.workspace_id = v_fork) = 1, null);
    insert into __results values ('fork: source rows are not re-keyed',
        (select count(*) from public.list_subtree_files(v_root)) = 0, null);
    execute 'reset role';

    -- ------------------------------------------------------------------
    -- previews (entry_derivatives): pending on a public board → decided →
    -- handed to non-members by download_target; prune retires the rows of
    -- blobs nobody references; the owner quota never counts them. After
    -- the fork block: these extra blobs would change what the fork clones
    -- ------------------------------------------------------------------
    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    select used_bytes into v_used from private.owner_usage(c_owner);
    select live_bytes + trash_bytes into v_ws_used from private.workspace_usage(v_ws);
    v_deriv := 'deriv/' || v_ws::text || '/dddddddd-dddd-4ddd-8ddd-dddddddddddd/thumb.webp';

    perform set_config('request.jwt.claims', '', true);
    execute 'set local role service_role';
    v_json := public.create_blob_entry(null, v_ws, v_root, 'clip.mp4', 'video/mp4',
        v_ws::text || '/13131313-1313-4313-8313-131313131313.mp4', 2000, c_owner, null);
    v_video := (v_json->>'id')::uuid;
    v_json := public.create_blob_entry(null, v_ws, v_root, 'retry.jpg', 'image/jpeg',
        v_ws::text || '/14141414-1414-4414-8414-141414141414.jpg', 3000, c_owner, null);
    v_retry := (v_json->>'id')::uuid;

    insert into __results values ('service: list_pending_derivatives maps image → thumb, video → poster on a public board',
        (select count(*) from public.list_pending_derivatives(array['thumb', 'poster'], 5, 100) p
          where (p.storage_key, p.kind) in (
              (v_ws::text || '/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png', 'thumb'),
              (v_ws::text || '/13131313-1313-4313-8313-131313131313.mp4', 'poster'),
              (v_ws::text || '/14141414-1414-4414-8414-141414141414.jpg', 'thumb'))) = 3, null);
    insert into __results values ('service: list_pending_derivatives leaves video out when posters are off',
        (select count(*) from public.list_pending_derivatives(array['thumb'], 5, 100) p
          where p.storage_key like v_ws::text || '/%' and p.kind = 'poster') = 0, null);

    insert into __results values ('service: record_derivative ready',
        public.record_derivative(v_ws::text || '/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png', 'thumb', 'ready',
            v_deriv, 600, 1600, 1200, null), null);
    begin
        perform public.record_derivative(v_ws::text || '/14141414-1414-4414-8414-141414141414.jpg', 'thumb', 'ready',
            v_deriv, 600, 1600, 1200, null);
        insert into __results values ('service: record_derivative refuses a key not derived from the blob', false, 'accepted');
    exception when others then
        insert into __results values ('service: record_derivative refuses a key not derived from the blob',
            sqlerrm like '%does not derive%', sqlerrm);
        execute 'set local role service_role';
    end;
    insert into __results values ('service: record_derivative ignores a blob no entry references',
        not public.record_derivative(v_ws::text || '/15151515-1515-4515-8515-151515151515.png', 'thumb', 'ready',
                'deriv/' || v_ws::text || '/15151515-1515-4515-8515-151515151515/thumb.webp', 10, 1, 1, null)
        and (select count(*) from public.entry_derivatives
              where storage_key = v_ws::text || '/15151515-1515-4515-8515-151515151515.png') = 0, null);

    perform public.record_derivative(v_ws::text || '/13131313-1313-4313-8313-131313131313.mp4', 'poster', 'skipped',
        null, null, null, null, 'small');
    insert into __results values ('service: decided blobs are no longer pending',
        (select count(*) from public.list_pending_derivatives(array['thumb', 'poster'], 5, 100) p
          where p.storage_key in (v_ws::text || '/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png',
                                  v_ws::text || '/13131313-1313-4313-8313-131313131313.mp4')) = 0, null);

    perform public.fail_derivative(v_ws::text || '/14141414-1414-4414-8414-141414141414.jpg', 'thumb', 'first', 60);
    v_n := public.fail_derivative(v_ws::text || '/14141414-1414-4414-8414-141414141414.jpg', 'thumb', 'second', 60);
    insert into __results values ('service: fail_derivative counts attempts and backs off',
        v_n = 2 and (select status = 'failed' and last_error = 'second' and next_attempt_at > now()
                       from public.entry_derivatives
                      where storage_key = v_ws::text || '/14141414-1414-4414-8414-141414141414.jpg'),
        format('attempts=%s', v_n));
    insert into __results values ('service: a failed blob waits for its backoff',
        (select count(*) from public.list_pending_derivatives(array['thumb'], 5, 100) p
          where p.storage_key = v_ws::text || '/14141414-1414-4414-8414-141414141414.jpg') = 0, null);
    insert into __results values ('service: fail_derivative never demotes a decided row',
        public.fail_derivative(v_ws::text || '/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png', 'thumb', 'late', 60) = 0
        and (select status from public.entry_derivatives
              where storage_key = v_ws::text || '/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png' and kind = 'thumb') = 'ready', null);
    begin
        insert into public.entry_derivatives (storage_key, kind, status)
        values (v_ws::text || '/14141414-1414-4414-8414-141414141414.jpg', 'poster', 'skipped');
        insert into __results values ('service: no direct writes to entry_derivatives', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('service: no direct writes to entry_derivatives', true, null);
        execute 'set local role service_role';
    end;
    execute 'reset role';

    -- past its backoff and in the trash: pending again (the trash is
    -- restorable); out of attempts: a dead letter
    update public.entry_derivatives set next_attempt_at = now() - interval '1 minute'
     where storage_key = v_ws::text || '/14141414-1414-4414-8414-141414141414.jpg';
    update public.entries set deleted_at = now() where id = v_retry;
    execute 'set local role service_role';
    insert into __results values ('service: a trashed blob past its backoff is pending again',
        (select count(*) from public.list_pending_derivatives(array['thumb'], 5, 100) p
          where p.storage_key = v_ws::text || '/14141414-1414-4414-8414-141414141414.jpg' and p.attempts = 2) = 1, null);
    insert into __results values ('service: no attempts left is a dead letter',
        (select count(*) from public.list_pending_derivatives(array['thumb'], 2, 100) p
          where p.storage_key = v_ws::text || '/14141414-1414-4414-8414-141414141414.jpg') = 0, null);
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    insert into __results values ('previews: owner and workspace usage do not count them',
        (select used_bytes from private.owner_usage(c_owner)) = v_used + 5000
        and (select live_bytes + trash_bytes from private.workspace_usage(v_ws)) = v_ws_used + 5000,
        format('owner +%s, workspace +%s (the two new blobs are 5000)',
               (select used_bytes from private.owner_usage(c_owner)) - v_used,
               (select live_bytes + trash_bytes from private.workspace_usage(v_ws)) - v_ws_used));

    execute 'set local role authenticated';
    insert into __results values ('owner: download_target stays exempt and reports the preview',
        (select count(*) from public.download_target(v_blob) t
          where t.is_member and t.deriv_key = v_deriv and t.deriv_kind = 'thumb') = 1, null);
    begin
        select count(*) into v_n from public.entry_derivatives;
        insert into __results values ('authenticated: cannot read entry_derivatives', v_n = 0, format('count=%s', v_n));
    exception when insufficient_privilege then
        insert into __results values ('authenticated: cannot read entry_derivatives', true, sqlerrm);
        execute 'set local role authenticated';
    end;
    begin
        select count(*) into v_n from public.list_pending_derivatives(array['thumb'], 5, 10);
        insert into __results values ('authenticated: list_pending_derivatives revoked', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('authenticated: list_pending_derivatives revoked', true, null);
        execute 'set local role authenticated';
    end;
    begin
        perform public.record_derivative(v_ws::text || '/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png', 'thumb', 'skipped',
            null, null, null, null, 'x');
        insert into __results values ('authenticated: record_derivative revoked', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('authenticated: record_derivative revoked', true, null);
        execute 'set local role authenticated';
    end;
    begin
        perform private.record_derivative(v_ws::text || '/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png', 'thumb', 'skipped',
            null, null, null, null, 'x');
        insert into __results values ('authenticated: private.record_derivative revoked', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('authenticated: private.record_derivative revoked', true, null);
        execute 'set local role authenticated';
    end;
    begin
        perform public.fail_derivative(v_ws::text || '/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png', 'thumb', 'x', 1);
        insert into __results values ('authenticated: fail_derivative revoked', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('authenticated: fail_derivative revoked', true, null);
        execute 'set local role authenticated';
    end;
    begin
        perform public.prune_entry_derivatives(1);
        insert into __results values ('authenticated: prune_entry_derivatives revoked', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('authenticated: prune_entry_derivatives revoked', true, null);
        execute 'set local role authenticated';
    end;
    execute 'reset role';

    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
    insert into __results values ('anon: download_target hands a non-member the ready preview',
        (select count(*) from public.download_target(v_blob) t
          where t.owner_id = c_owner and not t.is_member and t.size_bytes = 1000
            and t.deriv_key = v_deriv and t.deriv_size_bytes = 600 and t.deriv_kind = 'thumb') = 1, null);
    insert into __results values ('anon: no preview while the blob is only skipped',
        (select count(*) from public.download_target(v_video) t
          where not t.is_member and t.deriv_key is null and t.deriv_kind is null) = 1, null);
    begin
        select count(*) into v_n from public.entry_derivatives;
        insert into __results values ('anon: cannot read entry_derivatives', v_n = 0, format('count=%s', v_n));
    exception when insufficient_privilege then
        insert into __results values ('anon: cannot read entry_derivatives', true, sqlerrm);
        execute 'set local role anon';
    end;
    begin
        select count(*) into v_n from public.list_pending_derivatives(array['thumb'], 5, 10);
        insert into __results values ('anon: list_pending_derivatives revoked', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('anon: list_pending_derivatives revoked', true, null);
        execute 'set local role anon';
    end;
    begin
        perform public.record_derivative(v_ws::text || '/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png', 'thumb', 'skipped',
            null, null, null, null, 'x');
        insert into __results values ('anon: record_derivative revoked', false, 'accepted');
    exception when insufficient_privilege then
        insert into __results values ('anon: record_derivative revoked', true, null);
        execute 'set local role anon';
    end;
    execute 'reset role';

    -- prune: the row of a blob nothing references goes and its object is
    -- queued; referenced rows stay (the trashed retry.jpg included). A
    -- re-decision that drops an object queues it as well
    insert into public.entry_derivatives (storage_key, kind, status, deriv_key, deriv_size_bytes)
    values (v_ws::text || '/16161616-1616-4616-8616-161616161616.png', 'thumb', 'ready',
            'deriv/' || v_ws::text || '/16161616-1616-4616-8616-161616161616/thumb.webp', 10);
    execute 'set local role service_role';
    v_n := public.prune_entry_derivatives(10000);
    insert into __results values ('service: prune drops previews of unreferenced blobs and queues their objects',
        v_n >= 1
        and (select count(*) from public.entry_derivatives
              where storage_key = v_ws::text || '/16161616-1616-4616-8616-161616161616.png') = 0
        and (select count(*) from public.blob_deletions
              where storage_key = 'deriv/' || v_ws::text || '/16161616-1616-4616-8616-161616161616/thumb.webp') = 1,
        format('pruned=%s', v_n));
    insert into __results values ('service: prune keeps previews of referenced blobs',
        (select count(*) from public.entry_derivatives
          where storage_key in (v_ws::text || '/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png',
                                v_ws::text || '/14141414-1414-4414-8414-141414141414.jpg')) = 2, null);
    perform public.record_derivative(v_ws::text || '/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png', 'thumb', 'skipped',
        null, null, 1600, 1200, 'not_smaller');
    insert into __results values ('service: a re-decision that drops the object queues it',
        (select count(*) from public.blob_deletions where storage_key = v_deriv) = 1, null);
    execute 'reset role';

    -- ------------------------------------------------------------------
    -- Hub post-moderation
    -- ------------------------------------------------------------------
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
    begin
        perform public.report_hub_listing(v_ws, 'spam');
        insert into __results values ('anon: report_hub_listing revoked', false, 'accepted');
    exception when others then
        insert into __results values ('anon: report_hub_listing revoked', true, sqlerrm);
        execute 'set local role anon';
    end;
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
        perform public.report_hub_listing(v_ws, 'spam');
        insert into __results values ('owner: cannot report own listing', false, 'accepted');
    exception when others then
        insert into __results values ('owner: cannot report own listing', sqlerrm like '%own workspace%', sqlerrm);
        execute 'set local role authenticated';
    end;
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', c_other, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.report_hub_listing(v_ws, 'spam from other');
    insert into __results values ('other: hub_listing_reported is true after report',
        public.hub_listing_reported(v_ws) is true, null);
    begin
        perform public.report_hub_listing(v_ws, 'again');
        insert into __results values ('other: duplicate report refused', false, 'accepted');
    exception when others then
        insert into __results values ('other: duplicate report refused', sqlerrm like '%already reported%', sqlerrm);
        execute 'set local role authenticated';
    end;
    execute 'reset role';
    insert into __results values ('other: first report accepted',
        (select count(*) from private.hub_reports r where r.workspace_id = v_ws) = 1, null);

    perform set_config('request.jwt.claims', json_build_object('sub', c_young, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.report_hub_listing(v_ws, 'too new');
    insert into __results values ('young: report accepted but listing still visible',
        (select hidden_at is null from public.hub_publications where source_workspace_id = v_ws), null);
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', c_editor, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.report_hub_listing(v_ws, 'spam from editor');
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', c_viewer, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.report_hub_listing(v_ws, 'spam from viewer');
    execute 'reset role';

    insert into __results values ('auto-hide: three qualified reports hide the listing',
        (select hidden_at is not null and hidden_reason = 'reports'
           from public.hub_publications where source_workspace_id = v_ws), null);
    insert into __results values ('auto-hide: listing_hidden mail queued',
        (select count(*) from public.moderation_mail m
          where m.workspace_id = v_ws and m.kind = 'listing_hidden') = 1, null);

    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
    insert into __results values ('anon: hidden hub row invisible',
        (select count(*) from public.hub_publications where source_workspace_id = v_ws) = 0, null);
    insert into __results values ('anon: list_hub_publications omits hidden',
        (select count(*) from public.list_hub_publications() p where p.workspace_id = v_ws) = 0, null);
    -- the cover is served by GET /hub-preview through this reader: a hidden
    -- card must stop resolving for whoever saved the key, not only disappear
    -- from the gallery
    insert into __results values ('anon: hub_preview_target refuses a hidden listing',
        (select count(*) from public.hub_preview_target(v_hub_key)) = 0, null);
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into __results values ('owner: hidden hub row still readable',
        (select count(*) from public.hub_publications where source_workspace_id = v_ws and hidden_at is not null) = 1, null);
    insert into __results values ('owner: hub_preview_target still resolves their hidden cover',
        (select count(*) from public.hub_preview_target(v_hub_key) t where t.owner_id = c_owner) = 1, null);
    begin
        perform public.moderate_hub_listing(v_ws, 'unhide', null);
        insert into __results values ('owner: moderate_hub_listing refused', false, 'accepted');
    exception when others then
        insert into __results values ('owner: moderate_hub_listing refused', sqlerrm like '%not an admin%', sqlerrm);
        execute 'set local role authenticated';
    end;
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.moderate_hub_listing(v_ws, 'unhide', null);
    insert into __results values ('admin: unhide clears hidden_at',
        (select hidden_at is null from public.hub_publications where source_workspace_id = v_ws), null);
    execute 'reset role';

    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
    insert into __results values ('anon: listing visible after unhide',
        (select count(*) from public.list_hub_publications() p where p.workspace_id = v_ws) = 1, null);
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.remove_from_hub(v_ws);
    perform public.set_hub_listing(v_ws, 'suite', array['rls'], true, v_hub_key);
    execute 'reset role';
    insert into __results values ('re-list: old qualified reports auto-hide again',
        (select hidden_reason = 'reports' from public.hub_publications where source_workspace_id = v_ws), null);

    perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.moderate_hub_listing(v_ws, 'make_private', 'illegal content in the suite');
    execute 'reset role';
    insert into __results values ('admin: make_private clears the public slug',
        (select is_public is not true and slug is null from public.workspaces where id = v_ws), null);
    insert into __results values ('admin: make_private drops the Hub row',
        (select count(*) from public.hub_publications where source_workspace_id = v_ws) = 0, null);
    insert into __results values ('admin: listing_made_private mail queued',
        (select count(*) from public.moderation_mail m
          where m.workspace_id = v_ws and m.kind = 'listing_made_private') = 1, null);

    execute 'set local role service_role';
    insert into __results values ('service: moderation_digest_payload is json',
        jsonb_typeof(public.moderation_digest_payload()) = 'object', null);
    execute 'reset role';

    -- ------------------------------------------------------------------
    -- row fences (abuse caps, not the byte quota)
    -- ------------------------------------------------------------------
    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
        insert into public.folder_strokes (id, entry_id, workspace_id, z, position, points,
                                           color, stroke_width, width, height)
        values (gen_random_uuid(), v_folder, v_ws, 1, '{"x":0,"y":0}',
                jsonb_build_array(repeat('x', 33000)), '#000', 1, 1, 1);
        insert into __results values ('limits: stroke points 32 KiB cap', false, 'accepted');
    exception when others then
        insert into __results values ('limits: stroke points 32 KiB cap',
            sqlerrm like '%32768 bytes points limit%', sqlerrm);
        execute 'set local role authenticated';
    end;
    begin
        insert into public.folder_strokes (id, entry_id, workspace_id, z, position, points,
                                           color, stroke_width, width, height)
        values (gen_random_uuid(), v_folder, v_ws, 1,
                jsonb_build_object('x', 0, 'y', 0, 'blob', repeat('x', 600)),
                '[]', '#000', 1, 1, 1);
        insert into __results values ('limits: stroke position 512 B cap', false, 'accepted');
    exception when check_violation then
        insert into __results values ('limits: stroke position 512 B cap', true, null);
        execute 'set local role authenticated';
    end;
    begin
        insert into public.folder_strokes (id, entry_id, workspace_id, z, position, points,
                                           color, stroke_width, width, height)
        values (gen_random_uuid(), v_folder, v_ws, 1, '{"x":0,"y":0}', '[]',
                repeat('a', 65), 1, 1, 1);
        insert into __results values ('limits: stroke color 64 cap', false, 'accepted');
    exception when check_violation then
        insert into __results values ('limits: stroke color 64 cap', true, null);
        execute 'set local role authenticated';
    end;
    begin
        insert into public.folder_strokes (id, entry_id, workspace_id, z, position, points,
                                           color, stroke_width, width, height, updated_by_client)
        values (gen_random_uuid(), v_folder, v_ws, 1, '{"x":0,"y":0}', '[]', '#000', 1, 1, 1,
                repeat('x', 65));
        insert into __results values ('limits: stroke updated_by_client 64 cap', false, 'accepted');
    exception when check_violation then
        insert into __results values ('limits: stroke updated_by_client 64 cap', true, null);
        execute 'set local role authenticated';
    end;
    begin
        insert into public.folder_connections (id, entry_id, workspace_id, from_entry, to_entry, props)
        values (repeat('a', 2049), v_folder, v_ws, v_folder, v_file, '{}');
        insert into __results values ('limits: connection id 2048 cap', false, 'accepted');
    exception when check_violation then
        insert into __results values ('limits: connection id 2048 cap', true, null);
        execute 'set local role authenticated';
    end;
    begin
        insert into public.folder_connections (id, entry_id, workspace_id, from_entry, to_entry, props)
        values ('fat-props', v_folder, v_ws, v_folder, v_file,
                jsonb_build_object('blob', repeat('x', 9000)));
        insert into __results values ('limits: connection props 8 KiB cap', false, 'accepted');
    exception when check_violation then
        insert into __results values ('limits: connection props 8 KiB cap', true, null);
        execute 'set local role authenticated';
    end;
    begin
        insert into public.folder_connections (id, entry_id, workspace_id, from_entry, to_entry, props)
        values ('fat-label', v_folder, v_ws, v_folder, v_file,
                jsonb_build_object('label', repeat('x', 501)));
        insert into __results values ('limits: connection label 500 cap', false, 'accepted');
    exception when check_violation then
        insert into __results values ('limits: connection label 500 cap', true, null);
        execute 'set local role authenticated';
    end;
    begin
        insert into public.entries (workspace_id, parent_id, name, kind, updated_by_client)
        values (v_ws, v_root, 'fat-client', 'folder', repeat('x', 65));
        insert into __results values ('limits: entries updated_by_client 64 cap', false, 'accepted');
    exception when check_violation then
        insert into __results values ('limits: entries updated_by_client 64 cap', true, null);
        execute 'set local role authenticated';
    end;
    begin
        insert into public.quota_wall_events (owner_id, kind, file_mime)
        values (c_owner, 'quota', repeat('m', 256));
        insert into __results values ('limits: quota_wall file_mime 255 cap', false, 'accepted');
    exception when check_violation then
        insert into __results values ('limits: quota_wall file_mime 255 cap', true, null);
        execute 'set local role authenticated';
    end;
    begin
        insert into public.bridge_events (owner_id, step, door, source_type, largest_file_mime)
        values (c_owner, 'opened', 'list', 'browser', repeat('m', 256));
        insert into __results values ('limits: bridge_events file_mime 255 cap', false, 'accepted');
    exception when check_violation then
        insert into __results values ('limits: bridge_events file_mime 255 cap', true, null);
        execute 'set local role authenticated';
    end;
    begin
        insert into public.bridge_events (owner_id, step, door, source_type, bytes_by_kind)
        values (c_owner, 'opened', 'list', 'browser', jsonb_build_object('blob', repeat('x', 5000)));
        insert into __results values ('limits: bridge_events bytes_by_kind 4 KiB cap', false, 'accepted');
    exception when check_violation then
        insert into __results values ('limits: bridge_events bytes_by_kind 4 KiB cap', true, null);
        execute 'set local role authenticated';
    end;
    execute 'reset role';

    update public.billing_accounts
       set max_entries = (select count(*) from public.entries e join public.workspaces w on w.id = e.workspace_id where w.owner_id = c_owner)
     where owner_id = c_owner;
    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
        insert into public.entries (workspace_id, parent_id, name, kind) values (v_ws, v_root, 'over-limit', 'folder');
        insert into __results values ('limits: max_entries on direct insert', false, 'accepted');
    exception when others then
        insert into __results values ('limits: max_entries on direct insert', sqlerrm like '%entries_limit_exceeded%', sqlerrm);
        execute 'set local role authenticated';
    end;
    begin
        v_json := public.create_text_file(v_root, 'over.md', 'text/markdown', 'x', null, null);
        insert into __results values ('limits: max_entries in create_text_file', false, 'accepted');
    exception when others then
        insert into __results values ('limits: max_entries in create_text_file', sqlerrm like '%entries_limit_exceeded%', sqlerrm);
        execute 'set local role authenticated';
    end;
    begin
        perform public.create_workspace('over-limit-board', null);
        insert into __results values ('limits: max_entries in create_workspace', false, 'accepted');
    exception when others then
        insert into __results values ('limits: max_entries in create_workspace', sqlerrm like '%entries_limit_exceeded%', sqlerrm);
        execute 'set local role authenticated';
    end;
    execute 'reset role';

    update public.billing_accounts
       set max_strokes = (select count(*) from public.folder_strokes s
                            join public.workspaces w on w.id = s.workspace_id
                           where w.owner_id = c_owner)
     where owner_id = c_owner;
    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
        insert into public.folder_strokes (id, entry_id, workspace_id, z, position, points,
                                           color, stroke_width, width, height)
        values (gen_random_uuid(), v_folder, v_ws, 1, '{"x":0,"y":0}', '[]', '#000', 1, 1, 1);
        insert into __results values ('limits: max_strokes on insert', false, 'accepted');
    exception when others then
        insert into __results values ('limits: max_strokes on insert', sqlerrm like '%strokes_limit_exceeded%', sqlerrm);
        execute 'set local role authenticated';
    end;
    execute 'reset role';

    update public.billing_accounts
       set max_connections = (select count(*) from public.folder_connections c
                                join public.workspaces w on w.id = c.workspace_id
                               where w.owner_id = c_owner)
     where owner_id = c_owner;
    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
        insert into public.folder_connections (id, entry_id, workspace_id, from_entry, to_entry)
        values ('over-limit-edge', v_folder, v_ws, v_folder, v_file);
        insert into __results values ('limits: max_connections on insert', false, 'accepted');
    exception when others then
        insert into __results values ('limits: max_connections on insert', sqlerrm like '%connections_limit_exceeded%', sqlerrm);
        execute 'set local role authenticated';
    end;
    execute 'reset role';

    update public.billing_accounts
       set max_desktops = (select count(*) from public.desktops d where d.owner_id = c_owner)
     where owner_id = c_owner;
    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
        insert into public.desktops (name) values ('over-limit-desk');
        insert into __results values ('limits: max_desktops on insert', false, 'accepted');
    exception when others then
        insert into __results values ('limits: max_desktops on insert', sqlerrm like '%desktops_limit_exceeded%', sqlerrm);
        execute 'set local role authenticated';
    end;
    execute 'reset role';

    update public.billing_accounts b
       set max_entries = d.max_entries,
           max_strokes = d.max_strokes,
           max_connections = d.max_connections,
           max_desktops = d.max_desktops
      from private.plan_defaults('free') d
     where b.owner_id = c_owner;

    -- ------------------------------------------------------------------
    -- Upload tickets: ownership, request binding and atomic idempotency. No B2
    -- is needed here: only the service role can assert the final object size.
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role service_role';
    v_upload := public.register_upload(v_ws, c_owner, 'blob', '.png', 3600);
    v_request := jsonb_build_object('id', gen_random_uuid(), 'parent_id', v_root,
        'name', 'ticket-file.png', 'mime', 'image/png', 'client_id', null);
    insert into __results values ('upload: staging key is server-issued',
        v_upload like 'uploads/blob/' || v_ws::text || '/%', null);
    begin
        perform public.prepare_upload(v_upload, c_other, 'blob', v_request);
        insert into __results values ('upload: another account cannot consume ticket', false, 'accepted');
    exception when others then
        insert into __results values ('upload: another account cannot consume ticket', sqlerrm like '%ticket not found%', sqlerrm);
    end;
    perform public.prepare_upload(v_upload, c_owner, 'blob', v_request);
    v_gc_a := v_ws::text || '/' || gen_random_uuid()::text || '.png';
    v_gc_b := v_ws::text || '/' || gen_random_uuid()::text || '.png';
    v_receipt := public.complete_upload(v_upload, c_owner, 'blob', v_request, v_gc_a, 4);
    insert into __results values ('upload: retry returns first result, not a second entry',
        public.complete_upload(v_upload, c_owner, 'blob', v_request, v_gc_b, 8) = v_receipt
        and (select count(*) from public.entries where storage_key in (v_gc_a, v_gc_b)) = 1,
        v_receipt::text);
    begin
        perform public.prepare_upload(v_upload, c_owner, 'blob', v_request || '{"name":"changed.png"}'::jsonb);
        insert into __results values ('upload: mismatched retry refused', false, 'accepted');
    exception when others then
        insert into __results values ('upload: mismatched retry refused', sqlerrm like '%upload_conflict%', sqlerrm);
    end;
    begin
        perform public.prepare_upload(v_gc_a, c_owner, 'blob', v_request);
        insert into __results values ('upload: existing blob cannot be a ticket', false, 'accepted');
    exception when others then
        insert into __results values ('upload: existing blob cannot be a ticket', sqlerrm like '%ticket not found%', sqlerrm);
    end;
    v_upload := public.register_upload(v_ws, c_owner, 'hub_preview', '.png', 3600);
    v_gc_a := 'hub/' || v_ws::text || '/' || gen_random_uuid()::text || '.png';
    v_receipt := public.complete_upload(v_upload, c_owner, 'hub_preview', '{}'::jsonb, v_gc_a, 4);
    insert into __results values ('upload: Hub returns immutable key and retries idempotently',
        v_receipt->>'storage_key' = v_gc_a and public.prepare_upload(v_upload, c_owner, 'hub_preview', '{}'::jsonb)->'result' = v_receipt, null);
    execute 'reset role';

    -- A thousand copies of one object cannot hide another object's reference.
    v_gc_a := v_ws::text || '/' || gen_random_uuid()::text || '.bin';
    v_gc_b := v_ws::text || '/' || gen_random_uuid()::text || '.bin';
    insert into public.entries (workspace_id, parent_id, name, kind, mime, storage_key, size_bytes)
    select v_ws, v_root, 'gc-reference-' || n, 'file', 'application/octet-stream',
           case when n <= 1000 then v_gc_a else v_gc_b end, 1
    from generate_series(1, 1001) n;
    execute 'set local role service_role';
    insert into __results values ('gc: all key answers survive more than 1000 references',
        public.blob_references(array[v_gc_a, v_gc_b, 'missing']) =
            jsonb_build_object(v_gc_a, true, v_gc_b, true, 'missing', false), null);
    execute 'reset role';

    -- ------------------------------------------------------------------
    -- desktops experiment: the opt-in mark and the admin-only report
    -- ------------------------------------------------------------------
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
    begin
        perform public.mark_desktops_opt_in();
        insert into __results values ('anon: mark_desktops_opt_in revoked', false, 'accepted');
    exception when others then
        insert into __results values ('anon: mark_desktops_opt_in revoked', true, sqlerrm);
        execute 'set local role anon';
    end;
    execute 'reset role';

    perform set_config('request.jwt.claims', json_build_object('sub', c_owner, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.mark_desktops_opt_in();
    perform public.mark_desktops_opt_in();
    begin
        perform * from public.desktops_experiment_report();
        insert into __results values ('owner: desktops_experiment_report refused', false, 'accepted');
    exception when others then
        insert into __results values ('owner: desktops_experiment_report refused',
            sqlerrm like '%not an admin%', sqlerrm);
        execute 'set local role authenticated';
    end;
    execute 'reset role';
    insert into __results values ('owner: opt-in mark is one row, however often it is sent',
        (select count(*) from private.desktops_opt_ins where user_id = c_owner) = 1, null);

    perform set_config('request.jwt.claims', json_build_object('sub', c_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into __results values ('admin: desktops_experiment_report counts the opt-in',
        (select r.opted_in_users >= 1 from public.desktops_experiment_report() r), null);
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);

    -- Function grants. EXECUTE defaults to PUBLIC on every new function, and
    -- `drop function` + `create` RESETS it — several functions in rpc.sql are
    -- recreated that way, so a backend-only path can reopen to anon without
    -- anyone touching its body. Assert the shape instead of trusting review.
    -- to_regprocedure keeps a renamed signature from aborting the suite:
    -- it comes back as a failed row saying so
    -- ------------------------------------------------------------------
    for v_grant in
        select *
          from (values
            -- backend-only: callable by neither anon nor authenticated
            -- grants membership to an arbitrary user id for an arbitrary email;
            -- only handle_new_user should reach this overload
            ('private.claim_workspace_invites(uuid, text)', false, false),
            ('private.handle_new_user()', false, false),
            ('private.lock_workspace_tree(uuid)', false, false),
            ('private.lock_entry_workspace(uuid)', false, false),
            ('private.purge_expired_entries()', false, false),
            ('public.entries_tree_lock()', false, false),
            ('public.desktops_count_guard()', false, false),
            ('private.blob_references(text[])', false, false),
            ('public.blob_references(text[])', false, false),
            ('private.assert_upload_access(uuid, uuid, text)', false, false),
            ('private.register_upload(uuid, uuid, text, text, int)', false, false),
            ('public.register_upload(uuid, uuid, text, text, int)', false, false),
            ('private.prepare_upload(text, uuid, text, jsonb)', false, false),
            ('public.prepare_upload(text, uuid, text, jsonb)', false, false),
            ('private.complete_upload(text, uuid, text, jsonb, text, bigint)', false, false),
            ('public.complete_upload(text, uuid, text, jsonb, text, bigint)', false, false),
            -- trust the backend's word on a user id, an object size or a key
            ('private.create_blob_entry(uuid, uuid, uuid, text, text, text, bigint, uuid, text)', false, false),
            ('public.create_blob_entry(uuid, uuid, uuid, text, text, text, bigint, uuid, text)', false, false),
            ('private.replace_blob_entry(uuid, uuid, text, bigint, text, uuid, text)', false, false),
            ('public.replace_blob_entry(uuid, uuid, text, bigint, text, uuid, text)', false, false),
            ('private.record_hub_preview_upload(text, bigint, uuid)', false, false),
            ('public.record_hub_preview_upload(text, bigint, uuid)', false, false),
            -- list blob keys of an arbitrary subtree with no access check inside
            ('private.list_subtree_files(uuid)', false, false),
            ('public.list_subtree_files(uuid)', false, false),
            ('private.list_foreign_blob_entries(int)', false, false),
            ('public.list_foreign_blob_entries(int)', false, false),
            -- the meters and the preview worker write on the backend's word
            ('private.egress_sync(date, jsonb)', false, false),
            ('public.egress_sync(date, jsonb)', false, false),
            ('private.download_sync(date, jsonb)', false, false),
            ('public.download_sync(date, jsonb)', false, false),
            ('private.record_derivative(text, text, text, text, bigint, int, int, text)', false, false),
            ('public.record_derivative(text, text, text, text, bigint, int, int, text)', false, false),
            ('private.fail_derivative(text, text, text, int)', false, false),
            ('public.fail_derivative(text, text, text, int)', false, false),
            ('private.prune_entry_derivatives(int)', false, false),
            ('public.prune_entry_derivatives(int)', false, false),
            ('private.list_pending_derivatives(text[], int, int)', false, false),
            ('public.list_pending_derivatives(text[], int, int)', false, false),
            ('public.moderation_digest_payload()', false, false),
            ('public.mark_moderation_digest_sent()', false, false),

            -- the other half: a revoke sweep must not break public boards or
            -- the predicates the RLS policies themselves evaluate
            ('private.readable_workspace_ids()', true, true),
            ('private.writable_workspace_ids()', true, true),
            ('private.can_read_workspace(uuid)', true, true),
            ('private.can_write_workspace(uuid)', true, true),
            ('private.folder_read(uuid, text)', true, true),
            ('public.folder_read(uuid, text)', true, true),
            ('private.download_target(uuid)', true, true),
            ('public.download_target(uuid)', true, true),
            ('private.hub_preview_target(text)', true, true),
            ('public.hub_preview_target(text)', true, true),
            ('public.preview_workspace_invite(text)', true, true),
            ('public.list_hub_publications(text, text, int, int)', true, true),

            -- signed-in only
            ('private.add_workspace_member(uuid, text, text)', false, true),
            ('public.add_workspace_member(uuid, text, text)', false, true),
            ('private.plan_defaults(text)', false, true),
            ('public.plan_limits(text)', false, true),
            ('private.claim_workspace_invites()', false, true),
            ('public.claim_workspace_invites()', false, true),
            ('public.merge_entry_xattrs(uuid, jsonb, text)', false, true),
            ('public.report_hub_listing(uuid, text)', false, true),
            ('public.mark_desktops_opt_in()', false, true),
            ('private.mark_desktops_opt_in()', false, true),
            ('public.desktops_experiment_report()', false, true),
            ('private.desktops_experiment_report()', false, true),
            ('public.owner_usage()', false, true)
          ) as g(signature, anon_may, authenticated_may)
    loop
        if to_regprocedure(v_grant.signature) is null then
            insert into __results values (
                format('grants: %s', v_grant.signature), false, 'no such function — signature drifted');
        else
            insert into __results values (
                format('grants: %s → anon=%s authenticated=%s',
                       v_grant.signature, v_grant.anon_may, v_grant.authenticated_may),
                has_function_privilege('anon', v_grant.signature, 'execute') = v_grant.anon_may
                and has_function_privilege('authenticated', v_grant.signature, 'execute') = v_grant.authenticated_may,
                format('actual anon=%s authenticated=%s',
                       has_function_privilege('anon', v_grant.signature, 'execute'),
                       has_function_privilege('authenticated', v_grant.signature, 'execute')));
        end if;
    end loop;
end $$;

select step, ok, detail from __results order by ok, step;
select count(*) filter (where not ok) as failed, count(*) as total from __results;

rollback;
