import { describe, expect, test } from "bun:test";
import { ApiError } from "./auth";
import type { Env } from "./env";
import {
	handle_pricing_notify,
	honeypot_filled,
	normalize_waitlist_email,
	type WaitlistInsert,
} from "./waitlist";

function waitlist_env(overrides: Partial<Env> = {}): Env {
	return {
		port: 3000,
		supabase_url: "https://proj.supabase.co",
		supabase_publishable_key: "sb_publishable_x",
		supabase_service_role_key: "service-role",
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
		send_email_hook_secret: null,
		plunk_secret_key: null,
		plunk_from_email: null,
		plunk_from_name: null,
		public_app_url: null,
		abuse_email: null,
		moderation_digest_email: null,
		moderation_digest_cron: "0 9 * * 1",
		moderation_mail_cron: "* * * * *",
		egress: { mode: "off", alert_day_fraction: 0.25, visitor_fraction: 0.05, alert_email: null },
		deriv: {
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
		},
		...overrides,
	};
}

function notify_request(body: unknown): Request {
	return new Request("http://backend/pricing/notify", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("normalize_waitlist_email", () => {
	test("trims, lowercases, and accepts a simple address", () => {
		expect(normalize_waitlist_email("  Ada@Example.COM ")).toBe("ada@example.com");
	});

	test("refuses missing, empty, overlong, or malformed values", () => {
		expect(normalize_waitlist_email(null)).toBeNull();
		expect(normalize_waitlist_email("")).toBeNull();
		expect(normalize_waitlist_email("not-an-email")).toBeNull();
		expect(normalize_waitlist_email("a@b")).toBeNull();
		expect(normalize_waitlist_email(`${"a".repeat(250)}@x.co`)).toBeNull();
	});
});

describe("honeypot_filled", () => {
	test("treats only a non-empty string as filled", () => {
		expect(honeypot_filled("http://spam")).toBe(true);
		expect(honeypot_filled("  ")).toBe(false);
		expect(honeypot_filled("")).toBe(false);
		expect(honeypot_filled(undefined)).toBe(false);
	});
});

describe("handle_pricing_notify", () => {
	test("503 when the service role is unset", async () => {
		await expect(
			handle_pricing_notify(waitlist_env({ supabase_service_role_key: null }), notify_request({ email: "a@b.co" })),
		).rejects.toMatchObject({ status: 503 } satisfies Partial<ApiError>);
	});

	test("400 on a missing or invalid email", async () => {
		const insert: WaitlistInsert = async () => ({ error: null });
		await expect(
			handle_pricing_notify(waitlist_env(), notify_request({}), insert),
		).rejects.toMatchObject({ status: 400, message: "invalid email" } satisfies Partial<ApiError>);
		await expect(
			handle_pricing_notify(waitlist_env(), notify_request({ email: "nope" }), insert),
		).rejects.toMatchObject({ status: 400 } satisfies Partial<ApiError>);
	});

	test("400 on a non-object body", async () => {
		const req = new Request("http://backend/pricing/notify", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "[]",
		});
		await expect(handle_pricing_notify(waitlist_env(), req)).rejects.toMatchObject({
			status: 400,
			message: "expected a JSON object body",
		} satisfies Partial<ApiError>);
	});

	test("honeypot returns ok without inserting", async () => {
		const rows: unknown[] = [];
		const insert: WaitlistInsert = async (row) => {
			rows.push(row);
			return { error: null };
		};
		const res = await handle_pricing_notify(
			waitlist_env(),
			notify_request({ email: "bot@example.com", website: "https://spam" }),
			insert,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(rows).toEqual([]);
	});

	test("inserts a normalized row", async () => {
		const rows: unknown[] = [];
		const insert: WaitlistInsert = async (row) => {
			rows.push(row);
			return { error: null };
		};
		const res = await handle_pricing_notify(
			waitlist_env(),
			notify_request({ email: "  Ada@Example.COM " }),
			insert,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(rows).toEqual([{ email: "ada@example.com", subscribed: true, source: "pricing" }]);
	});

	test("unique conflict still returns ok", async () => {
		const insert: WaitlistInsert = async () => ({ error: { code: "23505" } });
		const res = await handle_pricing_notify(
			waitlist_env(),
			notify_request({ email: "ada@example.com" }),
			insert,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});
});
