/**
 * Which egress refusals are live (see egress.ts). `off` only counts and
 * alerts; `file_size` also refuses originals above max_public_file_bytes to
 * non-members; `all` adds the per-visitor share and the monthly budget
 */
export type EgressMode = "off" | "file_size" | "all";

export type EgressEnv = {
	mode: EgressMode;
	/** alert when an owner's bytes today reach this share of their monthly budget */
	alert_day_fraction: number;
	/** one visitor (IPv4 address / IPv6 /64) gets at most this share of an owner's monthly budget per UTC day */
	visitor_fraction: number;
	/** ops address for egress alerts; unset → Render log only */
	alert_email: string | null;
};

/**
 * Previews for non-members (see derivatives.ts). `off` — no worker; `generate`
 * — the worker fills entry_derivatives but GET /presign still signs
 * originals (measure coverage and cost with no visible change); `serve` —
 * non-members get the ready preview. Ship the client that renders posters
 * before switching to `serve`
 */
export type DerivMode = "off" | "generate" | "serve";

export type DerivEnv = {
	mode: DerivMode;
	cron: string;
	/** blobs per tick; processed one at a time */
	batch_size: number;
	/** transient failures before a blob is a dead letter */
	max_attempts: number;
	/** a failed blob waits this × its attempts */
	retry_backoff_minutes: number;
	/** a tick starts no new blob after this; keep it under the 25 s shutdown deadline */
	tick_budget_ms: number;
	/** long side of an image thumb, never upscaled */
	image_edge: number;
	image_quality: number;
	/** refuse images above this many pixels before a pixel buffer exists (RGBA = 4 B/px) */
	max_pixels: number;
	/** below this the original is served as is */
	min_source_bytes: number;
	/** images above this are not downloaded into the process at all */
	max_source_bytes: number;
	/** video posters through ffmpeg (preinstalled on Render's native runtimes) */
	video: boolean;
	ffmpeg_path: string;
	poster_edge: number;
	poster_quality: number;
	poster_timeout_ms: number;
	poster_seek_seconds: number;
	/** ffmpeg's stdout (one frame) above this kills the process */
	poster_max_output_bytes: number;
	/** lifetime of the URL ffmpeg reads the original through (Range requests) */
	source_presign_ttl_seconds: number;
};

export type Env = {
	port: number;
	supabase_url: string;
	supabase_publishable_key: string;
	/** only the GC worker needs it; without it the worker is disabled */
	supabase_service_role_key: string | null;
	/**
	 * GC, reconcile, previews, Hub mail and the egress flush. Off for a local
	 * process that still has the production service role: the HTTP routes stay
	 * up, and a second copy of those jobs does not run against the live project.
	 */
	background_workers: boolean;
	b2_endpoint: string;
	b2_region: string;
	b2_bucket: string;
	b2_key_id: string;
	b2_application_key: string;
	/** download (GET) presign lifetime — short: a leaked URL is a read capability */
	presign_get_ttl_seconds: number;
	/** upload (PUT) presign lifetime — must outlive a slow upload of max_file_bytes */
	presign_put_ttl_seconds: number;
	/** /account/delete requires an authentication (amr timestamp) younger than this */
	account_delete_max_auth_age_seconds: number;
	/**
	 * How many proxies sit in front of this process (Render = 1). client_ip
	 * reads the x-forwarded-for entry this many hops from the RIGHT; everything
	 * to its left is client-supplied and must never reach a rate-limit bucket
	 */
	trusted_proxy_hops: number;
	/**
	 * Ceiling on the bytes /hub-preview/finalize copies out of staging. The
	 * effective cap is min(this, the 2 MB the DB enforces), so raising it alone
	 * changes nothing — record_hub_preview_upload would refuse the copy
	 */
	hub_preview_max_bytes: number;
	gc_cron: string;
	gc_batch_size: number;
	gc_max_attempts: number;
	/** queued blob deletions younger than this are not executed yet (recovery window) */
	gc_min_age_hours: number;
	/**
	 * Orphan reconciliation. Hourly by default: a presigned PUT cannot be
	 * bounded in size (Bun's presign signs no content-length), so the only
	 * control over an upload that is never finalized is how fast the diff
	 * against the bucket finds it. Back to daily if s3.list gets expensive
	 */
	reconcile_cron: string;
	/**
	 * Floor for the orphan cutoff. The effective grace is at least
	 * presign_put_ttl_seconds + 30 min, so an object can never be reaped while
	 * its upload URL is still usable (see reconcile in gc.ts)
	 */
	reconcile_grace_hours: number;
	/** HMAC secret for POST /billing/webhook; unset disables the endpoint */
	billing_webhook_secret: string | null;
	/** Standard Webhooks secret for POST /auth/send-email (`v1,whsec_…`); unset → 503 */
	send_email_hook_secret: string | null;
	/** Plunk secret API key (`sk_…`); unset → 503 on /auth/send-email */
	plunk_secret_key: string | null;
	plunk_from_email: string | null;
	plunk_from_name: string | null;
	/** Origin of the SPA for invite email links (`/invite/<token>`). Unset → pending invite mail 503s. */
	public_app_url: string | null;
	/** Public mailbox for Hub reports, appeals, and DMCA (also in owner emails). */
	abuse_email: string | null;
	/** Weekly Hub digest recipient (you). Unset → digest worker is idle. */
	moderation_digest_email: string | null;
	moderation_digest_cron: string;
	moderation_mail_cron: string;
	egress: EgressEnv;
	deriv: DerivEnv;
};

function required(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`Missing required environment variable: ${name} (see .env.example)`);
	}
	return value;
}

function positive_int_or(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`Environment variable ${name} must be a positive number, got: "${raw}"`);
	}
	return Math.floor(value);
}

function non_negative_number_or(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isFinite(value) || value < 0) {
		throw new Error(`Environment variable ${name} must be a non-negative number, got: "${raw}"`);
	}
	return value;
}

function fraction_or(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isFinite(value) || value <= 0 || value > 1) {
		throw new Error(`Environment variable ${name} must be a fraction in (0, 1], got: "${raw}"`);
	}
	return value;
}

function int_in_range_or(name: string, fallback: number, min: number, max: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < min || value > max) {
		throw new Error(`Environment variable ${name} must be an integer in [${min}, ${max}], got: "${raw}"`);
	}
	return value;
}

function on_off_or(name: string, fallback: boolean): boolean {
	const raw = process.env[name]?.trim().toLowerCase();
	if (!raw) return fallback;
	if (raw === "on" || raw === "true" || raw === "1") return true;
	if (raw === "off" || raw === "false" || raw === "0") return false;
	throw new Error(`Environment variable ${name} must be on or off, got: "${raw}"`);
}

function deriv_mode(): DerivMode {
	const raw = process.env.DERIV_ENABLE?.trim().toLowerCase() || "off";
	if (raw === "off" || raw === "generate" || raw === "serve") return raw;
	throw new Error(`Environment variable DERIV_ENABLE must be off, generate or serve, got: "${raw}"`);
}

function egress_mode(): EgressMode {
	const raw = process.env.EGRESS_ENFORCE?.trim().toLowerCase() || "off";
	if (raw === "off" || raw === "file_size" || raw === "all") return raw;
	throw new Error(`Environment variable EGRESS_ENFORCE must be off, file_size or all, got: "${raw}"`);
}

export function load_env(): Env {
	return {
		port: positive_int_or("PORT", 3000),
		supabase_url: required("SUPABASE_URL"),
		supabase_publishable_key: required("SUPABASE_PUBLISHABLE_KEY"),
		supabase_service_role_key: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null,
		background_workers: on_off_or("BACKGROUND_WORKERS", true),
		b2_endpoint: required("B2_ENDPOINT"),
		b2_region: required("B2_REGION"),
		b2_bucket: required("B2_BUCKET"),
		b2_key_id: required("B2_KEY_ID"),
		b2_application_key: required("B2_APPLICATION_KEY"),
		// PRESIGN_TTL_SECONDS is the legacy single knob; the split ones win when set
		presign_get_ttl_seconds: positive_int_or(
			"PRESIGN_GET_TTL_SECONDS",
			positive_int_or("PRESIGN_TTL_SECONDS", 900),
		),
		presign_put_ttl_seconds: positive_int_or(
			"PRESIGN_PUT_TTL_SECONDS",
			positive_int_or("PRESIGN_TTL_SECONDS", 3600),
		),
		account_delete_max_auth_age_seconds: positive_int_or("ACCOUNT_DELETE_MAX_AUTH_AGE_SECONDS", 600),
		trusted_proxy_hops: positive_int_or("TRUSTED_PROXY_HOPS", 1),
		hub_preview_max_bytes: positive_int_or("HUB_PREVIEW_MAX_BYTES", 2 * 1024 * 1024),
		gc_cron: process.env.GC_CRON?.trim() || "*/5 * * * *",
		gc_batch_size: positive_int_or("GC_BATCH_SIZE", 100),
		gc_max_attempts: positive_int_or("GC_MAX_ATTEMPTS", 25),
		gc_min_age_hours: non_negative_number_or("GC_MIN_AGE_HOURS", 24),
		reconcile_cron: process.env.RECONCILE_CRON?.trim() || "17 * * * *",
		reconcile_grace_hours: positive_int_or("RECONCILE_GRACE_HOURS", 24),
		billing_webhook_secret: process.env.BILLING_WEBHOOK_SECRET?.trim() || null,
		send_email_hook_secret: process.env.SEND_EMAIL_HOOK_SECRET?.trim() || null,
		plunk_secret_key: process.env.PLUNK_SECRET_KEY?.trim() || null,
		plunk_from_email: process.env.PLUNK_FROM_EMAIL?.trim() || null,
		plunk_from_name: process.env.PLUNK_FROM_NAME?.trim() || null,
		public_app_url: process.env.PUBLIC_APP_URL?.trim().replace(/\/$/, "") || null,
		abuse_email: process.env.ABUSE_EMAIL?.trim() || null,
		moderation_digest_email: process.env.MODERATION_DIGEST_EMAIL?.trim() || null,
		moderation_digest_cron: process.env.MODERATION_DIGEST_CRON?.trim() || "0 9 * * 1",
		moderation_mail_cron: process.env.MODERATION_MAIL_CRON?.trim() || "* * * * *",
		egress: {
			mode: egress_mode(),
			alert_day_fraction: fraction_or("EGRESS_ALERT_DAY_FRACTION", 0.25),
			visitor_fraction: fraction_or("EGRESS_VISITOR_FRACTION", 0.05),
			alert_email: process.env.EGRESS_ALERT_EMAIL?.trim() || null,
		},
		deriv: {
			mode: deriv_mode(),
			cron: process.env.DERIV_CRON?.trim() || "*/1 * * * *",
			batch_size: int_in_range_or("DERIV_BATCH_SIZE", 4, 1, 100),
			max_attempts: positive_int_or("DERIV_MAX_ATTEMPTS", 5),
			retry_backoff_minutes: positive_int_or("DERIV_RETRY_BACKOFF_MINUTES", 60),
			tick_budget_ms: positive_int_or("DERIV_TICK_BUDGET_MS", 20_000),
			image_edge: int_in_range_or("DERIV_IMAGE_EDGE", 1600, 64, 4096),
			image_quality: int_in_range_or("DERIV_IMAGE_QUALITY", 78, 1, 100),
			max_pixels: positive_int_or("DERIV_MAX_PIXELS", 40_000_000),
			min_source_bytes: non_negative_number_or("DERIV_MIN_SOURCE_BYTES", 256 * 1024),
			max_source_bytes: positive_int_or("DERIV_MAX_SOURCE_BYTES", 64 * 1024 * 1024),
			video: on_off_or("DERIV_VIDEO", false),
			ffmpeg_path: process.env.FFMPEG_PATH?.trim() || "ffmpeg",
			poster_edge: int_in_range_or("DERIV_POSTER_EDGE", 1280, 64, 4096),
			poster_quality: int_in_range_or("DERIV_POSTER_QUALITY", 78, 1, 100),
			poster_timeout_ms: positive_int_or("DERIV_POSTER_TIMEOUT_MS", 20_000),
			poster_seek_seconds: non_negative_number_or("DERIV_POSTER_SEEK_SECONDS", 1),
			poster_max_output_bytes: positive_int_or("DERIV_POSTER_MAX_OUTPUT_BYTES", 8 * 1024 * 1024),
			source_presign_ttl_seconds: positive_int_or("DERIV_SOURCE_PRESIGN_TTL_SECONDS", 120),
		},
	};
}
