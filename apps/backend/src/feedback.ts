import { ApiError, internal_error, service_client } from "./auth";
import type { Env } from "./env";
import { honeypot_filled, normalize_waitlist_email } from "./waitlist";

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

// POST /feedback — public landing form. Writes under service_role; clients
// never see the table. Optional screenshots are claimed here and PUT by the
// browser to signed Storage URLs. The honeypot looks like a successful send
// so bots do not learn that the field is a trap.
export async function handle_feedback(
	env: Env,
	req: Request,
	insert: FeedbackInsert = default_insert(env),
	sign_uploads: SignUploads = default_sign(env),
): Promise<Response> {
	if (!env.supabase_service_role_key) {
		throw new ApiError(503, "feedback is not configured on this server");
	}

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

	const email = normalize_waitlist_email(body.email);
	if (!email) throw new ApiError(400, "invalid email");

	const category = normalize_feedback_category(body.category);
	if (!category) throw new ApiError(400, "invalid category");

	const message = normalize_feedback_message(body.message);
	if (!message) throw new ApiError(400, "invalid message");

	const claims = normalize_feedback_attachments(body.attachments);
	if (!claims) throw new ApiError(400, "invalid attachments");

	const id = crypto.randomUUID();
	const attachments = stored_attachments(id, claims);
	const { error } = await insert({ id, email, category, message, attachments });
	if (error) throw internal_error("feedback insert", error);

	let uploads: FeedbackUpload[] = [];
	if (attachments.length > 0) {
		try {
			uploads = await sign_uploads(attachments.map((item) => item.path));
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
