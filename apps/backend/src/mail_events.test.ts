import { describe, expect, test } from "bun:test";
import type { Env } from "./env";
import { handle_plunk_events, mail_event_kind, type RecordMailEvent } from "./mail_events";

function env(overrides: Partial<Env> = {}): Env {
	return { plunk_webhook_secret: "s3cret", moderation_digest_email: null, ...overrides } as Env;
}

function plunk(event: Record<string, unknown>, auth = "Bearer s3cret"): Request {
	return new Request("http://backend/mail/plunk-events", {
		method: "POST",
		headers: { authorization: auth, "content-type": "application/json" },
		body: JSON.stringify({ contact: { email: "Victim@Example.com" }, event }),
	});
}

function recorder(suspended = false) {
	const calls: Parameters<RecordMailEvent>[] = [];
	const record: RecordMailEvent = async (...args) => {
		calls.push(args);
		return { actor: "u1", suspended };
	};
	return { calls, record };
}

describe("mail_event_kind", () => {
	test("complaints and permanent bounces count; transient and suppressed sends do not", () => {
		expect(mail_event_kind({ complainedAt: "t", complaintFeedbackType: "abuse" })).toBe("complaint");
		expect(mail_event_kind({ bounceType: "Permanent" })).toBe("bounce");
		expect(mail_event_kind({ bounceType: "Transient", transientBounce: true })).toBeNull();
		expect(mail_event_kind({ bounceType: "Permanent", suppressedByProvider: true })).toBeNull();
		expect(mail_event_kind({ sentAt: "t" })).toBeNull();
	});
});

describe("handle_plunk_events", () => {
	test("a complaint is recorded with Plunk's email id and the address", async () => {
		const r = recorder();
		const res = await handle_plunk_events(env(), plunk({ emailId: "em_1", complainedAt: "t" }), null, r.record);
		expect(res.status).toBe(200);
		expect(r.calls).toEqual([["em_1", "complaint", "victim@example.com"]]);
	});

	test("an event that does not count records nothing", async () => {
		const r = recorder();
		await handle_plunk_events(env(), plunk({ emailId: "em_1", bounceType: "Transient" }), null, r.record);
		expect(r.calls).toEqual([]);
	});

	test("a wrong secret is refused before anything is read", async () => {
		const r = recorder();
		await expect(handle_plunk_events(env(), plunk({ complainedAt: "t" }, "Bearer nope"), null, r.record))
			.rejects.toMatchObject({ status: 401 });
		expect(r.calls).toEqual([]);
	});

	test("a suspension mails the moderation address", async () => {
		const sent: string[] = [];
		const send = async (_url: string, init: RequestInit) => {
			sent.push(JSON.parse(String(init.body)).to);
			return Response.json({});
		};
		await handle_plunk_events(
			env({ moderation_digest_email: "mod@example.com", plunk_secret_key: "sk", plunk_from_email: "from@example.com" }),
			plunk({ emailId: "em_1", complainedAt: "t" }),
			null,
			recorder(true).record,
			send,
		);
		expect(sent).toEqual(["mod@example.com"]);
	});
});
