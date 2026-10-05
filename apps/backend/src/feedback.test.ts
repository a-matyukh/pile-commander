import { describe, expect, test } from "bun:test";
import { ApiError } from "./auth";
import type { Env } from "./env";
import {
	FEEDBACK_ATTACHMENT_MAX,
	FEEDBACK_ATTACHMENT_MAX_BYTES,
	FEEDBACK_MESSAGE_MAX,
	delete_feedback,
	handle_feedback,
	normalize_feedback_attachments,
	normalize_feedback_category,
	normalize_feedback_message,
	type DeleteFeedback,
	type FeedbackInsert,
	type FeedbackUpload,
	type SignUploads,
} from "./feedback";

function feedback_env(overrides: Partial<Env> = {}): Env {
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

function valid_body(overrides: Record<string, unknown> = {}) {
	return {
		email: "ada@example.com",
		category: "idea",
		message: "please add folders",
		...overrides,
	};
}

function feedback_request(body: unknown): Request {
	return new Request("http://backend/feedback", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

const silent_sign: SignUploads = async () => {
	throw new Error("sign_uploads should not run");
};

describe("normalize_feedback_category", () => {
	test("accepts the three labels, case-insensitive", () => {
		expect(normalize_feedback_category("bug")).toBe("bug");
		expect(normalize_feedback_category(" Idea ")).toBe("idea");
		expect(normalize_feedback_category("OTHER")).toBe("other");
	});

	test("refuses missing or unknown values", () => {
		expect(normalize_feedback_category(null)).toBeNull();
		expect(normalize_feedback_category("")).toBeNull();
		expect(normalize_feedback_category("feature")).toBeNull();
	});
});

describe("normalize_feedback_message", () => {
	test("trims and accepts a short note", () => {
		expect(normalize_feedback_message("  hello  ")).toBe("hello");
	});

	test("refuses empty, whitespace-only, or overlong values", () => {
		expect(normalize_feedback_message(null)).toBeNull();
		expect(normalize_feedback_message("")).toBeNull();
		expect(normalize_feedback_message("   ")).toBeNull();
		expect(normalize_feedback_message("x".repeat(FEEDBACK_MESSAGE_MAX))).toHaveLength(
			FEEDBACK_MESSAGE_MAX,
		);
		expect(normalize_feedback_message("x".repeat(FEEDBACK_MESSAGE_MAX + 1))).toBeNull();
	});
});

describe("normalize_feedback_attachments", () => {
	test("treats missing as none", () => {
		expect(normalize_feedback_attachments(undefined)).toEqual([]);
		expect(normalize_feedback_attachments(null)).toEqual([]);
		expect(normalize_feedback_attachments([])).toEqual([]);
	});

	test("accepts up to five image claims", () => {
		const five = Array.from({ length: FEEDBACK_ATTACHMENT_MAX }, () => ({
			mime: "image/png",
			size: 12,
		}));
		expect(normalize_feedback_attachments(five)).toHaveLength(5);
		expect(normalize_feedback_attachments([{ mime: "image/jpg", size: 3 }])).toEqual([
			{ mime: "image/jpeg", size: 3 },
		]);
	});

	test("refuses a sixth file, a bad mime, or an oversize claim", () => {
		const six = Array.from({ length: FEEDBACK_ATTACHMENT_MAX + 1 }, () => ({
			mime: "image/png",
			size: 12,
		}));
		expect(normalize_feedback_attachments(six)).toBeNull();
		expect(normalize_feedback_attachments([{ mime: "application/pdf", size: 12 }])).toBeNull();
		expect(normalize_feedback_attachments([{ mime: "image/png", size: 0 }])).toBeNull();
		expect(
			normalize_feedback_attachments([
				{ mime: "image/png", size: FEEDBACK_ATTACHMENT_MAX_BYTES + 1 },
			]),
		).toBeNull();
		expect(normalize_feedback_attachments("nope")).toBeNull();
	});
});

describe("handle_feedback", () => {
	test("503 when the service role is unset", async () => {
		await expect(
			handle_feedback(
				feedback_env({ supabase_service_role_key: null }),
				feedback_request(valid_body()),
			),
		).rejects.toMatchObject({ status: 503 } satisfies Partial<ApiError>);
	});

	test("400 on missing or invalid fields", async () => {
		const insert: FeedbackInsert = async () => ({ error: null });
		await expect(
			handle_feedback(feedback_env(), feedback_request({}), insert, silent_sign),
		).rejects.toMatchObject({ status: 400, message: "invalid email" } satisfies Partial<ApiError>);
		await expect(
			handle_feedback(
				feedback_env(),
				feedback_request(valid_body({ email: "nope" })),
				insert,
				silent_sign,
			),
		).rejects.toMatchObject({ status: 400, message: "invalid email" } satisfies Partial<ApiError>);
		await expect(
			handle_feedback(
				feedback_env(),
				feedback_request(valid_body({ category: "feature" })),
				insert,
				silent_sign,
			),
		).rejects.toMatchObject({
			status: 400,
			message: "invalid category",
		} satisfies Partial<ApiError>);
		await expect(
			handle_feedback(
				feedback_env(),
				feedback_request(valid_body({ message: "   " })),
				insert,
				silent_sign,
			),
		).rejects.toMatchObject({
			status: 400,
			message: "invalid message",
		} satisfies Partial<ApiError>);
		await expect(
			handle_feedback(
				feedback_env(),
				feedback_request(valid_body({ attachments: [{ mime: "image/png", size: 0 }] })),
				insert,
				silent_sign,
			),
		).rejects.toMatchObject({
			status: 400,
			message: "invalid attachments",
		} satisfies Partial<ApiError>);
	});

	test("400 on a non-object body", async () => {
		const req = new Request("http://backend/feedback", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "[]",
		});
		await expect(handle_feedback(feedback_env(), req)).rejects.toMatchObject({
			status: 400,
			message: "expected a JSON object body",
		});
	});

	test("honeypot returns ok without inserting or signing", async () => {
		const rows: unknown[] = [];
		const insert: FeedbackInsert = async (row) => {
			rows.push(row);
			return { error: null };
		};
		const res = await handle_feedback(
			feedback_env(),
			feedback_request(valid_body({ website: "https://spam", attachments: [{ mime: "image/png", size: 8 }] })),
			insert,
			silent_sign,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(rows).toEqual([]);
	});

	test("inserts a normalized row with no uploads", async () => {
		const rows: unknown[] = [];
		const insert: FeedbackInsert = async (row) => {
			rows.push(row);
			return { error: null };
		};
		const res = await handle_feedback(
			feedback_env(),
			feedback_request({
				email: "  Ada@Example.COM ",
				category: " Bug ",
				message: "  the board jumped  ",
			}),
			insert,
			silent_sign,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, uploads: [] });
		expect(rows).toHaveLength(1);
		const row = rows[0] as {
			id: string;
			email: string;
			category: string;
			message: string;
			attachments: unknown[];
		};
		expect(row.email).toBe("ada@example.com");
		expect(row.category).toBe("bug");
		expect(row.message).toBe("the board jumped");
		expect(row.attachments).toEqual([]);
		expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
	});

	test("mints signed upload URLs for five images", async () => {
		const signed: string[] = [];
		const insert: FeedbackInsert = async (row) => {
			expect(row.attachments).toHaveLength(5);
			expect(row.attachments.every((item) => item.path.startsWith(`${row.id}/`))).toBe(true);
			return { error: null };
		};
		const sign: SignUploads = async (paths) => {
			signed.push(...paths);
			return paths.map(
				(path): FeedbackUpload => ({
					path,
					token: `t-${path}`,
					signedUrl: `https://storage.example/${path}`,
				}),
			);
		};
		const claims = [
			{ mime: "image/png", size: 10 },
			{ mime: "image/jpeg", size: 20 },
			{ mime: "image/webp", size: 30 },
			{ mime: "image/gif", size: 40 },
			{ mime: "image/jpg", size: 50 },
		];
		const res = await handle_feedback(
			feedback_env(),
			feedback_request(valid_body({ attachments: claims })),
			insert,
			sign,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; uploads: FeedbackUpload[] };
		expect(body.ok).toBe(true);
		expect(body.uploads).toHaveLength(5);
		expect(signed).toHaveLength(5);
		expect(body.uploads[0]?.signedUrl).toContain("https://storage.example/");
		expect(body.uploads.map((item) => item.path.split(".").pop()).sort()).toEqual([
			"gif",
			"jpg",
			"jpg",
			"png",
			"webp",
		]);
	});
});

describe("delete_feedback", () => {
	test("removes storage objects then the row", async () => {
		const removed: string[] = [];
		const deleted: string[] = [];
		const ops: DeleteFeedback = {
			load: async () => ({
				attachments: [
					{ path: "aaa/1.png", mime: "image/png", size_bytes: 8 },
					{ path: "aaa/2.jpg", mime: "image/jpeg", size_bytes: 9 },
				],
			}),
			remove_objects: async (paths) => {
				removed.push(...paths);
				return { error: null };
			},
			remove_row: async (id) => {
				deleted.push(id);
				return { error: null };
			},
		};
		await delete_feedback(feedback_env(), "aaa", ops);
		expect(removed).toEqual(["aaa/1.png", "aaa/2.jpg"]);
		expect(deleted).toEqual(["aaa"]);
	});

	test("404 when the row is missing", async () => {
		const ops: DeleteFeedback = {
			load: async () => null,
			remove_objects: async () => ({ error: null }),
			remove_row: async () => ({ error: null }),
		};
		await expect(delete_feedback(feedback_env(), "missing", ops)).rejects.toMatchObject({
			status: 404,
		} satisfies Partial<ApiError>);
	});
});
