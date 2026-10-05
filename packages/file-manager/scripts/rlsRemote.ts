// Runs src/rls.test.sql against the real Supabase project in one session and
// prints the rows. The suite makes its own fixtures and ends in ROLLBACK; this
// runner never lets anything it creates be committed.
//
//   bun --filter @pile-commander/file-manager test:rls:remote
//
// Two transports, configured in packages/file-manager/.env (git-ignored):
//
// 1. HTTPS (preferred when set) — SUPABASE_ACCESS_TOKEN: a personal access
//    token (Supabase dashboard → Account → Access Tokens). Goes through the
//    Management API on :443, like the Supabase MCP, so it works on networks
//    that block outbound Postgres ports. The project ref comes from
//    SUPABASE_PROJECT_REF, or is read from SUPABASE_DB_URL. The suite runs as
//    one request; it ends by RAISING an exception that carries the results,
//    which aborts the transaction — a rollback no success path can skip.
//
// 2. Postgres — SUPABASE_DB_URL: the project's connection string (dashboard →
//    Connect → "Session pooler"; the direct db.<ref>.supabase.co host is
//    IPv6-only). Not the transaction pooler on :6543: the suite needs one
//    session for its temp table and role switches.
import { SQL } from "bun"

type Row = { step: string; ok: boolean; detail: string | null }

const SENTINEL = "RLS_RESULTS:"

const suite = await Bun.file(new URL("../src/rls.test.sql", import.meta.url)).text()
const body = suite.replace(/^rollback;\s*$/m, "")
if (body === suite) fail("rls.test.sql no longer ends in `rollback;` — refusing to run it against the project")

function fail(message: string): never {
	console.error(message)
	process.exit(2)
}

function project_ref(): string {
	const explicit = process.env.SUPABASE_PROJECT_REF?.trim()
	if (explicit) return explicit
	const url = process.env.SUPABASE_DB_URL
	if (url) {
		const u = new URL(url)
		const from_host = u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1]
		const from_user = decodeURIComponent(u.username).match(/^postgres\.([a-z0-9]+)$/)?.[1]
		if (from_host ?? from_user) return (from_host ?? from_user)!
	}
	fail("set SUPABASE_PROJECT_REF (or a SUPABASE_DB_URL it can be read from)")
}

async function run_https(token: string): Promise<Row[]> {
	const query = `${body}
do $$
begin
    raise exception '${SENTINEL}%', (
        select coalesce(json_agg(json_build_object('step', step, 'ok', ok, 'detail', detail)), '[]')
          from __results
    );
end $$;`
	const response = await fetch(`https://api.supabase.com/v1/projects/${project_ref()}/database/query`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		body: JSON.stringify({ query }),
	})
	const text = await response.text()
	const message = find_sentinel(text)
	if (message === null) {
		// no sentinel: the suite itself failed (or the API refused the call)
		fail(`the suite did not finish (HTTP ${response.status}): ${text.slice(0, 2000)}`)
	}
	// "…RLS_RESULTS:[…]\nCONTEXT:  PL/pgSQL function …" — keep the JSON only
	const after = message.slice(message.indexOf(SENTINEL) + SENTINEL.length)
	const end = after.indexOf("\nCONTEXT:")
	return JSON.parse((end === -1 ? after : after.slice(0, end)).trim()) as Row[]
}

/** The error string that carries the sentinel, wherever the API nests it. */
function find_sentinel(text: string): string | null {
	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch {
		return text.includes(SENTINEL) ? text : null
	}
	const stack: unknown[] = [parsed]
	while (stack.length) {
		const value = stack.pop()
		if (typeof value === "string" && value.includes(SENTINEL)) return value
		if (value && typeof value === "object") stack.push(...Object.values(value))
	}
	return null
}

async function run_postgres(url: string): Promise<Row[]> {
	if (new URL(url).port === "6543") {
		fail("SUPABASE_DB_URL points at the transaction pooler (:6543); use the session pooler")
	}
	const db = new SQL(url, { max: 1 })
	const connection = await db.reserve()
	try {
		await connection.unsafe(body).simple()
		return await connection.unsafe("select step, ok, detail from __results") as Row[]
	} finally {
		await connection.unsafe("rollback").simple()
		connection.release()
		await db.close()
	}
}

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
const db_url = process.env.SUPABASE_DB_URL?.trim()
if (!token && !db_url) fail("set SUPABASE_ACCESS_TOKEN or SUPABASE_DB_URL (see the header of scripts/rlsRemote.ts)")

const rows = token ? await run_https(token) : await run_postgres(db_url!)
rows.sort((a, b) => Number(a.ok) - Number(b.ok) || a.step.localeCompare(b.step))
const failed = rows.filter(r => r.ok !== true)
for (const r of failed) console.log(`FAIL  ${r.step}${r.detail ? ` — ${r.detail}` : ""}`)
console.log(`${rows.length - failed.length}/${rows.length} ok (${token ? "HTTPS Management API" : "Postgres"})`)
process.exit(failed.length === 0 ? 0 : 1)
