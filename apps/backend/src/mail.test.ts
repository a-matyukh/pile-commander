import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { ApiError } from "./auth";
import type { DerivEnv, Env } from "./env";
import {
	auth_email_copy,
	confirmation_url,
	handle_send_email,
	hook_secret_bytes,
	verify_standard_webhook,
	workspace_invite_email_copy,
	subject_text,
	PLUNK_SEND_URL,
	type FetchLike,
	hub_hidden_email_copy,
	hub_made_private_email_copy,
	moderation_digest_email_copy,
} from "./mail";

const DERIV_OFF: DerivEnv = {
	mode: "off",
	cron: "*/1 * * * *",
	batch_size: 4,
	max_attempts: 5,
	retry_backoff_minutes: 60,
	tick_budget_ms: 20_000,
	image_edge: 1600,
	image_quality: 78,
	max_pixels: 40_000_000,
	min_source_bytes: 262_144,
	max_source_bytes: 67_108_864,
	video: false,
	ffmpeg_path: "ffmpeg",
	poster_edge: 1280,
	poster_quality: 78,
	poster_timeout_ms: 20_000,
	poster_seek_seconds: 1,
	poster_max_output_bytes: 8_388_608,
	source_presign_ttl_seconds: 120,
};

const SECRET_BYTES = Buffer.from("test-hook-secret-bytes!!", "utf8");
const HOOK_SECRET = `v1,whsec_${SECRET_BYTES.toString("base64")}`;

function mail_env(overrides: Partial<Env> = {}): Env {
	return {
		port: 3000,
		supabase_url: "https://proj.supabase.co",
		supabase_publishable_key: "sb_publishable_x",
		supabase_service_role_key: null,
		b2_endpoint: "https://s3.example",
		b2_region: "us",
		b2_bucket: "b",
		b2_key_id: "k",
		b2_application_key: "a",
		presign_get_ttl_seconds: 900,
		presign_put_ttl_seconds: 3600,
		account_delete_max_auth_age_seconds: 600,
		trusted_proxy_hops: 1,
		hub_preview_max_bytes: 2 * 1024 * 1024,
		gc_cron: "*/5 * * * *",
		gc_batch_size: 100,
		gc_max_attempts: 25,
		gc_min_age_hours: 24,
		reconcile_cron: "0 4 * * *",
		reconcile_grace_hours: 24,
		billing_webhook_secret: null,
		send_email_hook_secret: HOOK_SECRET,
		plunk_secret_key: "sk_test",
		plunk_from_email: "noreply@example.com",
		plunk_from_name: "Pile Commander",
		public_app_url: "https://app.example",
		abuse_email: null,
		moderation_digest_email: null,
		moderation_digest_cron: "0 9 * * 1",
		moderation_mail_cron: "* * * * *",
		egress: { mode: "off", alert_day_fraction: 0.25, visitor_fraction: 0.05, alert_email: null },
		deriv: DERIV_OFF,
		...overrides,
	};
}

function sign(id: string, timestamp: string, payload: string): string {
	const digest = createHmac("sha256", SECRET_BYTES)
		.update(`${id}.${timestamp}.${payload}`)
		.digest("base64");
	return `v1,${digest}`;
}

function hook_request(payload: string, now = Math.floor(Date.now() / 1000)): Request {
	const id = "msg_test";
	const timestamp = String(now);
	return new Request("http://backend/auth/send-email", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"webhook-id": id,
			"webhook-timestamp": timestamp,
			"webhook-signature": sign(id, timestamp, payload),
		},
		body: payload,
	});
}

const signup_payload = JSON.stringify({
	user: { email: "new@example.com" },
	email_data: {
		token: "123456",
		token_hash: "abc_hash",
		redirect_to: "https://app.example",
		email_action_type: "signup",
		token_new: "",
		token_hash_new: "",
	},
});

describe("hook_secret_bytes / verify_standard_webhook", () => {
	test("accepts the dashboard v1,whsec_ form", () => {
		expect(hook_secret_bytes(HOOK_SECRET).equals(SECRET_BYTES)).toBe(true);
		expect(hook_secret_bytes(`whsec_${SECRET_BYTES.toString("base64")}`).equals(SECRET_BYTES)).toBe(
			true,
		);
	});

	test("accepts a fresh v1 signature and refuses a bad or stale one", () => {
		const payload = `{"ok":true}`;
		const id = "msg_1";
		const now = 1_700_000_000;
		const signature = sign(id, String(now), payload);
		expect(() =>
			verify_standard_webhook(payload, { id, timestamp: String(now), signature }, SECRET_BYTES, now),
		).not.toThrow();
		expect(() =>
			verify_standard_webhook(
				payload,
				{ id, timestamp: String(now), signature: "v1,AAAA" },
				SECRET_BYTES,
				now,
			),
		).toThrow("invalid webhook signature");
		expect(() =>
			verify_standard_webhook(
				payload,
				{ id, timestamp: String(now - 301), signature: sign(id, String(now - 301), payload) },
				SECRET_BYTES,
				now,
			),
		).toThrow("invalid webhook signature");
	});
});

describe("confirmation_url / auth_email_copy", () => {
	test("builds the Auth verify URL with the token hash", () => {
		expect(confirmation_url("https://proj.supabase.co/", "tok", "signup", "https://app.example/")).toBe(
			"https://proj.supabase.co/auth/v1/verify?token=tok&type=signup&redirect_to=https%3A%2F%2Fapp.example%2F",
		);
	});

	test("signup body is a single confirm link, no promotional copy", () => {
		const { subject, body } = auth_email_copy("signup", {
			url: "https://proj.supabase.co/auth/v1/verify?token=x&type=signup",
			token: "123456",
		});
		expect(subject).toBe("Confirm your email address");
		expect(body).toContain(
			'href="https://proj.supabase.co/auth/v1/verify?token=x&amp;type=signup"',
		);
		expect(body.toLowerCase()).not.toMatch(/upgrade|promo|newsletter/);
	});

	// A board name and a display name are arbitrary user text (the schema caps
	// their length only), and the subject is a header line
	test("a board name cannot break out of the subject line", () => {
		const { subject, body } = workspace_invite_email_copy({
			inviter: "Ada\r\nBcc: victim@example.invalid",
			workspace_name: "Notes\nX-Spoof: yes",
			role: "editor",
			url: "https://app.example/invite/ab",
		});
		expect(subject).not.toMatch(/[\r\n]/);
		expect(subject).toBe("Ada Bcc: victim@example.invalid invited you to Notes X-Spoof: yes");
		expect(body).not.toMatch(/[\r\n]/);
	});

	test("markup in a board name stays inert in the body", () => {
		const { body } = workspace_invite_email_copy({
			inviter: "Ada",
			workspace_name: '<img src=x onerror="alert(1)">',
			role: "viewer",
			url: "https://app.example/invite/ab",
		});
		expect(body).not.toContain("<img");
		expect(body).toContain("&lt;img");
	});
});

describe("subject_text", () => {
	test("flattens control characters and collapses whitespace", () => {
		expect(subject_text("a\r\nb")).toBe("a b");
		expect(subject_text("a\u0000\u007fb")).toBe("a b");
		expect(subject_text("  spaced   out  ")).toBe("spaced out");
		expect(subject_text("")).toBe("");
	});

	test("clamps long values with an ellipsis", () => {
		const long = "x".repeat(300);
		const clamped = subject_text(long);
		expect(clamped).toHaveLength(120);
		expect(clamped.endsWith("\u2026")).toBe(true);
	});
});

describe("workspace_invite_email_copy", () => {
	test("names the inviter, board, role, and invite URL", () => {
		const { subject, body } = workspace_invite_email_copy({
			inviter: "Ada",
			workspace_name: "Notes",
			role: "editor",
			url: "https://app.example/invite/ab",
		});
		expect(subject).toBe("Ada invited you to Notes");
		expect(body).toContain("as an editor");
		expect(body).toContain('href="https://app.example/invite/ab"');
		expect(body.toLowerCase()).not.toMatch(/upgrade|promo|newsletter/);
	});
});


describe("handle_send_email", () => {
	test("503 when the hook secret or Plunk is unset", async () => {
		await expect(
			handle_send_email(mail_env({ send_email_hook_secret: null }), hook_request(signup_payload)),
		).rejects.toMatchObject({ status: 503 } satisfies Partial<ApiError>);
		await expect(
			handle_send_email(mail_env({ plunk_secret_key: null }), hook_request(signup_payload)),
		).rejects.toMatchObject({ status: 503 } satisfies Partial<ApiError>);
		await expect(
			handle_send_email(mail_env({ plunk_from_email: null }), hook_request(signup_payload)),
		).rejects.toMatchObject({ status: 503 } satisfies Partial<ApiError>);
	});

	test("401 on a missing or forged signature", async () => {
		const unsigned = new Request("http://backend/auth/send-email", {
			method: "POST",
			body: signup_payload,
		});
		await expect(handle_send_email(mail_env(), unsigned)).rejects.toMatchObject({
			status: 401,
		} satisfies Partial<ApiError>);

		const forged = new Request("http://backend/auth/send-email", {
			method: "POST",
			headers: {
				"webhook-id": "msg_test",
				"webhook-timestamp": String(Math.floor(Date.now() / 1000)),
				"webhook-signature": "v1,not-a-real-signature",
			},
			body: signup_payload,
		});
		await expect(handle_send_email(mail_env(), forged)).rejects.toMatchObject({
			status: 401,
		} satisfies Partial<ApiError>);
	});

	test("sends a signup mail through Plunk and returns {}", async () => {
		const sent: unknown[] = [];
		const urls: string[] = [];
		const send: FetchLike = async (input, init) => {
			urls.push(input);
			sent.push(JSON.parse(String(init?.body)));
			return new Response("{}", { status: 200 });
		};
		const res = await handle_send_email(mail_env(), hook_request(signup_payload), send);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({});
		expect(urls).toEqual([PLUNK_SEND_URL]);
		expect(PLUNK_SEND_URL).toBe("https://next-api.useplunk.com/v1/send");
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			to: "new@example.com",
			subject: "Confirm your email address",
			subscribed: false,
			from: { email: "noreply@example.com", name: "Pile Commander" },
		});
		const body = (sent[0] as { body: string }).body;
		expect(body).toContain("https://proj.supabase.co/auth/v1/verify?token=abc_hash&amp;type=signup");
	});
});

describe("hub moderation copy", () => {
	test("hidden letter mentions the live link and the appeal address", () => {
		const copy = hub_hidden_email_copy({
			name: "Moodboard",
			username: "ada",
			slug: "mood",
			url: "https://app.example/ada/mood",
			abuse_email: "abuse@pile-commander.app",
		});
		expect(copy.subject).toContain("Moodboard");
		expect(copy.body).toContain("https://app.example/ada/mood");
		expect(copy.body).toContain("abuse@pile-commander.app");
	});

	test("make_private letter includes the reason", () => {
		const copy = hub_made_private_email_copy(
			{
				name: "Moodboard",
				username: "ada",
				slug: "mood",
				url: null,
				abuse_email: "abuse@pile-commander.app",
			},
			"illegal content",
		);
		expect(copy.body).toContain("illegal content");
		expect(copy.body).toContain("no longer works");
	});

	test("digest lists new and hidden boards", () => {
		const copy = moderation_digest_email_copy(
			{
				since: "2026-01-01T00:00:00Z",
				listings: [
					{
						workspace_id: "w1",
						listed_at: "2026-01-02T00:00:00Z",
						name: "New board",
						slug: "new",
						username: "ada",
						hidden_at: null,
						hidden_reason: null,
					},
				],
				hidden: [
					{
						workspace_id: "w2",
						hidden_at: "2026-01-03T00:00:00Z",
						name: "Hidden board",
						slug: "hid",
						username: "bob",
						report_count: 3,
						reasons: ["spam"],
					},
				],
			},
			"https://app.example",
		);
		expect(copy.subject).toContain("1 new");
		expect(copy.body).toContain("New board");
		expect(copy.body).toContain("Hidden board");
		expect(copy.body).toContain("spam");
	});
});
