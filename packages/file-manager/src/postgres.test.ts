import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { SQL } from "bun"

// Opt-in integration suite against a DISPOSABLE PostgreSQL database. No
// Supabase credentials are used. The name guard prevents accidental use on
// an application database; the fixture replaces its public/private schemas.
const database_url = process.env.TEST_DATABASE_URL

describe.skipIf(!database_url)("PostgreSQL security and concurrency", () => {
	let db: SQL
	beforeAll(async () => {
		const url = new URL(database_url!)
		if (url.pathname !== "/pile_security_test") throw new Error("TEST_DATABASE_URL must use the disposable pile_security_test database")
		db = new SQL(database_url!, { max: 6 })
		await db.unsafe(`
			drop schema if exists public cascade;
			drop schema if exists private cascade;
			drop schema if exists auth cascade;
			create schema public;
			create schema auth;
			create schema if not exists extensions;
			create extension if not exists pgcrypto with schema extensions;
			create schema if not exists cron;
			do $$ begin
				if not exists (select from pg_roles where rolname = 'anon') then create role anon; end if;
				if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
				if not exists (select from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
			end $$;
			create table auth.users (
				id uuid primary key, instance_id uuid, aud text, role text, email text,
				encrypted_password text, email_confirmed_at timestamptz,
				raw_app_meta_data jsonb, raw_user_meta_data jsonb,
				created_at timestamptz default now(), updated_at timestamptz default now()
			);
			create function auth.uid() returns uuid language sql stable as $$
				select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
			$$;
			grant usage on schema auth to anon, authenticated, service_role;
			grant usage on schema extensions to anon, authenticated, service_role;
			-- pg_cron is supplied by Supabase. Local PostgreSQL only validates
			-- scheduling calls; the SQL inside each job is retained for assertions.
			create table if not exists cron.jobs (name text primary key, schedule text, command text);
			create or replace function cron.schedule(text, text, text) returns bigint language sql as $$
				insert into cron.jobs values ($1, $2, $3)
				on conflict (name) do update set schedule = $2, command = $3 returning 1::bigint
			$$;
			drop publication if exists supabase_realtime;
			create publication supabase_realtime;
		`).simple()
		const connection = await db.reserve()
		try {
			await connection.unsafe("set search_path = public, extensions").simple()
			const schema = await Bun.file(new URL("./schema.sql", import.meta.url)).text()
			await connection.unsafe(schema.replace("create extension if not exists pg_cron;", "")).simple()
			await connection.unsafe(await Bun.file(new URL("./rpc.sql", import.meta.url)).text()).simple()
		} finally { connection.release() }
	}, 30_000)

	afterAll(async () => { await db?.close() })

	test("real grants, RLS, quotas, uploads and GC regressions", async () => {
		const connection = await db.reserve()
		try {
			await connection.unsafe("set search_path = public, extensions").simple()
			const suite = await Bun.file(new URL("./rls.test.sql", import.meta.url)).text()
			await connection.unsafe(suite.replace(/^rollback;\s*$/m, "")).simple()
			const failures = await connection.unsafe("select * from __results where ok is distinct from true")
			expect(failures).toEqual([])
		} finally {
			await connection.unsafe("rollback").simple()
			connection.release()
		}
	}, 30_000)

	async function fixture() {
		return db.begin(async tx => {
			const owner = crypto.randomUUID()
			await tx`insert into auth.users(id, email) values (${owner}::uuid, ${`${owner}@example.invalid`})`
			await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: owner, role: "authenticated" })}, true)`
			const [ws] = await tx`select public.create_workspace('concurrency') as id`
			const [root] = await tx`select id from public.entries where workspace_id = ${ws.id}::uuid and parent_id is null`
			const [folder] = await tx`insert into public.entries(workspace_id, parent_id, name, kind)
				values (${ws.id}::uuid, ${root.id}::uuid, 'a', 'folder') returning id`
			const [target] = await tx`insert into public.entries(workspace_id, parent_id, name, kind)
				values (${ws.id}::uuid, ${root.id}::uuid, 'target', 'folder') returning id`
			const [file] = await tx`select public.create_text_file(${folder.id}::uuid, 'child.txt', 'text/plain', 'hello') as entry`
			return { owner, workspace: ws.id as string, folder: folder.id as string, target: target.id as string, file: file.entry.id as string }
		})
	}

	async function is_waiting_for_lock(pid: number) {
		for (let i = 0; i < 100; i++) {
			const [row] = await db`select wait_event_type from pg_stat_activity where pid = ${pid}`
			if (row?.wait_event_type === "Lock") return true
			await Bun.sleep(5)
		}
		return false
	}

	for (const operation of ["rename", "insert", "move", "delete-insert"] as const) {
		test(`tree lock: concurrent ${operation} re-reads the committed parent`, async () => {
			const f = await fixture()
			const a = await db.reserve()
			const b = await db.reserve()
			try {
				for (const connection of [a, b]) {
					await connection.unsafe("begin; set local role authenticated; set local search_path = public, extensions; set local statement_timeout = '5s'").simple()
					await connection`select set_config('request.jwt.claims', ${JSON.stringify({ sub: f.owner, role: "authenticated" })}, true)`
				}
				await a`select id from public.workspaces where id = ${f.workspace}::uuid for no key update`
				const [{ pid }] = await b`select pg_backend_pid() as pid`
				const query = operation === "rename"
					? b`select * from public.rename_entry(${f.folder}::uuid, 'other')`
					: operation === "move"
						? b`select * from public.move_entry(${f.folder}::uuid, ${f.target}::uuid)`
						: b`insert into public.entries(workspace_id, parent_id, name, kind)
							values (${f.workspace}::uuid, ${f.folder}::uuid, 'new-child', 'folder') returning path`
				const pending = query.then(() => null, (error: Error) => error)
				expect(await is_waiting_for_lock(pid)).toBe(true)
				if (operation === "delete-insert") await a`select public.delete_entry(${f.folder}::uuid)`
				else await a`select * from public.rename_entry(${f.folder}::uuid, 'long')`
				await a.unsafe("commit").simple()
				const error = await pending
				if (operation === "delete-insert") {
					expect(error?.message).toContain("in the trash")
				} else {
					if (error) throw error
					await b.unsafe("commit").simple()
					const [file] = await db`select path from public.entries where id = ${f.file}::uuid`
					expect(file.path).toBe(operation === "rename" ? "/other/child.txt" : operation === "move" ? "/target/long/child.txt" : "/long/child.txt")
					const broken = await db`select c.id from public.entries c join public.entries p on p.id = c.parent_id
						where c.workspace_id = ${f.workspace}::uuid and c.path <> (case when p.path = '/' then '' else p.path end) || '/' || c.name`
					expect(broken).toEqual([])
				}
			} finally {
				await a.unsafe("rollback").simple()
				await b.unsafe("rollback").simple()
				a.release()
				b.release()
			}
		}, 15_000)
	}

	test("a text upsert does not wait on an unrelated workspace tree lock", async () => {
		const f = await fixture()
		const a = await db.reserve()
		const b = await db.reserve()
		try {
			await a.unsafe("begin").simple()
			await a`select id from public.workspaces where id = ${f.workspace}::uuid for no key update`
			await b.unsafe("begin; set local role authenticated; set local search_path = public, extensions; set local statement_timeout = '2s'").simple()
			await b`select set_config('request.jwt.claims', ${JSON.stringify({ sub: f.owner, role: "authenticated" })}, true)`
			await b`insert into public.entry_contents(entry_id, workspace_id, content)
				values (${f.file}::uuid, ${f.workspace}::uuid, 'a growing note')
				on conflict (entry_id) do update set content = excluded.content, workspace_id = excluded.workspace_id`
			const [row] = await b`select size_bytes from public.entries where id = ${f.file}::uuid`
			expect(Number(row.size_bytes)).toBe(14)
		} finally {
			await a.unsafe("rollback").simple()
			await b.unsafe("rollback").simple()
			a.release()
			b.release()
		}
	})
})
