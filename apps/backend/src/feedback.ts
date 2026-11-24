import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, bearer_token, internal_error, require_user, service_client, user_client } from "./auth";
import type { Env } from "./env";
import { honeypot_filled, normalize_email } from "./emails";

export const FEEDBACK_CATEGORIES = ["bug", "idea", "other"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export const FEEDBACK_MESSAGE_MAX = 4000;
export const FEEDBACK_ATTACHMENT_MAX = 5;
export const FEEDBACK_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const FEEDBACK_BUCKET = "feedback";

const EXT_BY_MIME = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"image/gif": "gif",
} as const;

export type FeedbackImageMime = keyof typeof EXT_BY_MIME;

export type FeedbackAttachment = {
	path: string;
	mime: FeedbackImageMime;
	size_bytes: number;
};

export type FeedbackAttachmentClaim = {
	mime: FeedbackImageMime;
	size: number;
};

export type FeedbackUpload = {
	path: string;
	token: string;
	signedUrl: string;
};

export type FeedbackRow = {
	id: string;
	email: string;
	category: FeedbackCategory;
	message: string;
	attachments: FeedbackAttachment[];
};

export type FeedbackInsert = (
	row: FeedbackRow,
) => Promise<{ error: { code?: string } | null }>;

export type SignUploads = (paths: string[]) => Promise<FeedbackUpload[]>;

/** Notes and screenshots claimed over the last 24 hours, by everyone */
export type FeedbackDay = { notes: number; attachments: number };

export type FeedbackDeps = {
	insert: FeedbackInsert;
	sign_uploads: SignUploads;
	/** today's totals for the ceiling */
	day: () => Promise<FeedbackDay>;
	/** true when the request carries a valid access token */
	signed_in: (req: Request) => Promise<boolean>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function default_day(env: Env): FeedbackDeps["day"] {
	return async () => {
		const db = service_client(env);
		const { data, error } = await db
			.from("feedback")
			.select("attachments")
			.gte("created_at", new Date(Date.now() - DAY_MS).toISOString());
		if (error) throw internal_error("feedback day", error);
		const rows = (data ?? []) as { attachments: unknown }[];
		let attachments = 0;
		for (const row of rows) attachments += Array.isArray(row.attachments) ? row.attachments.length : 0;
		return { notes: rows.length, attachments };
	};
}

function default_signed_in(env: Env): FeedbackDeps["signed_in"] {
	return async (req) => {
		const token = bearer_token(req);
		if (!token) return false;
		try {
			await require_user(user_client(env, token), token);
			return true;
		} catch {
			return false;
		}
	};
}

function default_insert(env: Env): FeedbackInsert {
	return async (row) => {
		const db = service_client(env);
		const { error } = await db.from("feedback").insert(row);
		return { error };
	};
}

function default_sign(env: Env): SignUploads {
	return async (paths) => {
		const db = service_client(env);
		const uploads: FeedbackUpload[] = [];
		for (const path of paths) {
			const { data, error } = await db.storage.from(FEEDBACK_BUCKET).createSignedUploadUrl(path);
			if (error || !data) throw internal_error("feedback signed upload", error);
			uploads.push({ path: data.path, token: data.token, signedUrl: data.signedUrl });
		}
		return uploads;
	};
}

export function normalize_feedback_category(raw: unknown): FeedbackCategory | null {
	if (typeof raw !== "string") return null;
	const category = raw.trim().toLowerCase();
	return (FEEDBACK_CATEGORIES as readonly string[]).includes(category)
		? (category as FeedbackCategory)
		: null;
}

export function normalize_feedback_message(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const message = raw.trim();
	if (!message || message.length > FEEDBACK_MESSAGE_MAX) return null;
	return message;
}

export function normalize_feedback_image_mime(raw: unknown): FeedbackImageMime | null {
	if (typeof raw !== "string") return null;
	const mime = raw.trim().toLowerCase();
	if (mime === "image/jpg") return "image/jpeg";
	return mime in EXT_BY_MIME ? (mime as FeedbackImageMime) : null;
}

export function normalize_feedback_attachments(raw: unknown): FeedbackAttachmentClaim[] | null {
	if (raw === undefined || raw === null) return [];
	if (!Array.isArray(raw)) return null;
	if (raw.length > FEEDBACK_ATTACHMENT_MAX) return null;
	const claims: FeedbackAttachmentClaim[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object" || Array.isArray(item)) return null;
		const row = item as Record<string, unknown>;
		const mime = normalize_feedback_image_mime(row.mime);
		const size = typeof row.size === "number" ? row.size : Number(row.size);
		if (!mime || !Number.isInteger(size) || size < 1 || size > FEEDBACK_ATTACHMENT_MAX_BYTES) {
			return null;
		}
		claims.push({ mime, size });
	}
	return claims;
}

function attachment_path(feedback_id: string, mime: FeedbackImageMime): string {
	return `${feedback_id}/${crypto.randomUUID()}.${EXT_BY_MIME[mime]}`;
}

function stored_attachments(id: string, claims: FeedbackAttachmentClaim[]): FeedbackAttachment[] {
	return claims.map((claim) => ({
		path: attachment_path(id, claim.mime),
		mime: claim.mime,
		size_bytes: claim.size,
	}));
}

// POST /feedback — the form in the app. Writes under service_role; clients
// never see the table. The honeypot looks like a successful send so bots do
// not learn that the field is a trap.
//
// The route takes no sign-in, and the Origin it checks is a header any script
// can set, so what one day can bring is capped for everyone together
// (FEEDBACK_DAILY_MAX notes, FEEDBACK_DAILY_ATTACHMENTS_MAX screenshots): past
// the ceiling the form says "try again later" and nothing is stored.
// Screenshots are bytes in our Storage, 5 MB each: they are taken from a
// signed-in person only. A note in words stays open to anyone.
export async function handle_feedback(
	env: Env,
	req: Request,
	overrides: Partial<FeedbackDeps> = {},
): Promise<Response> {
	if (!env.supabase_service_role_key) {
		throw new ApiError(503, "feedback is not configured on this server");
	}
	const deps: FeedbackDeps = {
		insert: overrides.insert ?? default_insert(env),
		sign_uploads: overrides.sign_uploads ?? default_sign(env),
		day: overrides.day ?? default_day(env),
		signed_in: overrides.signed_in ?? default_signed_in(env),
	};

	let body: Record<string, unknown>;
	try {
		const parsed = (await req.json()) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("not an object");
		}
		body = parsed as Record<string, unknown>;
	} catch {
		throw new ApiError(400, "expected a JSON object body");
	}

	if (honeypot_filled(body.website)) {
		return Response.json({ ok: true });
	}

	const email = normalize_email(body.email);
	if (!email) throw new ApiError(400, "invalid email");

	const category = normalize_feedback_category(body.category);
	if (!category) throw new ApiError(400, "invalid category");

	const message = normalize_feedback_message(body.message);
	if (!message) throw new ApiError(400, "invalid message");

	const claims = normalize_feedback_attachments(body.attachments);
	if (!claims) throw new ApiError(400, "invalid attachments");

	if (claims.length > 0 && !(await deps.signed_in(req))) {
		throw new ApiError(401, "sign in to attach screenshots", { reason: "attachments_need_sign_in" });
	}

	const day = await deps.day();
	if (
		day.notes >= env.feedback_daily_max ||
		day.attachments + claims.length > env.feedback_daily_attachments_max
	) {
		console.error(
			`[feedback] daily ceiling reached: ${day.notes} notes, ${day.attachments} screenshots in the last 24 h`,
		);
		throw new ApiError(429, "too much feedback today, try again tomorrow", {}, { "Retry-After": "3600" });
	}

	const id = crypto.randomUUID();
	const attachments = stored_attachments(id, claims);
	const { error } = await deps.insert({ id, email, category, message, attachments });
	if (error) throw internal_error("feedback insert", error);

	let uploads: FeedbackUpload[] = [];
	if (attachments.length > 0) {
		try {
			uploads = await deps.sign_uploads(attachments.map((item) => item.path));
		} catch (err) {
			if (err instanceof ApiError) throw err;
			throw internal_error("feedback signed upload", err);
		}
	}
	return Response.json({ ok: true, uploads });
}

export type DeleteFeedback = {
	load: (id: string) => Promise<{ attachments: FeedbackAttachment[] } | null>;
	remove_objects: (paths: string[]) => Promise<{ error: { message?: string } | null }>;
	remove_row: (id: string) => Promise<{ error: { message?: string } | null }>;
};

function default_delete(env: Env): DeleteFeedback {
	const db = service_client(env);
	return {
		async load(id) {
			const { data, error } = await db.from("feedback").select("attachments").eq("id", id).maybeSingle();
			if (error) throw internal_error("feedback load", error);
			if (!data) return null;
			const attachments = Array.isArray(data.attachments) ? (data.attachments as FeedbackAttachment[]) : [];
			return { attachments };
		},
		async remove_objects(paths) {
			if (paths.length === 0) return { error: null };
			const { error } = await db.storage.from(FEEDBACK_BUCKET).remove(paths);
			return { error };
		},
		async remove_row(id) {
			const { error } = await db.from("feedback").delete().eq("id", id);
			return { error };
		},
	};
}

// Operator / GDPR path: Storage API first, then the row. Not a public route.
export async function delete_feedback(
	env: Env,
	id: string,
	ops: DeleteFeedback = default_delete(env),
): Promise<void> {
	if (!env.supabase_service_role_key) {
		throw new ApiError(503, "feedback is not configured on this server");
	}
	const row = await ops.load(id);
	if (!row) throw new ApiError(404, "feedback not found");
	const paths = row.attachments.map((item) => item.path).filter((path) => typeof path === "string" && path);
	const objects = await ops.remove_objects(paths);
	if (objects.error) throw internal_error("feedback storage remove", objects.error);
	const deleted = await ops.remove_row(id);
	if (deleted.error) throw internal_error("feedback delete", deleted.error);
}

export type PruneFeedback = {
	/** notes older than `before` that still list screenshots, oldest first */
	old_with_attachments: (before: string, limit: number) => Promise<{ id: string; attachments: FeedbackAttachment[] }[]>;
	remove_objects: (paths: string[]) => Promise<{ error: { message?: string } | null }>;
	clear_attachments: (id: string) => Promise<{ error: { message?: string } | null }>;
};

function default_prune(db: SupabaseClient): PruneFeedback {
	return {
		async old_with_attachments(before, limit) {
			const { data, error } = await db
				.from("feedback")
				.select("id, attachments")
				.lt("created_at", before)
				.neq("attachments", "[]")
				.order("created_at", { ascending: true })
				.limit(limit);
			if (error) throw internal_error("feedback prune list", error);
			return ((data ?? []) as { id: string; attachments: unknown }[]).map((row) => ({
				id: row.id,
				attachments: Array.isArray(row.attachments) ? (row.attachments as FeedbackAttachment[]) : [],
			}));
		},
		async remove_objects(paths) {
			if (paths.length === 0) return { error: null };
			const { error } = await db.storage.from(FEEDBACK_BUCKET).remove(paths);
			return { error };
		},
		async clear_attachments(id) {
			const { error } = await db.from("feedback").update({ attachments: [] }).eq("id", id);
			return { error };
		},
	};
}

const PRUNE_BATCH = 100;

/**
 * Screenshots are kept for `days` days, then removed from Storage; the note
 * itself stays, without them. The objects go first: a note whose row was
 * cleared while its files stayed would leave them with nothing pointing at
 * them. Returns how many notes were cleared; a failure leaves the note for
 * the next run
 */
export async function prune_feedback_attachments(
	days: number,
	ops: PruneFeedback,
	now: number = Date.now(),
): Promise<number> {
	const before = new Date(now - days * DAY_MS).toISOString();
	const rows = await ops.old_with_attachments(before, PRUNE_BATCH);
	let cleared = 0;
	for (const row of rows) {
		const paths = row.attachments.map((item) => item.path).filter((path) => typeof path === "string" && path);
		const removed = await ops.remove_objects(paths);
		if (removed.error) {
			console.error("[feedback] screenshot removal failed:", row.id, removed.error.message ?? removed.error);
			continue;
		}
		const updated = await ops.clear_attachments(row.id);
		if (updated.error) {
			console.error("[feedback] clearing attachments failed:", row.id, updated.error.message ?? updated.error);
			continue;
		}
		cleared += 1;
	}
	return cleared;
}

export function start_feedback_worker(env: Env, db: SupabaseClient): void {
	// once a day is plenty: a screenshot a day older than the limit harms nobody
	Bun.cron("41 4 * * *", async () => {
		try {
			const cleared = await prune_feedback_attachments(env.feedback_attachment_days, default_prune(db));
			if (cleared > 0) console.log(`[feedback] removed the screenshots of ${cleared} note(s) older than ${env.feedback_attachment_days} days`);
		} catch (err) {
			console.error("[feedback] prune failed:", err);
		}
	});
	console.log(`[feedback] screenshots are kept for ${env.feedback_attachment_days} days`);
}
