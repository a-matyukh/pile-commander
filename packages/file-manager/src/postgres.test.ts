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

	test("replace_blob_entry does not deadlock with a text save of the same row", async () => {
		const f = await fixture()
		const key = `${f.workspace}/${crypto.randomUUID()}.png`
		const a = await db.reserve()
		const b = await db.reserve()
		try {
			// The save's billing lock, taken before it asks for KEY SHARE on the
			// entry. Same lock assert_owner_can_add takes from entry_contents_guard.
			await a.unsafe("begin; set local search_path = public, extensions; set local statement_timeout = '8s'; set local deadlock_timeout = '1s'").simple()
			await a`select private.assert_owner_can_add(${f.owner}::uuid, 1, null)`
			await b.unsafe("begin; set local search_path = public, extensions; set local statement_timeout = '8s'; set local deadlock_timeout = '1s'").simple()
			const [{ pid }] = await b`select pg_backend_pid() as pid`
			const replaced = b`select private.replace_blob_entry(${f.file}::uuid, ${f.workspace}::uuid, ${key}, 20, 'image/png', ${f.owner}::uuid, null)`.then(() => null, (error: Error) => error)
			expect(await is_waiting_for_lock(pid)).toBe(true)
			await a.unsafe("set local role authenticated").simple()
			await a`select set_config('request.jwt.claims', ${JSON.stringify({ sub: f.owner, role: "authenticated" })}, true)`
			await a`insert into public.entry_contents(entry_id, workspace_id, content)
				values (${f.file}::uuid, ${f.workspace}::uuid, 'a longer note')
				on conflict (entry_id) do update set content = excluded.content, workspace_id = excluded.workspace_id`
			await a.unsafe("commit").simple()
			const error = await replaced
			if (error) throw error
			await b.unsafe("commit").simple()
			const [row] = await db`select id::text, storage_key from public.entries where id = ${f.file}::uuid`
			expect(row.id).toBe(f.file)
			expect(row.storage_key).toBe(key)
		} finally {
			await a.unsafe("rollback").simple()
			await b.unsafe("rollback").simple()
			a.release()
			b.release()
		}
	}, 15_000)

	function blob_key(workspace: string): string {
		return `${workspace}/${crypto.randomUUID()}.png`
	}

	async function with_owner(run: (tx: SQL, ctx: { owner: string; workspace: string; root: string }) => Promise<void>) {
		await db.begin(async (tx) => {
			const owner = crypto.randomUUID()
			await tx`insert into auth.users(id, email) values (${owner}::uuid, ${`${owner}@example.invalid`})`
			await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: owner, role: "authenticated" })}, true)`
			const [ws] = await tx`select public.create_workspace('replace') as id`
			const [root] = await tx`select id from public.entries where workspace_id = ${ws.id}::uuid and parent_id is null`
			await run(tx, { owner, workspace: ws.id as string, root: root.id as string })
		})
	}

	function row_of(value: unknown): Record<string, unknown> {
		return (typeof value === "string" ? JSON.parse(value) : value) as Record<string, unknown>
	}

	/** A refused statement aborts the transaction; roll it back to a savepoint. */
	async function refused(tx: SQL, run: () => Promise<unknown>, pattern: RegExp) {
		await tx`savepoint replace_case`
		try {
			await run()
			throw new Error("accepted")
		} catch (error) {
			await tx`rollback to savepoint replace_case`
			expect(error instanceof Error ? error.message : String(error)).toMatch(pattern)
		}
	}

	test("replace_blob_entry charges the size delta, not the whole file", async () => {
		await with_owner(async (tx, { owner, workspace, root }) => {
			const key = blob_key(workspace)
			const [created] = await tx`select private.create_blob_entry(null, ${workspace}::uuid, ${root}::uuid, 'a.png', 'image/png', ${key}, 1000, ${owner}::uuid, null) as entry`
			const entry = row_of(created.entry)
			const [usage] = await tx`select used_bytes from private.owner_usage(${owner}::uuid)`
			await tx`update public.billing_accounts set quota_bytes = ${usage.used_bytes} where owner_id = ${owner}::uuid`
			const next = blob_key(workspace)
			const [replaced] = await tx`select private.replace_blob_entry(${entry.id}::uuid, ${workspace}::uuid, ${next}, 1000, 'image/png', ${owner}::uuid, null) as entry`
			expect(row_of(replaced.entry).id).toBe(entry.id)
			await refused(tx, () => tx`select private.create_blob_entry(null, ${workspace}::uuid, ${root}::uuid, 'b.png', 'image/png', ${blob_key(workspace)}, 1000, ${owner}::uuid, null)`, /quota_exceeded/)
			await refused(tx, () => tx`select private.replace_blob_entry(${entry.id}::uuid, ${workspace}::uuid, ${blob_key(workspace)}, 1001, 'image/png', ${owner}::uuid, null)`, /quota_exceeded/)
		})
	})

	test("replace_blob_entry refuses a viewer, a trashed row and an empty mime", async () => {
		await with_owner(async (tx, { owner, workspace, root }) => {
			const viewer = crypto.randomUUID()
			await tx`insert into auth.users(id, email) values (${viewer}::uuid, ${`${viewer}@example.invalid`})`
			await tx`insert into public.workspace_members(workspace_id, user_id, role) values (${workspace}::uuid, ${viewer}::uuid, 'viewer')`
			const key = blob_key(workspace)
			const [created] = await tx`select private.create_blob_entry(null, ${workspace}::uuid, ${root}::uuid, 'a.png', 'image/png', ${key}, 10, ${owner}::uuid, null) as entry`
			const entry = row_of(created.entry)
			await refused(tx, () => tx`select private.replace_blob_entry(${entry.id}::uuid, ${workspace}::uuid, ${blob_key(workspace)}, 10, 'image/png', ${viewer}::uuid, null)`, /access denied/)
			await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: owner, role: "authenticated" })}, true)`
			await tx`select public.delete_entry(${entry.id}::uuid, null)`
			await refused(tx, () => tx`select private.replace_blob_entry(${entry.id}::uuid, ${workspace}::uuid, ${blob_key(workspace)}, 10, 'image/png', ${owner}::uuid, null)`, /not found/)
			await refused(tx, () => tx`select private.replace_blob_entry(${entry.id}::uuid, ${workspace}::uuid, ${blob_key(workspace)}, 10, '', ${owner}::uuid, null)`, /mime is required/)
		})
	})

	test("replace_blob_entry turns text into a blob and moves content_modified_at", async () => {
		await with_owner(async (tx, { owner, workspace, root }) => {
			await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: owner, role: "authenticated" })}, true)`
			const [made] = await tx`select public.create_text_file(${root}::uuid, 'note.md', 'text/markdown', 'hello', null, null) as entry`
			const text = row_of(made.entry)
			await tx`update public.entries set content_modified_at = now() - interval '2 days' where id = ${text.id}::uuid`
			const [before] = await tx`select content_modified_at from public.entries where id = ${text.id}::uuid`
			const key = blob_key(workspace)
			const [replaced] = await tx`select private.replace_blob_entry(${text.id}::uuid, ${workspace}::uuid, ${key}, 5, 'application/octet-stream', ${owner}::uuid, 'device') as entry`
			const after = row_of(replaced.entry)
			expect(after.id).toBe(text.id)
			expect(after.storage_key).toBe(key)
			const [contents] = await tx`select count(*)::int as n from public.entry_contents where entry_id = ${text.id}::uuid`
			expect(contents.n).toBe(0)
			const [stamp] = await tx`select content_modified_at from public.entries where id = ${text.id}::uuid`
			expect(new Date(stamp.content_modified_at as string).getTime()).toBeGreaterThan(new Date(before.content_modified_at as string).getTime())
			const [queued] = await tx`select count(*)::int as n from public.blob_deletions where storage_key = ${key}`
			expect(queued.n).toBe(0)
		})
	})

	test("replace_blob_entry enqueues the old key unless another row still holds it", async () => {
		await with_owner(async (tx, { owner, workspace, root }) => {
			const shared = blob_key(workspace)
			const [first] = await tx`select private.create_blob_entry(null, ${workspace}::uuid, ${root}::uuid, 'a.png', 'image/png', ${shared}, 10, ${owner}::uuid, null) as entry`
			const id = row_of(first.entry).id as string
			const [second] = await tx`select private.create_blob_entry(null, ${workspace}::uuid, ${root}::uuid, 'b.png', 'image/png', ${shared}, 10, ${owner}::uuid, null) as entry`
			const kept = row_of(second.entry).id as string
			const next = blob_key(workspace)
			await tx`update public.entries set content_modified_at = now() - interval '2 days' where id = ${id}::uuid`
			const [before] = await tx`select content_modified_at from public.entries where id = ${id}::uuid`
			const [replaced] = await tx`select private.replace_blob_entry(${id}::uuid, ${workspace}::uuid, ${next}, 12, 'image/png', ${owner}::uuid, null) as entry`
			expect(row_of(replaced.entry).id).toBe(id)
			const [stamp] = await tx`select content_modified_at from public.entries where id = ${id}::uuid`
			expect(new Date(stamp.content_modified_at as string).getTime()).toBeGreaterThan(new Date(before.content_modified_at as string).getTime())
			const [queued] = await tx`select count(*)::int as n from public.blob_deletions where storage_key = ${shared}`
			expect(queued.n).toBe(1)
			const [refs] = await tx`select public.blob_references(array[${shared}]::text[]) as refs`
			const referenced = typeof refs.refs === "string" ? JSON.parse(refs.refs) as Record<string, boolean> : refs.refs as Record<string, boolean>
			expect(referenced[shared]).toBe(true)
			const [still] = await tx`select storage_key from public.entries where id = ${kept}::uuid`
			expect(still.storage_key).toBe(shared)
			const [same] = await tx`select private.replace_blob_entry(${id}::uuid, ${workspace}::uuid, ${next}, 12, 'image/png', ${owner}::uuid, null) as entry`
			expect(row_of(same.entry).storage_key).toBe(next)
			const [stamp_again] = await tx`select content_modified_at from public.entries where id = ${id}::uuid`
			expect(new Date(stamp_again.content_modified_at as string).getTime()).toBe(new Date(stamp.content_modified_at as string).getTime())
			const [queued_again] = await tx`select count(*)::int as n from public.blob_deletions where storage_key = ${next}`
			expect(queued_again.n).toBe(0)
			const [old_still] = await tx`select count(*)::int as n from public.blob_deletions where storage_key = ${shared}`
			expect(old_still.n).toBe(1)
		})
	})
})
