import { describe, expect, test } from "bun:test";
import type { Env } from "./env";
import { notify_moderator_of_hidden, parse_digest_payload, type HiddenNotices } from "./moderation";

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
		const marked: string[] = [];
		const mails: { to: unknown; subject: unknown; body: string }[] = [];
		const store: HiddenNotices = {
			pending: async () => [row],
			reports: async () => [{ workspace_id: "w1", hidden_at: null, name: "Moodboard", slug: "moodboard", username: "ann", report_count: 3, reasons: ["spam", "<b>ads</b>"] }],
			mark: async (id) => {
				marked.push(id);
				return { error: null };
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
