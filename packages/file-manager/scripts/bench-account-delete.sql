-- How long does deleting the largest account take?
--
-- An account goes in one statement: the backend asks Supabase Auth to delete
-- the user, and the cascades (auth.users → workspaces → entries, their text,
-- ink and edges) and the blob queue triggers run inside it. Auth's database
-- role has no statement timeout of its own, so the limit is the project's
-- default (2 min on 2026-11-25); a statement that hits it rolls back and the
-- account stays.
--
-- This builds one account at the ceilings of the paid plans (200k entries in
-- four folders, three quarters of them blobs, 100k strokes, 100k edges),
-- deletes it and rolls everything back. Run it on a throwaway database with
-- schema.sql and rpc.sql applied — the one postgres.test.ts uses:
--
--   psql "postgres://postgres@127.0.0.1:56623/pile_security_test" -f scripts/bench-account-delete.sql
--
-- Read the time under "DELETE 1". Measured 2026-11-25 on an M-series Mac,
-- PostgreSQL 18: 4.8 s. Rerun after a change to the entry triggers or to
-- the plan ceilings, and on a restore of a production dump before raising
-- them. If it nears a minute, delete the account's folders one statement at
-- a time before the user (purge_workspace does one folder).
\set ON_ERROR_STOP on
do $$
begin
    if current_database() <> 'pile_security_test' then
        raise exception 'bench-account-delete: refusing to run on %', current_database();
    end if;
end $$;
set search_path = public, extensions;
begin;
-- one account at the paid plans' ceilings: 200k entries, 100k strokes, 100k edges, in 4 folders
insert into auth.users(id, email) values ('99999999-9999-4999-8999-999999999999', 'big@example.invalid');
set session_replication_role = replica;
insert into public.workspaces(id, owner_id, name)
select ('00000000-0000-4000-8000-00000000000' || w)::uuid, '99999999-9999-4999-8999-999999999999', 'big' || w
  from generate_series(1, 4) w;
-- roots
insert into public.entries(id, workspace_id, parent_id, name, kind, path, node_path)
select gen_random_uuid(), w.id, null, '', 'folder', '/', 'x'::ltree from public.workspaces w where w.name like 'big%';
update public.entries set node_path = replace(id::text, '-', '')::ltree where path = '/' and workspace_id in (select id from public.workspaces where name like 'big%');
-- 100 folders per workspace
with made as materialized (
    select gen_random_uuid() as id, r.id as parent, r.workspace_id, r.node_path, n
      from public.entries r, generate_series(1, 100) n
     where r.path = '/' and r.workspace_id in (select id from public.workspaces where name like 'big%')
)
insert into public.entries(id, workspace_id, parent_id, name, kind, path, node_path)
select m.id, m.workspace_id, m.parent, 'f' || m.n, 'folder', '/f' || m.n, m.node_path || replace(m.id::text, '-', '')::ltree
  from made m;
-- ~500 files per folder: 3 of 4 are blobs, the rest text
with made as materialized (
    select gen_random_uuid() as id, d.id as parent, d.workspace_id, d.node_path, d.path, n
      from public.entries d, generate_series(1, 499) n
     where d.path like '/f%' and d.kind = 'folder' and d.workspace_id in (select id from public.workspaces where name like 'big%')
)
insert into public.entries(id, workspace_id, parent_id, name, kind, mime, path, node_path, storage_key, size_bytes)
select m.id, m.workspace_id, m.parent, 'file' || m.n, 'file',
       case when m.n % 4 = 0 then 'text/markdown' else 'image/png' end,
       m.path || '/file' || m.n, m.node_path || replace(m.id::text, '-', '')::ltree,
       case when m.n % 4 = 0 then null else 'blob/' || m.workspace_id || '/' || m.id end, 1000
  from made m;
insert into public.entry_contents(entry_id, workspace_id, content)
select e.id, e.workspace_id, repeat('note ', 100) from public.entries e
 where e.mime = 'text/markdown' and e.workspace_id in (select id from public.workspaces where name like 'big%');
insert into public.folder_strokes(id, entry_id, workspace_id, z, position, points, color, stroke_width, width, height)
select gen_random_uuid(), d.id, d.workspace_id, n, '{"x":0,"y":0}', '[[0,0],[1,1],[2,2],[3,3]]', '#000', 2, 10, 10
  from public.entries d, generate_series(1, 250) n
 where d.path like '/f%' and d.kind = 'folder' and d.workspace_id in (select id from public.workspaces where name like 'big%');
insert into public.folder_connections(id, entry_id, workspace_id, from_entry, to_entry)
select 'c' || row_number() over (), a.parent_id, a.workspace_id, a.id, b.id
  from (select e.*, row_number() over (partition by parent_id order by id) rn from public.entries e where e.kind = 'file' and e.workspace_id in (select id from public.workspaces where name like 'big%')) a
  join (select e.*, row_number() over (partition by parent_id order by id) rn from public.entries e where e.kind = 'file' and e.workspace_id in (select id from public.workspaces where name like 'big%')) b
    on b.parent_id = a.parent_id and b.rn = a.rn + 1
 where a.rn <= 250;
set session_replication_role = origin;
analyze public.entries; analyze public.entry_contents; analyze public.folder_strokes; analyze public.folder_connections;
select (select count(*) from public.entries) entries, (select count(*) from public.entry_contents) contents,
       (select count(*) from public.folder_strokes) strokes, (select count(*) from public.folder_connections) edges;
\timing on
delete from auth.users where id = '99999999-9999-4999-8999-999999999999';
select (select count(*) from public.entries where workspace_id in ('00000000-0000-4000-8000-000000000001')) left_entries, (select count(*) from public.blob_deletions) queued;
rollback;
