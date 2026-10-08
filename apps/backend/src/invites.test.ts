import { describe, expect, test } from "bun:test";
import { ApiError } from "./auth";
import type { DerivEnv, Env } from "./env";
import {
	handle_workspace_invite,
	map_add_member_error,
	parse_add_member_result,
	type AddMemberFn,
} from "./invites";
import { PLUNK_SEND_URL, type FetchLike } from "./mail";

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

const WS = "11111111-1111-4111-8111-111111111111";

function invite_env(overrides: Partial<Env> = {}): Env {
	return {
		port: 3000,
		supabase_url: "https://proj.supabase.co",
		supabase_publishable_key: "sb_publishable_x",
		supabase_service_role_key: null,
		background_workers: true,
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

function invite_request(body: unknown): Request {
	return new Request("http://backend/workspace/invite", {
		method: "POST",
		headers: { "content-type": "application/json", Authorization: "Bearer test" },
		body: JSON.stringify(body),
	});
}

describe("map_add_member_error / parse_add_member_result", () => {
	test("maps postgres phrases to stable client errors", () => {
		expect(map_add_member_error("add_workspace_member: already a member")).toMatchObject({
			status: 409,
			message: "already a member",
		});
		expect(map_add_member_error("add_workspace_member: too many pending invites")).toMatchObject({
			status: 429,
			message: "too many pending invites",
		});
		expect(map_add_member_error("add_workspace_member: the system workspace cannot be shared")).toMatchObject({
			status: 400,
			message: "cannot share this workspace",
		});
		expect(map_add_member_error("add_workspace_member: no user with email x")).toMatchObject({
			status: 500,
			message: "add workspace member failed",
		});
	});

	test("accepts member and pending rpc payloads", () => {
		expect(parse_add_member_result({ kind: "member" })).toEqual({ kind: "member" });
		expect(
			parse_add_member_result({
				kind: "pending",
				token: "ab".repeat(32),
				workspace_name: "Notes",
				inviter: "Ada",
			}),
		).toEqual({
			kind: "pending",
			token: "ab".repeat(32),
			workspace_name: "Notes",
			inviter: "Ada",
		});
	});
});

describe("handle_workspace_invite", () => {
	test("adds a registered member without sending mail", async () => {
		const sent: unknown[] = [];
		const add_member: AddMemberFn = async () => ({ kind: "member" });
		const send: FetchLike = async (_input, init) => {
			sent.push(JSON.parse(String(init?.body)));
			return new Response("{}", { status: 200 });
		};
		const res = await handle_workspace_invite(
			invite_env(),
			invite_request({ workspace_id: WS, email: "Ada@Example.com", role: "editor" }),
			add_member,
			send,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, status: "member" });
		expect(sent).toHaveLength(0);
	});

	test("mails a pending invite to /invite/<token>", async () => {
		const token = "ab".repeat(32);
		const sent: unknown[] = [];
		const urls: string[] = [];
		const add_member: AddMemberFn = async () => ({
			kind: "pending",
			token,
			workspace_name: "Notes",
			inviter: "Ada",
		});
		const send: FetchLike = async (input, init) => {
			urls.push(input);
			sent.push(JSON.parse(String(init?.body)));
			return new Response("{}", { status: 200 });
		};
		const res = await handle_workspace_invite(
			invite_env(),
			invite_request({ workspace_id: WS, email: "new@example.com", role: "viewer" }),
			add_member,
			send,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, status: "pending" });
		expect(urls).toEqual([PLUNK_SEND_URL]);
		expect(sent[0]).toMatchObject({
			to: "new@example.com",
			subject: "Ada invited you to Notes",
			subscribed: false,
		});
		expect((sent[0] as { body: string }).body).toContain(
			`href="https://app.example/invite/${token}"`,
		);
		expect((sent[0] as { body: string }).body).toContain("as a viewer");
	});

	test("503 when pending mail cannot be delivered", async () => {
		const add_member: AddMemberFn = async () => ({
			kind: "pending",
			token: "ab".repeat(32),
			workspace_name: "Notes",
			inviter: "Ada",
		});
		await expect(
			handle_workspace_invite(
				invite_env({ public_app_url: null }),
				invite_request({ workspace_id: WS, email: "new@example.com", role: "editor" }),
				add_member,
			),
		).rejects.toMatchObject({ status: 503 } satisfies Partial<ApiError>);
		await expect(
			handle_workspace_invite(
				invite_env({ plunk_secret_key: null }),
				invite_request({ workspace_id: WS, email: "new@example.com", role: "editor" }),
				add_member,
			),
		).rejects.toMatchObject({ status: 503 } satisfies Partial<ApiError>);
	});

	test("refuses a malformed body", async () => {
		const add_member: AddMemberFn = async () => ({ kind: "member" });
		await expect(
			handle_workspace_invite(invite_env(), invite_request({ email: "a@b.com", role: "editor" }), add_member),
		).rejects.toMatchObject({ status: 400, message: "invalid workspace" });
		await expect(
			handle_workspace_invite(
				invite_env(),
				invite_request({ workspace_id: WS, email: "not-an-email", role: "editor" }),
				add_member,
			),
		).rejects.toMatchObject({ status: 400, message: "invalid email" });
	});
});
