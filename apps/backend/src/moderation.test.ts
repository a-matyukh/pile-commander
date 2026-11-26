import { describe, expect, test } from "bun:test";
import type { Env } from "./env";
import {
	drain_moderation_mail,
	notify_moderator_of_hidden,
	parse_digest_payload,
	type HiddenNotices,
	type OwnerMailQueue,
} from "./moderation";

describe("parse_digest_payload", () => {
	test("fills empty lists when the RPC returns nothing useful", () => {
		expect(parse_digest_payload(null)).toEqual({ since: "", listings: [], hidden: [] });
		expect(parse_digest_payload({ since: "x", listings: [{ name: "a" }], hidden: [] })).toMatchObject({
			since: "x",
			listings: [{ name: "a" }],
			hidden: [],
		});
	});
});

describe("notify_moderator_of_hidden", () => {
	const env = {
		plunk_secret_key: "sk",
		plunk_from_email: "hello@example.com",
		plunk_from_name: "Pile",
		plunk_api_url: "https://plunk.test",
		moderation_digest_email: "mod@example.com",
		public_app_url: "https://app.example.com",
	} as unknown as Env;
	const row = { id: "m1", workspace_id: "w1", username: "ann", slug: "moodboard", workspace_name: "Moodboard" };

	function harness(over: Partial<HiddenNotices> = {}, status = 200) {
		// the row's mark in the database: set by a claim, cleared by a release
		const marked: string[] = [];
		const mails: { to: unknown; subject: unknown; body: string }[] = [];
		const store: HiddenNotices = {
			pending: async () => [row],
			reports: async () => [{ workspace_id: "w1", hidden_at: null, name: "Moodboard", slug: "moodboard", username: "ann", report_count: 3, reasons: ["spam", "<b>ads</b>"] }],
			claim: async (id) => {
				if (marked.includes(id)) return false;
				marked.push(id);
				return true;
			},
			release: async (id) => {
				marked.splice(marked.indexOf(id), 1);
			},
			...over,
		};
		const send = (async (_url: unknown, init?: { body?: unknown }) => {
			const body = JSON.parse(String(init?.body ?? "{}")) as { to: unknown; subject: unknown; body: string };
			mails.push(body);
			return new Response(status === 200 ? "{}" : "no", { status });
		}) as never;
		return { store, send, marked, mails };
	}

	test("the moderator hears at once, with the link, the count and what the reports say", async () => {
		const h = harness();
		expect(await notify_moderator_of_hidden(env, h.store, h.send)).toBe(1);
		expect(h.marked).toEqual(["m1"]);
		expect(h.mails[0]?.to).toBe("mod@example.com");
		expect(String(h.mails[0]?.subject)).toContain("Moodboard");
		expect(h.mails[0]?.body).toContain("https://app.example.com/ann/moodboard");
		expect(h.mails[0]?.body).toContain("Reports: 3");
		expect(h.mails[0]?.body).toContain("&lt;b&gt;ads&lt;/b&gt;");
		expect(h.mails[0]?.body).toContain("w1");
	});

	test("a notice that did not go is not marked: the next tick sends it", async () => {
		const h = harness({}, 500);
		expect(await notify_moderator_of_hidden(env, h.store, h.send)).toBe(0);
		expect(h.marked).toEqual([]);
	});

	test("two copies of the backend on the same tick tell the moderator once", async () => {
		const h = harness();
		const told = await Promise.all([
			notify_moderator_of_hidden(env, h.store, h.send),
			notify_moderator_of_hidden(env, h.store, h.send),
		]);
		expect(told.sort()).toEqual([0, 1]);
		expect(h.mails).toHaveLength(1);
	});

	test("the notice goes without the reasons when they cannot be read", async () => {
		const h = harness({ reports: async () => { throw new Error("rpc down"); } });
		expect(await notify_moderator_of_hidden(env, h.store, h.send)).toBe(1);
		expect(h.mails[0]?.body).not.toContain("Reports:");
	});

	test("a database from before the column, or no moderator address, sends nothing", async () => {
		const old = harness({ pending: async () => null });
		expect(await notify_moderator_of_hidden(env, old.store, old.send)).toBe(0);
		const h = harness();
		expect(await notify_moderator_of_hidden({ ...env, moderation_digest_email: null } as Env, h.store, h.send)).toBe(0);
		expect(h.mails).toEqual([]);
	});
});

describe("drain_moderation_mail", () => {
	const env = {
		plunk_secret_key: "sk",
		plunk_from_email: "hello@example.com",
		plunk_from_name: "Pile",
		public_app_url: "https://app.example.com",
		abuse_email: "abuse@example.com",
	} as unknown as Env;

	type Stored = { id: string; kind: "listing_hidden" | "listing_made_private"; owner_id: string; reason: string | null; username: string | null; slug: string | null; workspace_name: string | null; attempts: number; sent: boolean; last_error: string | null };

	/** The table as two copies of the backend see it: one set of rows, a claim that only one of them wins. */
	function harness(status = 200, emails: Record<string, string | null> = { u1: "ann@example.com" }) {
		const rows: Stored[] = [
			{ id: "m1", kind: "listing_hidden", owner_id: "u1", reason: "reports", username: "ann", slug: "moodboard", workspace_name: "Moodboard", attempts: 0, sent: false, last_error: null },
			{ id: "m2", kind: "listing_made_private", owner_id: "u1", reason: "spam", username: "ann", slug: "moodboard", workspace_name: "Moodboard", attempts: 0, sent: false, last_error: null },
		];
		const row_of = (id: string) => rows.find((row) => row.id === id)!;
		const queue: OwnerMailQueue = {
			// a copy of each row, as a read over the network is
			pending: async () => rows.filter((row) => !row.sent).map((row) => ({ ...row })),
			claim: async (seen) => {
				const row = row_of(seen.id);
				if (row.sent || row.attempts !== seen.attempts) return false;
				row.attempts += 1;
				return true;
			},
			email: async (owner_id) => emails[owner_id] ?? null,
			sent: async (id) => {
				row_of(id).sent = true;
				row_of(id).last_error = null;
			},
			failed: async (id, message) => {
				row_of(id).last_error = message;
			},
		};
		const mails: { to: unknown; subject: string }[] = [];
		const send = (async (_url: unknown, init?: { body?: unknown }) => {
			mails.push(JSON.parse(String(init?.body ?? "{}")) as { to: unknown; subject: string });
			return new Response(status === 200 ? "{}" : "no", { status });
		}) as never;
		return { queue, send, mails, rows };
	}

	test("each queued mail goes to the owner once and is marked sent", async () => {
		const h = harness();
		expect(await drain_moderation_mail(env, h.queue, h.send)).toBe(2);
		expect(h.mails.map((mail) => mail.to)).toEqual(["ann@example.com", "ann@example.com"]);
		expect(h.mails[0]!.subject).toContain("hidden from the Hub");
		expect(h.mails[1]!.subject).toContain("unpublished");
		expect(h.rows.map((row) => [row.sent, row.attempts])).toEqual([[true, 1], [true, 1]]);
		expect(await drain_moderation_mail(env, h.queue, h.send)).toBe(0);
		expect(h.mails).toHaveLength(2);
	});

	test("two copies of the backend on the same tick send each mail once", async () => {
		const h = harness();
		const sent = await Promise.all([
			drain_moderation_mail(env, h.queue, h.send),
			drain_moderation_mail(env, h.queue, h.send),
		]);
		expect(sent[0]! + sent[1]!).toBe(2);
		expect(h.mails).toHaveLength(2);
		expect(new Set(h.mails.map((mail) => mail.subject)).size).toBe(2);
	});

	test("a mail that did not go stays queued with its error and goes on the next tick", async () => {
		const failing = harness(500);
		expect(await drain_moderation_mail(env, failing.queue, failing.send)).toBe(0);
		expect(failing.rows.map((row) => [row.sent, row.attempts, row.last_error])).toEqual([
			[false, 1, "email delivery failed"],
			[false, 1, "email delivery failed"],
		]);
		const working = harness();
		working.rows.forEach((row) => { row.attempts = 1; row.last_error = "email delivery failed"; });
		expect(await drain_moderation_mail(env, working.queue, working.send)).toBe(2);
		expect(working.rows.map((row) => [row.sent, row.attempts, row.last_error])).toEqual([[true, 2, null], [true, 2, null]]);
	});

	test("an owner without an address is noted, and nothing is sent", async () => {
		const h = harness(200, { u1: null });
		expect(await drain_moderation_mail(env, h.queue, h.send)).toBe(0);
		expect(h.mails).toEqual([]);
		expect(h.rows[0]!.last_error).toBe("owner has no email");
	});
});
